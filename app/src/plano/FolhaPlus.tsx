/**
 * C13.5 — A folha do Barganha+: o que existe do outro lado do cadeado.
 *
 * Vive uma vez só, dentro do `ProvedorPlano`, e qualquer tela abre pelo
 * `mostrarPlus()` do `usePlano()` — assim nenhuma tela precisa carregar o estado
 * de um sheet que não é dela (mesmo padrão do `ProvedorToast`).
 *
 * O texto é honesto sobre o estado real: **nada está à venda**. Não há cobrança,
 * não há Google Play Billing (C13.3) e o plano de teste vive só no aparelho.
 * Prometer preço ou data aqui seria mentir para o próprio dono do produto
 * durante o desenvolvimento.
 *
 * O bloco final não é enfeite: é a regra travada de docs/21 dita ao usuário —
 * escanear cupom e ver o veredito são de graça, para sempre. Quem lê a tela de
 * um plano pago precisa entender na hora que o preço justo não é o produto pago.
 */

import { StyleSheet, View } from 'react-native';

import { FolhaInferior, IconeCadeado, Texto } from '@/componentes';
import { espaco, raio, useTema } from '@/tema';

/** O que o Barganha+ inclui. Espelha a tabela de docs/21 §"O corte". */
const INCLUI: readonly { titulo: string; texto: string }[] = [
  { titulo: 'Histórico completo', texto: 'Todas as suas compras, e não só os últimos 3 meses.' },
  { titulo: 'Preço em 12 meses', texto: 'A evolução do produto no ano inteiro, não em 30 dias.' },
  { titulo: 'Cesta em todos os mercados', texto: 'O ranking inteiro, sem parar nos 3 primeiros.' },
  { titulo: 'Alertas ilimitados', texto: 'Avise-me quando baixar, em quantos produtos quiser.' },
  { titulo: 'Onde seu dinheiro foi', texto: 'Gasto por categoria e por mercado, item a item.' },
];

export function FolhaPlus({ visivel, aoFechar }: { visivel: boolean; aoFechar: () => void }) {
  const { c } = useTema();

  return (
    <FolhaInferior visivel={visivel} titulo="Barganha+" aoFechar={aoFechar} rotuloFechar="Entendi">
      <Texto cor="suave" tamanho="sm" style={estilos.abertura}>
        Um plano para quem quer o retrospecto da compra — o que você gastou, onde, e como o preço
        andou ao longo do tempo.
      </Texto>

      <View style={estilos.lista}>
        {INCLUI.map((item) => (
          <View key={item.titulo} style={estilos.item}>
            <Texto peso="semibold" tamanho="sm">
              {item.titulo}
            </Texto>
            <Texto cor="fraco" tamanho="xs" style={estilos.itemTexto}>
              {item.texto}
            </Texto>
          </View>
        ))}
      </View>

      <View style={[estilos.livre, { backgroundColor: c.tealWash }]}>
        <Texto peso="semibold" tamanho="sm">
          O que nunca vai ser pago
        </Texto>
        <Texto cor="suave" tamanho="xs" style={estilos.livreTexto}>
          Escanear cupom, ver se o preço está barato, na média ou caro, a faixa típica da sua região
          e a busca de produtos. Isso é o Barganha — e é de graça, sem limite, para sempre. O preço
          que você vê é o mesmo pagando ou não.
        </Texto>
      </View>

      <View style={estilos.aviso}>
        <IconeCadeado tamanho={14} cor={c.fraco} />
        <Texto cor="fraco" tamanho="xs" style={estilos.avisoTexto}>
          Em construção: o plano ainda não está à venda e ninguém é cobrado. O interruptor em
          Configurações da conta serve para testar as duas visões.
        </Texto>
      </View>
    </FolhaInferior>
  );
}

const estilos = StyleSheet.create({
  abertura: { lineHeight: 19, marginBottom: espaco.lg },
  lista: { gap: espaco.md },
  item: {},
  itemTexto: { marginTop: 2, lineHeight: 16 },
  livre: { borderRadius: raio.cartao, padding: espaco.md, marginTop: espaco.lg },
  livreTexto: { marginTop: 4, lineHeight: 16 },
  aviso: { flexDirection: 'row', gap: espaco.sm, marginTop: espaco.md, alignItems: 'flex-start' },
  avisoTexto: { flex: 1, lineHeight: 15 },
});
