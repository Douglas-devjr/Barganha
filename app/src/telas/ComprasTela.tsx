/**
 * Minhas compras — a lista COMPLETA de cupons escaneados, do mais novo ao mais
 * antigo. É o destino do "Ver tudo" de "Últimas compras" no Início.
 *
 * Antes, "Ver tudo" levava à aba Produtos, que agrupa por PRODUTO — outra
 * pergunta ("quanto costumo pagar por arroz?"), não a que o usuário fez ao tocar
 * ali ("quais foram minhas compras?"). Aqui a unidade é o CUPOM: cada linha é
 * uma ida ao mercado, e tocá-la abre aquela nota com seus itens.
 *
 * Tudo do histórico PRIVADO local (offline). Recarrega ao focar, para refletir
 * cupons que terminaram de processar em segundo plano.
 */

import { useFocusEffect } from '@react-navigation/native';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { useCallback, useState } from 'react';
import { StyleSheet, View } from 'react-native';

import {
  CabecalhoVoltar,
  CartaoLista,
  Estado,
  IconeLoja,
  IconeRecibo,
  LinhaLista,
  Tela,
  Texto,
} from '@/componentes';
import { cupons } from '@/dados';
import type { CompraResumo } from '@/dados/repositorio-cupom';
import { dataCurta, moeda } from '@/nucleo/formato';
import type { RootStackParamList } from '@/navegacao/tipos';
import { espaco, useTema } from '@/tema';

type Props = NativeStackScreenProps<RootStackParamList, 'Compras'>;

/**
 * Teto da lista. Alto o bastante para ninguém esbarrar nele tão cedo (são ~4
 * compras de mercado por mês) e baixo o bastante para a consulta não crescer sem
 * limite no SQLite do aparelho. Ao chegar perto, virar lista paginada.
 */
const LIMITE = 500;

export function ComprasTela({ navigation }: Props) {
  const { c } = useTema();
  const [compras, setCompras] = useState<CompraResumo[] | null>(null);

  useFocusEffect(
    useCallback(() => {
      let vivo = true;
      void (async () => {
        const lista = await cupons.listarComprasRecentes(LIMITE);
        if (vivo) setCompras(lista);
      })();
      return () => {
        vivo = false;
      };
    }, []),
  );

  // `null` = ainda carregando: não mostrar o vazio antes de saber, senão a tela
  // pisca "nenhuma compra" para quem tem histórico.
  if (compras == null)
    return (
      <Tela>
        <CabecalhoVoltar titulo="Minhas compras" aoVoltar={() => navigation.goBack()} />
      </Tela>
    );

  return (
    <Tela>
      <CabecalhoVoltar titulo="Minhas compras" aoVoltar={() => navigation.goBack()} />

      {compras.length === 0 ? (
        <Estado
          icone={<IconeRecibo tamanho={28} cor={c.suave} />}
          titulo="Nenhuma compra ainda"
          texto="Escaneie o QR Code de um cupom fiscal para começar seu histórico."
          acao={{ titulo: 'Escanear cupom', onPress: () => navigation.navigate('Scanner') }}
        />
      ) : (
        <>
          <Texto cor="suave" tamanho="sm" style={estilos.contagem}>
            {compras.length === 1 ? '1 compra' : `${compras.length} compras`}
          </Texto>
          <CartaoLista>
            {compras.map((compra, idx) => (
              <LinhaLista
                key={compra.cupomLocalId}
                icone={<IconeLoja tamanho={18} cor={c.tinta} />}
                titulo={compra.lojaNome ?? 'Compra'}
                subtitulo={subtituloDe(compra)}
                chevron
                ultima={idx === compras.length - 1}
                direita={<ValorCompra compra={compra} />}
                onPress={() =>
                  navigation.navigate('NotaFiscal', { cupomLocalId: compra.cupomLocalId })
                }
              />
            ))}
          </CartaoLista>
        </>
      )}
    </Tela>
  );
}

function subtituloDe(compra: CompraResumo): string {
  const data = dataCurta(compra.observadoEm) ?? '';
  if (compra.totalItens === 0) return data;
  return `${data} · ${compra.totalItens} ${compra.totalItens === 1 ? 'item' : 'itens'}`;
}

/** Preço + economia à direita da linha — mesmo formato do card do Início. */
function ValorCompra({ compra }: { compra: CompraResumo }) {
  // Cupom ainda na fila não tem total: mostra o estado em vez de "R$ 0,00".
  const processado = compra.status === 'processado';
  return (
    <View style={estilos.valor}>
      {processado ? (
        <Texto peso="bold" tamanho="sm" numerico>
          {moeda(compra.valorTotal)}
        </Texto>
      ) : (
        <Texto cor="fraco" tamanho="xs">
          {compra.status === 'falha' ? 'não lida' : 'processando…'}
        </Texto>
      )}
      {compra.economia > 0 ? (
        <Texto cor="suave" numerico style={estilos.economia}>
          desconto {moeda(compra.economia)}
        </Texto>
      ) : null}
    </View>
  );
}

const estilos = StyleSheet.create({
  contagem: { marginBottom: espaco.sm, marginLeft: espaco.xs },
  valor: { alignItems: 'flex-end' },
  economia: { fontSize: 11 },
});
