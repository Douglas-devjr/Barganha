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
import { ActivityIndicator, StyleSheet, View } from 'react-native';

import { Botao, CabecalhoVoltar, Cartao, Tela, Texto } from '@/componentes';
import { cupons } from '@/dados';
import type { CupomLocal, ItemCupomLocal } from '@/dados';
import { sincronizarCupom } from '@/nucleo/sincronizador';
import { cores, espaco } from '@/tema';
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
  const podeDescartar = cupom != null && (!cupom.cupomIdServidor || falhou);
  const total = itens.reduce((s, i) => s + i.valorTotal, 0);
  const subtitulo = processado
    ? (dataCurta(cupom?.emitidoEm) ?? 'Nota processada')
    : 'Aguardando processamento';

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

          <Cartao semPadding>
            {itens.map((item, idx) => (
              <View
                key={item.id}
                style={[estilos.item, idx < itens.length - 1 && estilos.itemBorda]}
              >
                <View style={estilos.itemTexto}>
                  <Texto peso="semibold" numberOfLines={2}>
                    {item.descricaoOriginal}
                  </Texto>
                  <Texto cor="textoMudo" tamanho="sm" style={{ marginTop: 2 }}>
                    {quantidade(item.quantidade)} {item.unidade} × {moeda(item.valorUnitario)}
                    {item.desconto != null && item.desconto > 0 ? '  · promoção' : ''}
                  </Texto>
                </View>
                <Texto peso="bold">{moeda(item.valorTotal)}</Texto>
              </View>
            ))}
            <View style={[estilos.item, estilos.totalLinha]}>
              <Texto peso="extrabold">Total</Texto>
              <Texto peso="extrabold">{moeda(total)}</Texto>
            </View>
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
});
