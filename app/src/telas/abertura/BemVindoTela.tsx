/**
 * Handoff 3a (`bemvindo`) — a primeira tela depois de entrar: confirma a conta e
 * já configura os alertas, em vez de deixar isso enterrado em Perfil.
 *
 * A configuração é a MESMA de Perfil → Alertas de preço (`PainelAlertas` sobre
 * `meta.PreferenciasAlerta`): mexer aqui reflete lá, como no protótipo.
 *
 * Aparece uma vez por aparelho (`meta.obterAberturaEm`) — a permissão de câmera
 * e a região que vêm depois são do APARELHO, não da conta.
 */

import { useEffect, useState } from 'react';
import { ScrollView, StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { useAuth } from '@/auth';
import { Botao, Eyebrow, IconeCheck, PainelAlertas, Texto } from '@/componentes';
import { meta } from '@/dados';
import { PREFERENCIAS_ALERTA_PADRAO, type PreferenciasAlerta } from '@/dados/repositorio-meta';
import { espaco, raio, useTema } from '@/tema';

export interface BemVindoTelaProps {
  aoConcluir: () => void;
}

/** Primeiro nome informado (nunca derivado do email — ver PerfilTela). */
function primeiroNome(metadados: Record<string, unknown>): string | null {
  const bruto = ((metadados.nome ?? metadados.full_name ?? metadados.name ?? '') as string).trim();
  const parte = bruto.split(/[.\s_]+/)[0];
  if (!parte) return null;
  return parte.charAt(0).toUpperCase() + parte.slice(1);
}

export function BemVindoTela({ aoConcluir }: BemVindoTelaProps) {
  const { c } = useTema();
  const { usuario } = useAuth();
  const [preferencias, setPreferencias] = useState<PreferenciasAlerta>(PREFERENCIAS_ALERTA_PADRAO);

  useEffect(() => {
    let vivo = true;
    void meta.obterPreferenciasAlerta().then((p) => {
      if (vivo) setPreferencias(p);
    });
    return () => {
      vivo = false;
    };
  }, []);

  const nome = primeiroNome(usuario?.user_metadata ?? {});

  async function concluir(salvando: boolean) {
    if (salvando) await meta.definirPreferenciasAlerta(preferencias);
    aoConcluir();
  }

  return (
    <SafeAreaView style={[estilos.raiz, { backgroundColor: c.fundo }]} edges={['top', 'bottom']}>
      <ScrollView
        contentContainerStyle={estilos.conteudo}
        showsVerticalScrollIndicator={false}
        keyboardShouldPersistTaps="handled"
      >
        <View style={[estilos.selo, { backgroundColor: c.teal }]}>
          <IconeCheck tamanho={30} cor={c.sobreTeal} larguraTraco={2} />
        </View>

        <Texto peso="bold" style={estilos.titulo}>
          {nome ? `Bem-vindo, ${nome}!` : 'Bem-vindo!'}
        </Texto>
        <Texto cor="suave" style={estilos.apoio}>
          Sua conta está pronta. Escolha como quer ser avisado quando os preços mexerem — dá para
          mudar tudo depois em Perfil.
        </Texto>

        <Eyebrow style={estilos.eyebrow}>Configurar alertas</Eyebrow>

        <PainelAlertas preferencias={preferencias} aoMudar={setPreferencias} />
      </ScrollView>

      <View style={estilos.acoes}>
        <Botao titulo="Tudo pronto, começar" bloco onPress={() => void concluir(true)} />
        <Botao
          titulo="Configurar depois"
          variante="fantasma"
          bloco
          onPress={() => void concluir(false)}
        />
      </View>
    </SafeAreaView>
  );
}

const estilos = StyleSheet.create({
  raiz: { flex: 1 },
  conteudo: { paddingHorizontal: espaco.xxl, paddingTop: espaco.xl, paddingBottom: espaco.lg },
  selo: {
    width: 60,
    height: 60,
    borderRadius: raio.cartao,
    alignItems: 'center',
    justifyContent: 'center',
  },
  titulo: { fontSize: 30, lineHeight: 34, letterSpacing: -1.2, marginTop: espaco.xl - 2 },
  apoio: { fontSize: 14, lineHeight: 22, marginTop: espaco.sm },
  eyebrow: { marginTop: espaco.xxl - 4, marginBottom: espaco.sm + 2 },
  acoes: { paddingHorizontal: espaco.xxl, paddingBottom: espaco.xl, gap: espaco.xs },
});
