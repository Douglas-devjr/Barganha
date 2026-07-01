/**
 * C8.2 — Perfil. Dados mínimos da conta (só o email do login), os mercados onde
 * você mais compra e as ações de conta: SAIR (encerra a sessão e limpa este
 * aparelho) e APAGAR CONTA (direito ao apagamento, docs/04). A região vem da
 * LOJA, nunca do usuário; os preços compartilhados seguem anônimos e soltos.
 */

import { useFocusEffect } from '@react-navigation/native';
import { useCallback, useState } from 'react';
import { Alert, StyleSheet, View } from 'react-native';

import { clienteApi } from '@/api';
import { useAuth } from '@/auth';
import { Botao, Cartao, IconeLoja, Tela, Texto } from '@/componentes';
import { cupons, produtos } from '@/dados';
import type { MercadoFrequente } from '@/dados/repositorio-cupom';
import { dataCurta } from '@/nucleo/formato';
import { cores, espaco, raio } from '@/tema';

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
  const { usuario, sair } = useAuth();
  const [dados, setDados] = useState<DadosPerfil>(VAZIO);
  const [ocupado, setOcupado] = useState(false);

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

  // Sair: encerra a sessão e limpa este aparelho (o gate volta para o login).
  function confirmarSaida() {
    Alert.alert('Sair da conta?', 'Você precisará entrar de novo para registrar cupons.', [
      { text: 'Cancelar', style: 'cancel' },
      { text: 'Sair', style: 'destructive', onPress: () => void sair() },
    ]);
  }

  // Apagar conta: remove o histórico no servidor (cascata) + encerra a sessão.
  async function apagarConta() {
    setOcupado(true);
    try {
      await clienteApi.apagarConta();
      await sair();
    } catch {
      setOcupado(false);
      Alert.alert('Não foi possível apagar agora', 'Verifique a conexão e tente de novo.');
    }
  }

  function confirmarExclusao() {
    Alert.alert(
      'Apagar conta?',
      'Isto remove sua conta e todo o seu histórico, no aparelho e no servidor. Não dá para ' +
        'desfazer. Os preços que você já compartilhou são anônimos e soltos — seguem ajudando a ' +
        'comunidade, sem ligação com você (LGPD).',
      [
        { text: 'Cancelar', style: 'cancel' },
        { text: 'Apagar conta', style: 'destructive', onPress: () => void apagarConta() },
      ],
    );
  }

  return (
    <Tela titulo="Perfil">
      <Cartao semPadding style={{ paddingHorizontal: espaco.lg }}>
        <Linha rotulo="Conta" valor={usuario?.email ?? '—'} />
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
        Guardamos só seu email para o login. Os preços que você compartilha entram anônimos e
        soltos, sem ligação com você (LGPD).
      </Texto>

      <Botao
        titulo="Sair"
        variante="secundario"
        bloco
        desabilitado={ocupado}
        onPress={confirmarSaida}
        style={{ marginTop: espaco.sm }}
      />
      <Botao
        titulo="Apagar conta"
        variante="fantasma"
        bloco
        carregando={ocupado}
        onPress={confirmarExclusao}
        style={{ marginTop: espaco.xs }}
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
