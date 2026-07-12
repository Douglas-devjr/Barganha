/**
 * C6.3 + Redesign "2a" — Nota fiscal. O cupom já foi salvo na captura (C6.1);
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

import { ErroApi } from '@/api';
import {
  Botao,
  CabecalhoVoltar,
  Cartao,
  ColetorNotaWeb,
  Esqueleto,
  Estado,
  IconeAlerta,
  Tela,
  Texto,
} from '@/componentes';
import type { ResultadoColeta } from '@/componentes';
import { cupons } from '@/dados';
import type { CupomLocal, ItemCupomLocal } from '@/dados';
import { parseMoeda } from '@/nucleo/formato';
import { enviarHtmlCupom, sincronizarCupom } from '@/nucleo/sincronizador';
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

export function NotaFiscalTela({ navigation, route }: Props) {
  const { c } = useTema();
  const { cupomLocalId } = route.params;
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
  const ativo = useRef(true);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

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

  async function descartar() {
    ativo.current = false;
    if (timer.current) clearTimeout(timer.current);
    await cupons.excluir(cupomLocalId);
    navigation.goBack();
  }

  const processado = cupom?.status === 'processado';
  const falhou = cupom?.status === 'falha';
  const precisaColetar =
    cupom != null &&
    cupom.status === 'qr_capturado' &&
    cupom.cupomIdServidor != null &&
    /^https?:/i.test(cupom.qrPayload);
  const podeDescartar = cupom != null && (!cupom.cupomIdServidor || falhou);
  // Sem totais = `valor_pago` nulo (o parse novo sempre grava, mesmo desconto 0).
  const semTotais =
    processado &&
    cupom?.valorPago == null &&
    cupom?.cupomIdServidor != null &&
    /^https?:/i.test(cupom?.qrPayload ?? '');
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
      <CabecalhoVoltar
        titulo="Nota fiscal"
        subtitulo={subtitulo}
        aoVoltar={() => navigation.goBack()}
      />

      {processado ? (
        <>
          {cupom?.lojaNome ? (
            <Cartao style={{ marginBottom: espaco.lg }}>
              <Texto peso="extrabold" tamanho="lg">
                {cupom.lojaNome}
              </Texto>
              {cupom.uf ? (
                <Texto cor="fraco" tamanho="sm" style={{ marginTop: espaco.xs }}>
                  {cupom.uf}
                </Texto>
              ) : null}
            </Cartao>
          ) : null}

          <Texto peso="extrabold" tamanho="lg" style={{ marginBottom: espaco.sm }}>
            {itens.length} {itens.length === 1 ? 'item' : 'itens'}
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
                  <Texto peso="bold">{moeda(item.valorTotal)}</Texto>
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

            {temDesconto ? (
              <>
                <View style={[estilos.item, { borderTopWidth: 1, borderTopColor: c.linha }]}>
                  <Texto cor="suave">Subtotal</Texto>
                  <Texto>{moeda(total)}</Texto>
                </View>
                <View style={estilos.item}>
                  <Texto cor="suave">Desconto</Texto>
                  <Texto style={{ color: c.barato }}>− {moeda(descontoCupom)}</Texto>
                </View>
                <View style={[estilos.item, { borderTopWidth: 1, borderTopColor: c.linha }]}>
                  <Texto peso="extrabold">Valor pago</Texto>
                  <Texto peso="extrabold">{moeda(valorPago)}</Texto>
                </View>
              </>
            ) : (
              <View style={[estilos.item, { borderTopWidth: 1, borderTopColor: c.linha }]}>
                <Texto peso="extrabold">Total</Texto>
                <Texto peso="extrabold">{moeda(total)}</Texto>
              </View>
            )}
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
        <Cartao>
          <Estado
            tom="ambar"
            icone={<IconeAlerta tamanho={30} cor={c.ambar} />}
            titulo="Não foi possível ler este cupom"
            texto="O QR pode ser de um estado ainda não suportado ou estar ilegível. Ele fica guardado para reprocessamento futuro."
          />
        </Cartao>
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
        <Cartao>
          <View style={estilos.processandoTopo}>
            <ActivityIndicator color={c.teal} />
            <Texto cor="suave" peso="semibold" style={{ marginLeft: espaco.sm }}>
              {cupom?.cupomIdServidor ? 'Processando a nota…' : 'Salvo no aparelho. Enviando…'}
            </Texto>
          </View>
          <View style={estilos.esqueletos}>
            <Esqueleto largura="70%" />
            <Esqueleto largura="90%" />
            <Esqueleto largura="55%" />
          </View>
          <Texto cor="fraco" tamanho="sm" style={{ marginTop: espaco.md }}>
            {offline
              ? 'Não conseguimos falar com o servidor agora — o app continua tentando sozinho.'
              : 'Isto roda em segundo plano; você pode sair desta tela.'}
          </Texto>
        </Cartao>
      )}

      <View style={{ marginTop: espaco.xl, gap: espaco.sm }}>
        <Botao titulo="Salvar no histórico" bloco onPress={() => navigation.goBack()} />
        {podeDescartar ? (
          <Botao titulo="Descartar" variante="fantasma" bloco onPress={() => void descartar()} />
        ) : null}
      </View>

      <Modal
        visible={editando != null}
        transparent
        animationType="fade"
        onRequestClose={() => setEditando(null)}
      >
        <Pressable style={estilos.modalFundo} onPress={() => setEditando(null)}>
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

const estilos = StyleSheet.create({
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
    backgroundColor: 'rgba(11,18,32,0.5)',
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
