/**
 * C6.3 — Nota fiscal. O cupom já foi salvo localmente na captura (C6.1); aqui
 * acompanhamos o parsing assíncrono do backend e exibimos os itens quando ficam
 * prontos. Tudo offline-first: sem sinal, mostramos o estado "salvo, aguardando
 * processar" e seguimos tentando em background.
 *
 * Ações:
 *  • "Salvar no histórico" — mantém o cupom e volta (o parsing conclui sozinho).
 *  • "Descartar" — só enquanto não subiu (ou em falha): apaga o espelho local.
 */

import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { useCallback, useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Modal, Pressable, StyleSheet, TextInput, View } from 'react-native';

import { ErroApi } from '@/api';
import { Botao, CabecalhoVoltar, Cartao, ColetorNotaWeb, Tela, Texto } from '@/componentes';
import type { ResultadoColeta } from '@/componentes';
import { cupons } from '@/dados';
import type { CupomLocal, ItemCupomLocal } from '@/dados';
import { parseMoeda } from '@/nucleo/formato';
import { enviarHtmlCupom, sincronizarCupom } from '@/nucleo/sincronizador';
import { cores, espaco, raio } from '@/tema';
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
  const { cupomLocalId } = route.params;
  const [cupom, setCupom] = useState<CupomLocal | null>(null);
  const [itens, setItens] = useState<ItemCupomLocal[]>([]);
  const [offline, setOffline] = useState(false);
  const [coletaMsg, setColetaMsg] = useState<string | null>(null);
  // Marcação de desconto (C2.6): item em edição + valor digitado.
  const [editando, setEditando] = useState<ItemCupomLocal | null>(null);
  const [valorInput, setValorInput] = useState('');
  const ativo = useRef(true);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const recarregarLocal = useCallback(async () => {
    const [c, is] = await Promise.all([
      cupons.obterCupom(cupomLocalId),
      cupons.listarItens(cupomLocalId),
    ]);
    if (!ativo.current) return;
    setCupom(c);
    setItens(is);
  }, [cupomLocalId]);

  // C2.6 — Envia ao backend o HTML colhido pelo WebView e traduz o desfecho para
  // o coletor: 422 = ainda na página de desafio (segue tentando); demais erros =
  // transitórios; `processado` encerra.
  const enviarHtmlColeta = useCallback(
    async (html: string): Promise<ResultadoColeta> => {
      try {
        const atualizado = await enviarHtmlCupom(cupomLocalId, html);
        if (atualizado?.status === 'processado') return 'processado';
        if (atualizado?.status === 'falha') return 'erro';
        return 'desafio';
      } catch (e) {
        if (e instanceof ErroApi && e.status === 422) return 'desafio';
        return 'erro';
      }
    },
    [cupomLocalId],
  );

  useEffect(() => {
    ativo.current = true;

    async function tick() {
      try {
        const c = await sincronizarCupom(cupomLocalId);
        if (!ativo.current) return;
        setOffline(false);
        if (c) setCupom(c);
        await recarregarLocal();
        // Segue consultando enquanto o backend não terminou o parsing.
        if (ativo.current && c && c.status === 'qr_capturado') {
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
  // Portal exige navegador (ex.: RJ): o cupom já subiu, mas segue `qr_capturado`
  // porque o backend não alcança a nota — o app a colhe via WebView (C2.6).
  const precisaColetar =
    cupom != null &&
    cupom.status === 'qr_capturado' &&
    cupom.cupomIdServidor != null &&
    /^https?:/i.test(cupom.qrPayload);
  const podeDescartar = cupom != null && (!cupom.cupomIdServidor || falhou);
  const total = itens.reduce((s, i) => s + i.valorTotal, 0);
  // Totais do cupom (C2.6). O portal só traz o desconto AGREGADO; o usuário marca
  // em qual item ele foi. `valorPago` é o autoritativo da nota; o "falta marcar" é
  // só a atribuição por item (histórico privado).
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
                <Texto cor="textoMudo" tamanho="sm" style={{ marginTop: espaco.xs }}>
                  {cupom.uf}
                </Texto>
              ) : null}
            </Cartao>
          ) : null}

          <Texto peso="extrabold" tamanho="lg" style={{ marginBottom: espaco.sm }}>
            {itens.length} {itens.length === 1 ? 'item' : 'itens'}
          </Texto>

          {temDesconto && restanteMarcar > 0 ? (
            <Cartao style={estilos.dicaDesconto}>
              <Texto tamanho="sm">
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
                <View style={[estilos.item, idx < itens.length - 1 && estilos.itemBorda]}>
                  <View style={estilos.itemTexto}>
                    <Texto peso="semibold" numberOfLines={2}>
                      {item.descricaoOriginal}
                    </Texto>
                    <Texto cor="textoMudo" tamanho="sm" style={{ marginTop: 2 }}>
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
                <View style={[estilos.item, estilos.totalLinha]}>
                  <Texto cor="textoMudo">Subtotal</Texto>
                  <Texto>{moeda(total)}</Texto>
                </View>
                <View style={estilos.item}>
                  <Texto cor="textoMudo">Desconto</Texto>
                  <Texto>− {moeda(descontoCupom)}</Texto>
                </View>
                <View style={[estilos.item, estilos.totalLinha]}>
                  <Texto peso="extrabold">Valor pago</Texto>
                  <Texto peso="extrabold">{moeda(valorPago)}</Texto>
                </View>
              </>
            ) : (
              <View style={[estilos.item, estilos.totalLinha]}>
                <Texto peso="extrabold">Total</Texto>
                <Texto peso="extrabold">{moeda(total)}</Texto>
              </View>
            )}
          </Cartao>
        </>
      ) : falhou ? (
        <Cartao>
          <Texto peso="bold">Não foi possível ler este cupom</Texto>
          <Texto cor="textoMudo" tamanho="sm" style={{ marginTop: espaco.xs }}>
            O QR pode ser de um estado ainda não suportado ou estar ilegível. Ele fica guardado para
            reprocessamento futuro.
          </Texto>
        </Cartao>
      ) : coletaMsg ? (
        <Cartao>
          <Texto peso="bold">Não deu para confirmar agora</Texto>
          <Texto cor="textoMudo" tamanho="sm" style={{ marginTop: espaco.xs }}>
            {coletaMsg}
          </Texto>
          <View style={{ marginTop: espaco.md }}>
            <Botao titulo="Tentar de novo" onPress={() => setColetaMsg(null)} />
          </View>
        </Cartao>
      ) : precisaColetar ? (
        <Cartao>
          <Texto peso="bold" style={{ marginBottom: espaco.xs }}>
            Confirmando sua nota
          </Texto>
          <Texto cor="textoMudo" tamanho="sm" style={{ marginBottom: espaco.md }}>
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
          <View style={estilos.processando}>
            <ActivityIndicator color={cores.marca} />
            <Texto cor="textoSuave" style={{ marginTop: espaco.md }} centralizado>
              {cupom?.cupomIdServidor ? 'Processando a nota…' : 'Salvo no aparelho. Enviando…'}
            </Texto>
            {offline ? (
              <Texto cor="placeholder" tamanho="sm" centralizado style={{ marginTop: espaco.xs }}>
                Sem conexão agora — concluímos assim que voltar o sinal.
              </Texto>
            ) : null}
          </View>
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
          {/* onPress vazio: impede que tocar no cartão feche o modal. */}
          <Pressable style={estilos.modalCartao} onPress={() => {}}>
            <Texto peso="extrabold" tamanho="lg">
              Desconto do item
            </Texto>
            <Texto cor="textoMudo" tamanho="sm" numberOfLines={2} style={{ marginTop: espaco.xs }}>
              {editando?.descricaoOriginal}
            </Texto>
            <TextInput
              value={valorInput}
              onChangeText={setValorInput}
              keyboardType="decimal-pad"
              placeholder="0,00"
              placeholderTextColor={cores.placeholder}
              style={estilos.input}
              autoFocus
            />
            <Texto cor="textoMudo" tamanho="sm">
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
  itemBorda: { borderBottomWidth: 1, borderBottomColor: cores.borda },
  itemTexto: { flex: 1 },
  totalLinha: { borderTopWidth: 1, borderTopColor: cores.superficieMuda },
  processando: { alignItems: 'center', paddingVertical: espaco.lg },
  dicaDesconto: { marginBottom: espaco.md, backgroundColor: cores.superficieMuda },
  modalFundo: {
    flex: 1,
    backgroundColor: 'rgba(11,18,32,0.5)',
    justifyContent: 'center',
    padding: espaco.xl,
  },
  modalCartao: { backgroundColor: cores.branco, borderRadius: raio.lg, padding: espaco.lg },
  input: {
    borderWidth: 1,
    borderColor: cores.borda,
    borderRadius: raio.md,
    paddingHorizontal: espaco.md,
    paddingVertical: espaco.sm,
    fontSize: 18,
    marginVertical: espaco.md,
    color: cores.textoForte,
  },
});
