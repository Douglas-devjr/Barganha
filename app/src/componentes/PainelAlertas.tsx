/**
 * Handoff 3a — o bloco de configuração de alertas: três chaves + a
 * sensibilidade. Aparece idêntico nas Boas-vindas e em Perfil → Alertas de
 * preço, compartilhando o MESMO estado (`bvAlertas`/`bvSens` no protótipo,
 * `meta.PreferenciasAlerta` aqui) — mexer num lugar reflete no outro.
 *
 * "Quando um produto baixar" é a chave-mestra de `nucleo/alertas`: desligada,
 * nada dispara. As outras duas guardam a escolha para quando os avisos
 * correspondentes existirem (ofertas dependem de C12.4; o resumo mensal, do
 * push agendado da v2) — a UI diz isso em vez de fingir que já funcionam.
 */

import { StyleSheet, Switch, View } from 'react-native';

import type { PreferenciasAlerta, Sensibilidade } from '@/dados/repositorio-meta';
import { espaco, raio, useTema } from '@/tema';

import { Cartao } from './Cartao';
import { IconeEtiqueta, IconeSetaBaixo, IconeTrofeu } from './icones';
import { CartaoLista } from './layout3a';
import { Segmentado } from './Segmentado';
import { Texto } from './Texto';

const SENSIBILIDADES: readonly { valor: Sensibilidade; rotulo: string }[] = [
  { valor: 3, rotulo: '3%' },
  { valor: 5, rotulo: '5%' },
  { valor: 10, rotulo: '10%' },
];

export interface PainelAlertasProps {
  preferencias: PreferenciasAlerta;
  aoMudar: (p: PreferenciasAlerta) => void;
}

export function PainelAlertas({ preferencias, aoMudar }: PainelAlertasProps) {
  const { c } = useTema();

  const chaves = [
    {
      id: 'quandoBaixar' as const,
      Icone: IconeSetaBaixo,
      titulo: 'Quando um produto baixar',
      descricao: 'Aviso quando um item da sua lista cai de preço',
    },
    {
      id: 'ofertasPerto' as const,
      Icone: IconeEtiqueta,
      titulo: 'Ofertas perto de você',
      descricao: 'Preços baixos em mercados da sua região (em breve)',
    },
    {
      id: 'resumoMensal' as const,
      Icone: IconeTrofeu,
      titulo: 'Resumo mensal de descontos',
      descricao: 'Um recap dos descontos que você teve no mês (em breve)',
    },
  ];

  return (
    <>
      <CartaoLista>
        {chaves.map(({ id, Icone, titulo, descricao }, idx) => (
          <View
            key={id}
            style={[
              estilos.linha,
              idx < chaves.length - 1 && { borderBottomWidth: 1, borderBottomColor: c.linha },
            ]}
          >
            <View style={[estilos.tile, { backgroundColor: c.linha }]}>
              <Icone tamanho={17} cor={c.tinta} larguraTraco={2} />
            </View>

            <View style={estilos.texto}>
              <Texto peso="semibold" tamanho="sm">
                {titulo}
              </Texto>
              <Texto cor="fraco" tamanho="xs" style={estilos.descricao}>
                {descricao}
              </Texto>
            </View>

            <Switch
              value={preferencias[id]}
              onValueChange={(v) => aoMudar({ ...preferencias, [id]: v })}
              trackColor={{ false: c.linha, true: c.teal }}
              thumbColor={c.cartao}
              accessibilityLabel={titulo}
            />
          </View>
        ))}
      </CartaoLista>

      <Cartao style={estilos.cartaoSens}>
        <View style={estilos.sensTopo}>
          <Texto peso="semibold" tamanho="sm">
            Sensibilidade do alerta
          </Texto>
          <Texto peso="bold" style={estilos.sensValor}>
            {preferencias.sensibilidade}% abaixo
          </Texto>
        </View>
        <Texto cor="fraco" tamanho="xs" style={estilos.sensNota}>
          A partir de quanto abaixo do típico a gente te avisa.
        </Texto>
        <View style={estilos.sensSegmentado}>
          <Segmentado
            opcoes={SENSIBILIDADES}
            valor={preferencias.sensibilidade}
            aoMudar={(s) => aoMudar({ ...preferencias, sensibilidade: s })}
            rotuloGrupo="Sensibilidade do alerta"
          />
        </View>
      </Cartao>
    </>
  );
}

const estilos = StyleSheet.create({
  linha: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 13,
    paddingVertical: 14,
    minHeight: 44,
  },
  tile: {
    width: 36,
    height: 36,
    borderRadius: raio.sm,
    alignItems: 'center',
    justifyContent: 'center',
  },
  texto: { flex: 1, minWidth: 0 },
  descricao: { marginTop: 1, lineHeight: 15 },
  cartaoSens: { marginTop: espaco.md, padding: espaco.lg },
  sensTopo: { flexDirection: 'row', alignItems: 'baseline', justifyContent: 'space-between' },
  sensValor: { fontSize: 12 },
  sensNota: { marginTop: 2, lineHeight: 16 },
  sensSegmentado: { marginTop: espaco.md },
});
