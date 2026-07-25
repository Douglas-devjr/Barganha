/**
 * Handoff 3a (`ajuda`) — Perfil → Ajuda e suporte: FAQ em acordeão + canais de
 * contato.
 *
 * As perguntas explicam o que faz a Barganha ser o que ela é (anonimato,
 * mediana, região pela loja) — as dúvidas que a decisão travada de privacidade
 * levanta. Os canais abrem o cliente de e-mail com o assunto já preenchido; não
 * há backend de tickets, e prometer um chat que não existe seria pior que um
 * mailto honesto.
 */

import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { useState } from 'react';
import { Linking, Pressable, StyleSheet, View } from 'react-native';

import {
  CabecalhoVoltar,
  CartaoLista,
  Eyebrow,
  IconeBandeira,
  IconeChat,
  IconeChevron,
  IconeEnvelope,
  LinhaLista,
  Tela,
  Texto,
} from '@/componentes';
import type { RootStackParamList } from '@/navegacao/tipos';
import { espaco, useTema } from '@/tema';

type Props = NativeStackScreenProps<RootStackParamList, 'Ajuda'>;

const EMAIL_SUPORTE = 'suporte@barganha.app';

interface Faq {
  pergunta: string;
  resposta: string;
}

const FAQS: readonly Faq[] = [
  {
    pergunta: 'De onde vêm os preços?',
    resposta:
      'De cupons fiscais (NFC-e) que pessoas como você escaneiam. Cada cupom vira dado de preço ' +
      'anônimo da sua região — quanto mais gente contribui, melhor a comparação.',
  },
  {
    pergunta: 'Meus dados ficam anônimos mesmo?',
    resposta:
      'Sim. O preço que você compartilha entra solto, sem ligação com a sua conta e sem a chave ' +
      'do cupom. Seu histórico de compras fica só neste aparelho.',
  },
  {
    pergunta: 'Como vocês sabem se um preço está bom?',
    resposta:
      'Comparamos com a faixa típica da região — a mediana dos cupons, não a média. Assim um ' +
      'preço muito alto ou uma promoção isolada não distorcem o que é “normal”.',
  },
  {
    pergunta: 'Vocês rastreiam minha localização?',
    resposta:
      'Não. A região vem da loja do cupom (pelo CNPJ), não do GPS do seu celular. Você escolhe ' +
      'sua cidade manualmente em Perfil → região.',
  },
  {
    pergunta: 'O app funciona sem internet?',
    resposta:
      'Escanear e consultar funcionam offline. Os cupons ficam salvos e sincronizam sozinhos ' +
      'quando a conexão volta.',
  },
];

export function AjudaTela({ navigation }: Props) {
  const { c } = useTema();
  const [aberta, setAberta] = useState<number | null>(null);

  function contato(assunto: string) {
    void Linking.openURL(`mailto:${EMAIL_SUPORTE}?subject=${encodeURIComponent(assunto)}`);
  }

  return (
    <Tela>
      <CabecalhoVoltar
        titulo="Ajuda e suporte"
        subtitulo="Central"
        aoVoltar={() => navigation.goBack()}
      />

      <Eyebrow style={estilos.eyebrow}>Perguntas frequentes</Eyebrow>
      <CartaoLista>
        {FAQS.map((faq, idx) => {
          const abertaAgora = aberta === idx;
          return (
            <Pressable
              key={faq.pergunta}
              onPress={() => setAberta(abertaAgora ? null : idx)}
              accessibilityRole="button"
              accessibilityState={{ expanded: abertaAgora }}
              style={[
                estilos.faq,
                idx < FAQS.length - 1 && { borderBottomWidth: 1, borderBottomColor: c.linha },
              ]}
            >
              <View style={estilos.faqLinha}>
                <Texto peso="semibold" tamanho="sm" style={{ flex: 1 }}>
                  {faq.pergunta}
                </Texto>
                <View style={abertaAgora ? estilos.chevronAberto : undefined}>
                  <IconeChevron tamanho={16} cor={c.fraco} />
                </View>
              </View>
              {abertaAgora ? (
                <Texto cor="suave" tamanho="sm" style={estilos.resposta}>
                  {faq.resposta}
                </Texto>
              ) : null}
            </Pressable>
          );
        })}
      </CartaoLista>

      <Eyebrow style={estilos.eyebrowContato}>Fale com a gente</Eyebrow>
      <CartaoLista>
        <LinhaLista
          icone={<IconeChat tamanho={18} cor={c.suave} />}
          titulo="Falar com o suporte"
          chevron
          onPress={() => contato('Suporte — Barganha')}
        />
        <LinhaLista
          icone={<IconeEnvelope tamanho={18} cor={c.suave} />}
          titulo="Enviar sugestão"
          chevron
          onPress={() => contato('Sugestão — Barganha')}
        />
        <LinhaLista
          icone={<IconeBandeira tamanho={18} cor={c.suave} />}
          titulo="Reportar um problema"
          chevron
          ultima
          onPress={() => contato('Problema — Barganha')}
        />
      </CartaoLista>

      <Texto cor="fraco" tamanho="xs" centralizado style={estilos.rodape}>
        {EMAIL_SUPORTE}
      </Texto>
    </Tela>
  );
}

const estilos = StyleSheet.create({
  eyebrow: { marginBottom: espaco.sm },
  eyebrowContato: { marginTop: espaco.xl, marginBottom: espaco.sm },
  faq: { paddingVertical: 13 },
  faqLinha: { flexDirection: 'row', alignItems: 'center', gap: espaco.md, minHeight: 22 },
  chevronAberto: { transform: [{ rotate: '180deg' }] },
  resposta: { marginTop: espaco.sm, lineHeight: 19 },
  rodape: { marginTop: espaco.lg, letterSpacing: 0.5 },
});
