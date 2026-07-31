/**
 * Handoff 3a (`alertas`) — Perfil → Alertas de preço. Mesma UI das Boas-vindas
 * (`PainelAlertas`) sobre o mesmo estado: quem configurou na abertura reencontra
 * aqui exatamente o que escolheu.
 *
 * "Quando um produto baixar" é a chave-mestra de `nucleo/alertas`: desligada,
 * nada dispara e os alvos por produto continuam guardados.
 */

import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { useEffect, useState } from 'react';
import { StyleSheet } from 'react-native';

import {
  BloqueioPlus,
  Botao,
  CabecalhoVoltar,
  PainelAlertas,
  Tela,
  Texto,
  useToast,
} from '@/componentes';
import { alertas as alertasRepo, meta } from '@/dados';
import { PREFERENCIAS_ALERTA_PADRAO, type PreferenciasAlerta } from '@/dados/repositorio-meta';
import type { RootStackParamList } from '@/navegacao/tipos';
import { usePlano } from '@/plano';
import { espaco } from '@/tema';

type Props = NativeStackScreenProps<RootStackParamList, 'Alertas'>;

export function AlertasTela({ navigation }: Props) {
  const toast = useToast();
  const { plus, limiteDe, mostrarPlus } = usePlano();
  const [preferencias, setPreferencias] = useState<PreferenciasAlerta>(PREFERENCIAS_ALERTA_PADRAO);
  const [quantosAlvos, setQuantosAlvos] = useState(0);
  const [salvando, setSalvando] = useState(false);

  useEffect(() => {
    let vivo = true;
    void (async () => {
      const [p, alvos] = await Promise.all([meta.obterPreferenciasAlerta(), alertasRepo.listar()]);
      if (!vivo) return;
      setPreferencias(p);
      setQuantosAlvos(alvos.length);
    })();
    return () => {
      vivo = false;
    };
  }, []);

  async function salvar() {
    setSalvando(true);
    try {
      await meta.definirPreferenciasAlerta(preferencias);
      toast('Preferências salvas');
      navigation.goBack();
    } finally {
      setSalvando(false);
    }
  }

  return (
    <Tela>
      <CabecalhoVoltar
        titulo="Alertas de preço"
        subtitulo="Preferências"
        aoVoltar={() => navigation.goBack()}
      />

      <Texto cor="suave" tamanho="sm" style={estilos.intro}>
        Escolha quando quer ser avisado — os mesmos alertas que você configurou ao criar a conta.
      </Texto>

      <PainelAlertas preferencias={preferencias} aoMudar={setPreferencias} />

      <Texto cor="fraco" tamanho="xs" style={estilos.nota}>
        {quantosAlvos === 0
          ? 'Você ainda não definiu um alvo de preço. Abra um produto e toque em “Avisar quando baixar”.'
          : quantosAlvos === 1
            ? '1 produto com alvo de preço definido.'
            : `${quantosAlvos} produtos com alvo de preço definido.`}
        {plus ? '' : ` Seu plano permite ${limiteDe('alertas')}.`}
      </Texto>

      {/* C13.5 — o teto aparece aqui, onde a pessoa administra os alertas. */}
      {!plus && quantosAlvos >= limiteDe('alertas') ? (
        <BloqueioPlus
          titulo="Alertas ilimitados"
          texto="Acompanhe quantos produtos quiser, sem escolher quais cabem."
          onPress={mostrarPlus}
          style={estilos.bloqueio}
        />
      ) : null}

      <Botao
        titulo="Salvar preferências"
        bloco
        carregando={salvando}
        onPress={() => void salvar()}
        style={estilos.salvar}
      />
    </Tela>
  );
}

const estilos = StyleSheet.create({
  intro: { lineHeight: 19, marginBottom: espaco.md },
  nota: { marginTop: espaco.md, marginLeft: espaco.xs, lineHeight: 16 },
  bloqueio: { marginTop: espaco.md },
  salvar: { marginTop: espaco.lg },
});
