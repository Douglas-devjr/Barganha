/**
 * C8.2 — Perfil. Dados mínimos da conta anônima, os mercados onde você mais
 * compra e a ação de sair (apaga os dados locais). Tudo derivado do histórico
 * PRIVADO local; nada aqui expõe identidade — a conta é anônima de nascença e a
 * região vem da LOJA, nunca do usuário (decisões travadas, docs/04).
 */

import { useFocusEffect, useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { useCallback, useState } from 'react';
import { Alert, StyleSheet, View } from 'react-native';

import { Botao, Cartao, IconeLoja, Tela, Texto } from '@/componentes';
import { cupons, produtos } from '@/dados';
import type { MercadoFrequente } from '@/dados/repositorio-cupom';
import { redefinirAppLocal } from '@/nucleo/conta';
import { dataCurta } from '@/nucleo/formato';
import { cores, espaco, raio } from '@/tema';
import type { RootStackParamList } from '@/navegacao/tipos';

type Navegacao = NativeStackNavigationProp<RootStackParamList>;

interface DadosPerfil {
  uf: string | null;
  cuponsEscaneados: number;
  mercados: MercadoFrequente[];
}

const VAZIO: DadosPerfil = { uf: null, cuponsEscaneados: 0, mercados: [] };

function Linha({ rotulo, valor }: { rotulo: string; valor: string }) {
  return (
    <View style={estilos.dado}>
      <Texto cor="textoSuave">{rotulo}</Texto>
      <Texto peso="bold">{valor}</Texto>
    </View>
  );
}

export function PerfilTela() {
  const navigation = useNavigation<Navegacao>();
  const [dados, setDados] = useState<DadosPerfil>(VAZIO);

  useFocusEffect(
    useCallback(() => {
      let ativo = true;
      void (async () => {
        const [uf, cuponsEscaneados, mercados] = await Promise.all([
          produtos.obterUfRecente(),
          cupons.contarCupons(),
          cupons.listarMercadosFrequentes(5),
        ]);
        if (!ativo) return;
        setDados({ uf, cuponsEscaneados, mercados });
      })();
      return () => {
        ativo = false;
      };
    }, []),
  );

  async function sair() {
    await redefinirAppLocal();
    navigation.reset({ index: 0, routes: [{ name: 'Onboarding' }] });
  }

  function confirmarSaida() {
    Alert.alert(
      'Sair e apagar dados?',
      'Isto remove deste aparelho seu histórico, o cache e a conta anônima. Os preços que você já ' +
        'compartilhou são anônimos e soltos — seguem ajudando a comunidade, sem ligação com você.',
      [
        { text: 'Cancelar', style: 'cancel' },
        { text: 'Sair', style: 'destructive', onPress: () => void sair() },
      ],
    );
  }

  return (
    <Tela titulo="Perfil">
      <Cartao semPadding style={{ paddingHorizontal: espaco.lg }}>
        <Linha rotulo="Conta" valor="Anônima" />
        <Linha rotulo="Região (UF)" valor={dados.uf ?? '—'} />
        <Linha rotulo="Cupons escaneados" valor={String(dados.cuponsEscaneados)} />
      </Cartao>

      <Texto peso="extrabold" tamanho="lg" style={estilos.secao}>
        Seus mercados
      </Texto>
      {dados.mercados.length === 0 ? (
        <Cartao>
          <View style={estilos.vazio}>
            <Texto cor="textoMudo" centralizado>
              Os mercados onde você mais compra aparecem aqui conforme você escaneia cupons.
            </Texto>
          </View>
        </Cartao>
      ) : (
        <Cartao semPadding>
          {dados.mercados.map((m, idx) => (
            <View
              key={m.lojaNome}
              style={[estilos.mercado, idx < dados.mercados.length - 1 && estilos.mercadoBorda]}
            >
              <View style={estilos.mercadoIcone}>
                <IconeLoja tamanho={18} cor={cores.marca} />
              </View>
              <View style={{ flex: 1 }}>
                <Texto peso="semibold" numberOfLines={1}>
                  {m.lojaNome}
                </Texto>
                <Texto cor="textoMudo" tamanho="sm" style={{ marginTop: 2 }}>
                  {m.visitas} {m.visitas === 1 ? 'compra' : 'compras'}
                  {dataCurta(m.ultimaVisitaEm) ? ` · última em ${dataCurta(m.ultimaVisitaEm)}` : ''}
                </Texto>
              </View>
            </View>
          ))}
        </Cartao>
      )}

      <Texto cor="textoMudo" tamanho="sm" centralizado style={estilos.nota}>
        Sua conta é anônima: não guardamos nome nem CPF. Os preços que você compartilha entram
        soltos, sem ligação com você (LGPD).
      </Texto>

      <Botao
        titulo="Sair e apagar dados"
        variante="fantasma"
        bloco
        onPress={confirmarSaida}
        style={{ marginTop: espaco.sm }}
      />
    </Tela>
  );
}

const estilos = StyleSheet.create({
  dado: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: espaco.md,
  },
  secao: { marginTop: espaco.xl, marginBottom: espaco.sm },
  vazio: { alignItems: 'center', paddingVertical: espaco.lg },
  mercado: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: espaco.md,
    paddingHorizontal: espaco.lg,
    paddingVertical: espaco.md,
  },
  mercadoBorda: { borderBottomWidth: 1, borderBottomColor: cores.borda },
  mercadoIcone: {
    width: 36,
    height: 36,
    borderRadius: raio.md,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: cores.marcaBgClaro,
  },
  nota: { marginTop: espaco.lg, lineHeight: 19 },
});
