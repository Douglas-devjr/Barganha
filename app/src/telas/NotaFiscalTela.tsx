/**
 * C6.3 + Redesign "3a" — Nota fiscal. O cupom já foi salvo na captura (C6.1);
 * aqui acompanhamos o parsing assíncrono do backend e exibimos os itens quando
 * ficam prontos. Offline-first: sem sinal, mostramos "salvo, aguardando" (com
 * esqueleto) e seguimos tentando em background.
 *
 * Ações:
 *  • "Salvar no histórico" — mantém o cupom e volta (o parsing conclui sozinho).
 *  • "Descartar" — só enquanto não subiu (ou em falha): apaga o espelho local.
 */

import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { useCallback, useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Modal, Pressable, StyleSheet, TextInput, View } from 'react-native';

import { clienteApi, ErroApi } from '@/api';
import { urlConsultaConfiavel, type Veredito } from '@barganha/shared';
import {
  Botao,
  Cartao,
  ColetorNotaWeb,
  Dialogo,
  Esqueleto,
  Estado,
  Eyebrow,
  IconeAlerta,
  IconeLixeira,
  IconeTendenciaBaixo,
  IconeTendenciaCima,
  IconeVoltar,
  Tela,
  Texto,
  useToast,
} from '@/componentes';
import type { ResultadoColeta } from '@/componentes';
import { cupons } from '@/dados';
import type { CupomLocal, ItemCupomLocal } from '@/dados';
import { parseMoeda } from '@/nucleo/formato';
import { enviarHtmlCupom, sincronizarCupom } from '@/nucleo/sincronizador';
import { resolverVeredito } from '@/nucleo/veredito-local';
import { espaco, raio, useTema } from '@/tema';
import type { RootStackParamList } from '@/navegacao/tipos';

type Props = NativeStackScreenProps<RootStackParamList, 'NotaFiscal'>;

const INTERVALO_PROCESSANDO_MS = 3000;
const INTERVALO_OFFLINE_MS = 6000;

function moeda(valor: number): string {
  return `R$ ${valor.toFixed(2).replace('.', ',')}`;
}

function quantidade(valor: number): string {
  return Number.isInteger(valor) ? String(valor) : valor.toString().replace('.', ',');
}

function dataCurta(iso?: string | null): string | null {
  if (!iso) return null;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  return d.toLocaleDateString('pt-BR');
}

/** "COMPRA · HOJE 10:42" — o eyebrow do header no handoff. */
function quandoFoi(iso?: string | null): string {
  if (!iso) return 'COMPRA';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return 'COMPRA';
  const hora = d.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
  const hoje = new Date();
  const mesmoDia = d.toDateString() === hoje.toDateString();
  const ontem = new Date(hoje);
  ontem.setDate(hoje.getDate() - 1);
  const quando = mesmoDia
    ? 'HOJE'
    : d.toDateString() === ontem.toDateString()
      ? 'ONTEM'
      : d.toLocaleDateString('pt-BR');
  return `COMPRA · ${quando} ${hora}`;
}

export function NotaFiscalTela({ navigation, route }: Props) {
  const { c } = useTema();
  const toast = useToast();
  const { cupomLocalId, recemCapturado = false } = route.params;
  const [cupom, setCupom] = useState<CupomLocal | null>(null);
  const [itens, setItens] = useState<ItemCupomLocal[]>([]);
  const [offline, setOffline] = useState(false);
  const [coletaMsg, setColetaMsg] = useState<string | null>(null);
  // C2.6 — backfill de totais: nota processada ANTES do recurso de desconto
  // pode buscar os totais na SEFAZ sob demanda (o backend só completa, nunca
  // re-publica itens/pool).
  const [buscandoTotais, setBuscandoTotais] = useState(false);
  const [avisoTotais, setAvisoTotais] = useState<string | null>(null);
  const [editando, setEditando] = useState<ItemCupomLocal | null>(null);
  const [valorInput, setValorInput] = useState('');
  /** Veredito por item (id → barato/na média/caro), do cache regional local. */
  const [vereditos, setVereditos] = useState<Record<string, Veredito>>({});
  const [confirmandoExclusao, setConfirmandoExclusao] = useState(false);
  const [excluindo, setExcluindo] = useState(false);
  const ativo = useRef(true);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  /** Trava do toast de "cupom lido" — só avisa na primeira vez. */
  const avisouLido = useRef(false);

  const recarregarLocal = useCallback(async () => {
    const [c2, is] = await Promise.all([
      cupons.obterCupom(cupomLocalId),
      cupons.listarItens(cupomLocalId),
    ]);
    if (!ativo.current) return;
    setCupom(c2);
    setItens(is);
  }, [cupomLocalId]);

  const enviarHtmlColeta = useCallback(
    async (html: string): Promise<ResultadoColeta> => {
      try {
        const atualizado = await enviarHtmlCupom(cupomLocalId, html);
        if (atualizado?.status === 'processado') return 'processado';
        if (atualizado?.status === 'falha') return 'erro';
        return 'desafio';
      } catch (e) {
        if (e instanceof ErroApi && e.status === 422) {
          // `erro_portal` = a SEFAZ recusou a verificação (beco sem saída): o
          // coletor recarrega a consulta. Qualquer outro 422 é o desafio normal.
          return e.codigo === 'erro_portal' ? 'erro_portal' : 'desafio';
        }
        return 'erro';
      }
    },
    [cupomLocalId],
  );

  useEffect(() => {
    ativo.current = true;

    async function tick() {
      try {
        const cc = await sincronizarCupom(cupomLocalId);
        if (!ativo.current) return;
        setOffline(false);
        if (cc) setCupom(cc);
        await recarregarLocal();
        if (ativo.current && cc && cc.status === 'qr_capturado') {
          timer.current = setTimeout(() => void tick(), INTERVALO_PROCESSANDO_MS);
        }
      } catch {
        if (!ativo.current) return;
        setOffline(true);
        timer.current = setTimeout(() => void tick(), INTERVALO_OFFLINE_MS);
      }
    }

    void recarregarLocal();
    void tick();

    return () => {
      ativo.current = false;
      if (timer.current) clearTimeout(timer.current);
    };
  }, [cupomLocalId, recarregarLocal]);

  // Confirmação do handoff, na virada para processado (o parsing é assíncrono,
  // então o "sucesso" só pode existir quando a nota volta). Recém-escaneada,
  // mostra a tela de sucesso (`CupomLido`) por cima; vinda do histórico, só o
  // toast — quem reabre uma compra antiga não quer a comemoração de novo.
  useEffect(() => {
    if (cupom?.status !== 'processado' || itens.length === 0) return;
    if (avisouLido.current) return;
    avisouLido.current = true;
    if (recemCapturado) {
      navigation.navigate('CupomLido', { cupomLocalId });
    } else {
      toast(`Cupom lido · ${itens.length} ${itens.length === 1 ? 'item' : 'itens'} adicionados`);
    }
  }, [cupom?.status, itens.length, toast, recemCapturado, navigation, cupomLocalId]);

  // Veredito por item (handoff): compara o unitário pago com o típico da região.
  // Tudo do cache local — sem rede, sem bloquear a lista; item sem base fica sem
  // rótulo em vez de receber um palpite.
  useEffect(() => {
    if (itens.length === 0) return;
    let vivo = true;
    void (async () => {
      const pares = await Promise.all(
        itens.map(async (item) => {
          if (!item.produtoCanonicoId) return null;
          const r = await resolverVeredito({
            precoPrateleira: item.valorUnitario,
            produtoCanonicoId: item.produtoCanonicoId,
            unidadeVenda: item.unidade,
            descricao: item.descricaoOriginal,
          });
          if (r.semDados || !r.hibrido.regional) return null;
          return [item.id, r.hibrido.veredito] as const;
        }),
      );
      if (!vivo || !ativo.current) return;
      setVereditos(Object.fromEntries(pares.filter((p): p is NonNullable<typeof p> => p != null)));
    })();
    return () => {
      vivo = false;
    };
  }, [itens]);

  /**
   * Apaga a compra do histórico — local E no servidor (direito ao apagamento,
   * docs/04). A ordem importa: o servidor primeiro, porque é o passo que pode
   * falhar. Se apagássemos o espelho local antes, uma falha de rede deixaria o
   * cupom vivo no servidor sem nada no aparelho para tentar de novo.
   *
   * Sem sinal, o local NÃO é apagado e a tela avisa — melhor manter a compra e
   * o usuário repetir depois do que sumir da vista dele e ficar no servidor.
   */
  async function excluirCompra() {
    ativo.current = false;
    if (timer.current) clearTimeout(timer.current);
    setExcluindo(true);
    try {
      if (cupom?.cupomIdServidor) {
        // 404 (`false`) é sucesso do ponto de vista do usuário: já não está lá.
        await clienteApi.apagarCupom(cupom.cupomIdServidor);
      }
      await cupons.excluir(cupomLocalId);
      setConfirmandoExclusao(false);
      navigation.goBack();
    } catch (e) {
      setExcluindo(false);
      setConfirmandoExclusao(false);
      ativo.current = true;
      const offlineAgora = e instanceof ErroApi && e.status === 0;
      toast(
        offlineAgora
          ? 'Sem conexão para apagar no servidor. A compra continua aqui — tente de novo com internet.'
          : 'Não conseguimos apagar esta compra agora. Tente de novo.',
      );
    }
  }

  const processado = cupom?.status === 'processado';
  const falhou = cupom?.status === 'falha';
  // O QR é entrada não confiável: só abrimos o coletor quando o payload aponta
  // para um portal público (`urlConsultaConfiavel`). Antes bastava começar com
  // `http`, e qualquer QR de gôndola abria o site do atacante DENTRO do app.
  const urlColeta = urlConsultaConfiavel(cupom?.qrPayload ?? '');
  const precisaColetar =
    cupom != null &&
    cupom.status === 'qr_capturado' &&
    cupom.cupomIdServidor != null &&
    urlColeta != null;
  /** Já existe no servidor → a exclusão precisa ir lá também, não só no espelho. */
  const jaSubiu = cupom?.cupomIdServidor != null;
  // Sem totais = `valor_pago` nulo (o parse novo sempre grava, mesmo desconto 0).
  const semTotais =
    processado && cupom?.valorPago == null && cupom?.cupomIdServidor != null && urlColeta != null;
  const total = itens.reduce((s, i) => s + i.valorTotal, 0);
  const descontoCupom = cupom?.descontoTotal ?? 0;
  const temDesconto = descontoCupom > 0;
  const valorPago = cupom?.valorPago ?? total - descontoCupom;
  const descontoMarcado = itens.reduce((s, i) => s + (i.desconto ?? 0), 0);
  const restanteMarcar = Math.max(0, descontoCupom - descontoMarcado);
  const subtitulo = processado
    ? (dataCurta(cupom?.emitidoEm) ?? 'Nota processada')
    : 'Aguardando processamento';

  function abrirEdicao(item: ItemCupomLocal) {
    if (!temDesconto) return;
    setEditando(item);
    const sugerido = item.desconto ?? Math.min(restanteMarcar, item.valorTotal);
    setValorInput(sugerido > 0 ? sugerido.toFixed(2).replace('.', ',') : '');
  }

  async function salvarDesconto(valor: number | null) {
    if (!editando) return;
    await cupons.definirDescontoItem(editando.id, valor);
    setEditando(null);
    await recarregarLocal();
  }

  return (
    <Tela>
      {/* header do handoff: voltar circular + eyebrow da compra + loja */}
      <View style={estilos.header}>
        <Pressable
          onPress={() => navigation.goBack()}
          accessibilityRole="button"
          accessibilityLabel="Voltar"
          style={[estilos.circulo, { backgroundColor: c.cartao, borderColor: c.cartaoBorda }]}
        >
          <IconeVoltar tamanho={19} cor={c.tinta} />
        </Pressable>
        <View style={{ flex: 1 }}>
          <Eyebrow>{processado ? quandoFoi(cupom?.emitidoEm) : subtitulo}</Eyebrow>
          <Texto peso="bold" style={estilos.headerNome} numberOfLines={1}>
            {cupom?.lojaNome ?? 'Nota fiscal'}
            {cupom?.uf ? ` · ${cupom.uf}` : ''}
          </Texto>
        </View>
      </View>

      {processado ? (
        <>
          {/* card do total (handoff): economia à direita, valor 34/700 */}
          <View style={[estilos.total, { backgroundColor: c.cartao, borderColor: c.cartaoBorda }]}>
            <View style={estilos.totalTopo}>
              <Eyebrow style={{ flex: 1 }}>Total da compra</Eyebrow>
              {temDesconto ? (
                <Texto peso="bold" numerico style={[estilos.economia, { color: c.barato }]}>
                  economia {moeda(descontoCupom)}
                </Texto>
              ) : null}
            </View>
            <Texto peso="bold" numerico style={estilos.totalValor}>
              {moeda(valorPago)}
            </Texto>
            <Texto cor="fraco" style={estilos.totalLegenda}>
              {itens.length} {itens.length === 1 ? 'item' : 'itens'} · NFC-e validada
            </Texto>
          </View>

          <Texto peso="bold" style={estilos.secao}>
            Itens do cupom
          </Texto>

          {temDesconto && restanteMarcar > 0 ? (
            <Cartao style={[estilos.dicaDesconto, { backgroundColor: c.ambarBg }]}>
              <Texto tamanho="sm" style={{ color: c.ambarTexto }}>
                Este cupom teve {moeda(descontoCupom)} de desconto. Toque no item que teve o
                desconto
                {restanteMarcar < descontoCupom ? ` (falta marcar ${moeda(restanteMarcar)})` : ''}.
              </Texto>
            </Cartao>
          ) : null}

          <Cartao semPadding>
            {itens.map((item, idx) => {
              const temItemDesc = item.desconto != null && item.desconto > 0;
              const conteudo = (
                <View
                  style={[
                    estilos.item,
                    idx < itens.length - 1 && { borderBottomWidth: 1, borderBottomColor: c.linha },
                  ]}
                >
                  <View style={estilos.itemTexto}>
                    <Texto peso="semibold" numberOfLines={2}>
                      {item.descricaoOriginal}
                    </Texto>
                    <Texto cor="fraco" tamanho="sm" style={{ marginTop: 2 }}>
                      {quantidade(item.quantidade)} {item.unidade} × {moeda(item.valorUnitario)}
                      {temItemDesc ? `  · desconto ${moeda(item.desconto ?? 0)}` : ''}
                    </Texto>
                  </View>
                  <View style={estilos.itemDireita}>
                    <Texto peso="bold" tamanho="sm" numerico>
                      {moeda(item.valorTotal)}
                    </Texto>
                    <VeredictoItem veredito={vereditos[item.id]} />
                  </View>
                </View>
              );
              return temDesconto ? (
                <Pressable key={item.id} onPress={() => abrirEdicao(item)}>
                  {conteudo}
                </Pressable>
              ) : (
                <View key={item.id}>{conteudo}</View>
              );
            })}

            {/* O total já aparece no card acima; aqui só a quebra do desconto. */}
            {temDesconto ? (
              <>
                <View style={[estilos.item, { borderTopWidth: 1, borderTopColor: c.linha }]}>
                  <Texto cor="suave" tamanho="sm">
                    Subtotal
                  </Texto>
                  <Texto tamanho="sm" numerico>
                    {moeda(total)}
                  </Texto>
                </View>
                <View style={estilos.item}>
                  <Texto cor="suave" tamanho="sm">
                    Desconto
                  </Texto>
                  <Texto tamanho="sm" numerico style={{ color: c.barato }}>
                    − {moeda(descontoCupom)}
                  </Texto>
                </View>
              </>
            ) : null}
          </Cartao>

          {semTotais ? (
            <Cartao style={{ marginTop: espaco.md }}>
              {buscandoTotais ? (
                <>
                  <Texto peso="bold" style={{ marginBottom: espaco.xs }}>
                    Buscando o desconto na SEFAZ
                  </Texto>
                  <Texto cor="suave" tamanho="sm" style={{ marginBottom: espaco.md }}>
                    Toque em “Consultar” e resolva a verificação se aparecer — lemos o desconto e o
                    total e fechamos sozinhos.
                  </Texto>
                  <ColetorNotaWeb
                    url={cupom!.qrPayload}
                    enviarHtml={enviarHtmlColeta}
                    aoProcessar={() => {
                      setBuscandoTotais(false);
                      void recarregarLocal();
                    }}
                    aoDesistir={(m) => {
                      setBuscandoTotais(false);
                      setAvisoTotais(m);
                    }}
                  />
                </>
              ) : (
                <>
                  <Texto cor="suave" tamanho="sm" style={{ marginBottom: espaco.sm }}>
                    Esta nota foi lida antes do recurso de desconto. Dá para completar o desconto e
                    o valor pago direto da SEFAZ.
                  </Texto>
                  <Botao
                    titulo="Buscar desconto e total"
                    variante="secundario"
                    bloco
                    onPress={() => {
                      setAvisoTotais(null);
                      setBuscandoTotais(true);
                    }}
                  />
                  {avisoTotais ? (
                    <Texto cor="fraco" tamanho="xs" centralizado style={{ marginTop: espaco.sm }}>
                      {avisoTotais}
                    </Texto>
                  ) : null}
                </>
              )}
            </Cartao>
          ) : null}
        </>
      ) : falhou ? (
        /* estado de erro do handoff (screenshot 18), centralizado na tela */
        <View style={estilos.centro}>
          <View style={[estilos.circuloEstado, { backgroundColor: c.linha }]}>
            <IconeAlerta tamanho={32} cor={c.caro} />
          </View>
          <Texto peso="bold" tamanho="xl" centralizado style={estilos.tituloEstado}>
            Não deu pra ler o cupom
          </Texto>
          <Texto cor="suave" centralizado style={estilos.textoEstado}>
            O QR pode estar borrado, ou a NFC-e ainda não foi encontrada na SEFAZ. Ele fica guardado
            aqui e é reprocessado automaticamente.
          </Texto>
          <Botao
            titulo="Escanear de novo"
            bloco
            onPress={() => navigation.replace('Scanner')}
            style={estilos.acaoEstado}
          />
          <Pressable
            onPress={() => navigation.goBack()}
            accessibilityRole="button"
            style={estilos.linkEstado}
          >
            <Texto cor="suave" peso="semibold" tamanho="sm">
              Voltar ao início
            </Texto>
          </Pressable>
        </View>
      ) : coletaMsg ? (
        <Cartao>
          <Estado
            tom="ambar"
            icone={<IconeAlerta tamanho={30} cor={c.ambar} />}
            titulo="Não deu para confirmar agora"
            texto={coletaMsg}
            acao={{ titulo: 'Tentar de novo', onPress: () => setColetaMsg(null) }}
          />
        </Cartao>
      ) : precisaColetar ? (
        <Cartao>
          <Texto peso="bold" style={{ marginBottom: espaco.xs }}>
            Confirmando sua nota
          </Texto>
          <Texto cor="suave" tamanho="sm" style={{ marginBottom: espaco.md }}>
            A SEFAZ pede uma confirmação de navegador para liberar esta nota. Estamos fazendo isso
            por você — costuma ser rápido.
          </Texto>
          <ColetorNotaWeb
            url={cupom!.qrPayload}
            enviarHtml={enviarHtmlColeta}
            aoProcessar={() => void recarregarLocal()}
            aoDesistir={(m) => setColetaMsg(m)}
          />
        </Cartao>
      ) : (
        /*
          "Lendo cupom…" do handoff (screenshot 19), mas como ESTADO DE TELA e
          não overlay travado: o parsing é assíncrono de verdade, pode demorar e
          continua em background — por isso o rodapé diz que dá para sair, e o
          esqueleto sugere a lista que vai chegar.
        */
        <View style={estilos.centro}>
          <ActivityIndicator size="large" color={c.tinta} />
          <Texto peso="bold" tamanho="lg" centralizado style={estilos.tituloEstado}>
            {cupom?.cupomIdServidor ? 'Lendo cupom…' : 'Salvo no aparelho. Enviando…'}
          </Texto>
          <Texto cor="suave" centralizado style={estilos.textoEstado}>
            Anonimizando e comparando com a região
          </Texto>

          <View style={estilos.esqueletos}>
            <Esqueleto largura="70%" />
            <Esqueleto largura="90%" />
            <Esqueleto largura="55%" />
          </View>

          <Texto cor="fraco" tamanho="sm" centralizado style={estilos.rodapeEstado}>
            {offline
              ? 'Não conseguimos falar com o servidor agora — o app continua tentando sozinho.'
              : 'Isto roda em segundo plano; você pode sair desta tela.'}
          </Texto>
        </View>
      )}

      <View style={{ marginTop: espaco.xl, gap: espaco.sm }}>
        <Botao titulo="Salvar no histórico" bloco onPress={() => navigation.goBack()} />
        <Botao
          titulo={jaSubiu ? 'Excluir compra' : 'Descartar'}
          variante="fantasma"
          bloco
          onPress={() => setConfirmandoExclusao(true)}
        />
      </View>

      {/*
        O texto explica o que sobrevive à exclusão. Sem isso, o usuário
        razoavelmente supõe que apagar a compra "apaga o preço" — e, quando
        descobrisse que não, seria como quebra de confiança. O desenho é o
        contrário: a observação nasce anônima e solta (decisão travada nº3),
        então não existe nem caminho de volta para apagá-la.
      */}
      <Dialogo
        visivel={confirmandoExclusao}
        icone={<IconeLixeira tamanho={22} cor={c.caro} />}
        titulo={jaSubiu ? 'Excluir esta compra?' : 'Descartar esta compra?'}
        mensagem={
          jaSubiu
            ? 'Ela sai do seu histórico, aqui e no servidor. Os preços que você já ' +
              'compartilhou são anônimos e continuam ajudando outras pessoas — eles não ' +
              'estão ligados a você nem a esta compra.'
            : 'Esta compra ainda não foi enviada. Descartar apaga o cupom deste aparelho.'
        }
        rotuloConfirmar={jaSubiu ? 'Excluir' : 'Descartar'}
        ocupado={excluindo}
        aoConfirmar={() => void excluirCompra()}
        aoCancelar={() => setConfirmandoExclusao(false)}
      />

      <Modal
        visible={editando != null}
        transparent
        animationType="fade"
        onRequestClose={() => setEditando(null)}
      >
        <Pressable
          style={[estilos.modalFundo, { backgroundColor: c.veu }]}
          onPress={() => setEditando(null)}
        >
          <Pressable
            style={[estilos.modalCartao, { backgroundColor: c.cartao }]}
            onPress={() => {}}
          >
            <Texto peso="extrabold" tamanho="lg">
              Desconto do item
            </Texto>
            <Texto cor="suave" tamanho="sm" numberOfLines={2} style={{ marginTop: espaco.xs }}>
              {editando?.descricaoOriginal}
            </Texto>
            <TextInput
              value={valorInput}
              onChangeText={setValorInput}
              keyboardType="decimal-pad"
              placeholder="0,00"
              placeholderTextColor={c.fraco}
              style={[estilos.input, { borderColor: c.borda, color: c.tinta }]}
              autoFocus
            />
            <Texto cor="fraco" tamanho="sm">
              Desconto do cupom: {moeda(descontoCupom)} · falta marcar {moeda(restanteMarcar)}
            </Texto>
            <View style={{ marginTop: espaco.md, gap: espaco.sm }}>
              <Botao
                titulo="Salvar"
                bloco
                onPress={() => void salvarDesconto(parseMoeda(valorInput))}
              />
              {editando?.desconto ? (
                <Botao
                  titulo="Remover desconto"
                  variante="fantasma"
                  bloco
                  onPress={() => void salvarDesconto(null)}
                />
              ) : null}
            </View>
          </Pressable>
        </Pressable>
      </Modal>
    </Tela>
  );
}

/**
 * Veredito compacto na linha do item (handoff): seta + palavra, sem pílula.
 * Item sem base regional não mostra nada — melhor silêncio que chute.
 */
function VeredictoItem({ veredito }: { veredito?: Veredito }) {
  const { c } = useTema();
  if (!veredito || veredito === 'sem_dados') return null;

  if (veredito === 'na_media') {
    return (
      <Texto peso="semibold" style={[estilos.veredito, { color: c.medio }]}>
        na média
      </Texto>
    );
  }

  const barato = veredito === 'barato';
  const cor = barato ? c.barato : c.caro;
  const Icone = barato ? IconeTendenciaBaixo : IconeTendenciaCima;

  return (
    <View style={estilos.veredictoLinha}>
      <Icone tamanho={11} cor={cor} larguraTraco={3} />
      <Texto peso="semibold" style={[estilos.veredito, { color: cor }]}>
        {barato ? 'barato' : 'caro'}
      </Texto>
    </View>
  );
}

const estilos = StyleSheet.create({
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: espaco.md,
    paddingTop: espaco.sm,
    marginBottom: espaco.lg,
  },
  circulo: {
    width: 44,
    height: 44,
    borderRadius: raio.pill,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  headerNome: { fontSize: 17, letterSpacing: -0.4, marginTop: 1 },
  total: {
    borderRadius: raio.cartao,
    borderWidth: 1,
    paddingHorizontal: 18,
    paddingVertical: 16,
    marginBottom: espaco.lg,
  },
  totalTopo: { flexDirection: 'row', alignItems: 'center', gap: espaco.sm },
  economia: { fontSize: 11.5 },
  // "preço médio" do 3a: 34/700/-1.8
  totalValor: { fontSize: 34, letterSpacing: -1.8, marginTop: 6 },
  totalLegenda: { fontSize: 11.5, marginTop: 4 },
  secao: { fontSize: 16, letterSpacing: -0.4, marginBottom: espaco.sm },
  itemDireita: { alignItems: 'flex-end' },
  centro: { alignItems: 'center', paddingTop: 64, paddingHorizontal: espaco.md },
  circuloEstado: {
    width: 72,
    height: 72,
    borderRadius: 36,
    alignItems: 'center',
    justifyContent: 'center',
  },
  tituloEstado: { marginTop: espaco.lg, letterSpacing: -0.5 },
  textoEstado: { fontSize: 13.5, lineHeight: 20, marginTop: espaco.sm, maxWidth: 300 },
  acaoEstado: { marginTop: espaco.xl, alignSelf: 'stretch' },
  linkEstado: { minHeight: 44, justifyContent: 'center', marginTop: espaco.xs },
  rodapeEstado: { marginTop: espaco.xl, maxWidth: 320, lineHeight: 18 },
  veredictoLinha: { flexDirection: 'row', alignItems: 'center', gap: 3, marginTop: 2 },
  veredito: { fontSize: 11, marginTop: 2 },
  item: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: espaco.md,
    paddingHorizontal: espaco.lg,
    paddingVertical: espaco.md,
  },
  itemTexto: { flex: 1 },
  processandoTopo: { flexDirection: 'row', alignItems: 'center' },
  esqueletos: { marginTop: espaco.lg, gap: espaco.md },
  dicaDesconto: { marginBottom: espaco.md },
  modalFundo: {
    flex: 1,
    justifyContent: 'center',
    padding: espaco.xl,
  },
  modalCartao: { borderRadius: raio.hero, padding: espaco.lg },
  input: {
    borderWidth: 1,
    borderRadius: raio.md,
    paddingHorizontal: espaco.md,
    paddingVertical: espaco.sm,
    fontSize: 18,
    marginVertical: espaco.md,
  },
});
