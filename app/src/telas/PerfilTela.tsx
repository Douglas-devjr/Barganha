/**
 * C8.2 + Redesign "2a" — Perfil. Cabeçalho com avatar + nome + email; cartão de
 * conta (Região com "Editar" + Cupons escaneados + Aparência claro/escuro); os
 * mercados frequentes; e as ações de conta: SAIR (encerra a sessão e limpa este
 * aparelho) e APAGAR CONTA (direito ao apagamento, docs/04).
 *
 * A região escolhida mora só neste aparelho e serve apenas para recortar a
 * consulta anônima de preço — nunca viaja junto com dado privado (decisão #4).
 */

import { useFocusEffect } from '@react-navigation/native';
import { useCallback, useState } from 'react';
import { Alert, Modal, Pressable, ScrollView, StyleSheet, Switch, View } from 'react-native';

import { clienteApi } from '@/api';
import { useAuth } from '@/auth';
import { Botao, CampoTexto, Cartao, IconeLoja, Tela, Texto } from '@/componentes';
import { cache, cupons, meta, produtos } from '@/dados';
import type { LocalEscolhido } from '@/dados/repositorio-meta';
import type { MercadoFrequente } from '@/dados/repositorio-cupom';
import { dataCurta } from '@/nucleo/formato';
import { UFS } from '@/nucleo/localizacao';
import { sincronizarEstatisticas } from '@/nucleo/sincronizador';
import { espaco, raio, useTema } from '@/tema';

interface DadosPerfil {
  escolhido: LocalEscolhido | null;
  ufHistorico: string | null;
  cuponsEscaneados: number;
  mercados: MercadoFrequente[];
}

const VAZIO: DadosPerfil = {
  escolhido: null,
  ufHistorico: null,
  cuponsEscaneados: 0,
  mercados: [],
};

function descreverRegiao(d: DadosPerfil): string {
  if (d.escolhido) {
    return d.escolhido.municipio ? `${d.escolhido.municipio} · ${d.escolhido.uf}` : d.escolhido.uf;
  }
  if (d.ufHistorico) return `${d.ufHistorico} (do histórico)`;
  return 'Toque para definir';
}

function nomeDe(email?: string | null, metaNome?: string | null): string {
  const bruto = (metaNome ?? email?.split('@')[0] ?? '').trim();
  const parte = bruto.split(/[.\s_]+/)[0];
  if (!parte) return 'Você';
  return parte.charAt(0).toUpperCase() + parte.slice(1);
}

export function PerfilTela() {
  const { usuario, sair } = useAuth();
  const { c, escuro, alternar } = useTema();
  const [dados, setDados] = useState<DadosPerfil>(VAZIO);
  const [ocupado, setOcupado] = useState(false);

  const [editando, setEditando] = useState(false);
  const [ufSel, setUfSel] = useState<string | null>(null);
  const [municipioInput, setMunicipioInput] = useState('');
  const [salvandoRegiao, setSalvandoRegiao] = useState(false);

  const carregar = useCallback(async () => {
    const [escolhido, ufHistorico, cuponsEscaneados, mercados] = await Promise.all([
      meta.obterLocalEscolhido(),
      produtos.obterUfRecente(),
      cupons.contarCupons(),
      cupons.listarMercadosFrequentes(5),
    ]);
    return { escolhido, ufHistorico, cuponsEscaneados, mercados };
  }, []);

  useFocusEffect(
    useCallback(() => {
      let ativo = true;
      void carregar().then((d) => {
        if (ativo) setDados(d);
      });
      return () => {
        ativo = false;
      };
    }, [carregar]),
  );

  function abrirEditor() {
    setUfSel(dados.escolhido?.uf ?? dados.ufHistorico ?? null);
    setMunicipioInput(dados.escolhido?.municipio ?? '');
    setEditando(true);
  }

  async function salvarRegiao() {
    if (!ufSel) return;
    setSalvandoRegiao(true);
    try {
      await meta.definirLocalEscolhido({
        uf: ufSel,
        municipio: municipioInput.trim() || undefined,
      });
      await meta.definirCursorDelta('');
      await cache.limpar();
      setEditando(false);
      setDados(await carregar());
      void sincronizarEstatisticas().catch(() => {});
    } finally {
      setSalvandoRegiao(false);
    }
  }

  function confirmarSaida() {
    Alert.alert('Sair da conta?', 'Você precisará entrar de novo para registrar cupons.', [
      { text: 'Cancelar', style: 'cancel' },
      { text: 'Sair', style: 'destructive', onPress: () => void sair() },
    ]);
  }

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

  const nome = nomeDe(
    usuario?.email,
    (usuario?.user_metadata?.full_name ?? usuario?.user_metadata?.name) as string | undefined,
  );

  return (
    <Tela>
      <View style={estilos.cabecalho}>
        <View style={[estilos.avatar, { backgroundColor: c.tealWash2 }]}>
          <Texto peso="extrabold" tamanho="titulo" cor="teal">
            {nome.charAt(0)}
          </Texto>
        </View>
        <Texto peso="extrabold" tamanho="titulo" style={{ marginTop: espaco.md }}>
          {nome}
        </Texto>
        <Texto cor="suave" tamanho="sm" style={{ marginTop: 2 }}>
          {usuario?.email ?? '—'}
        </Texto>
      </View>

      <Cartao semPadding style={{ paddingHorizontal: espaco.lg }}>
        <Pressable
          onPress={abrirEditor}
          style={[estilos.dado, { borderBottomWidth: 1, borderBottomColor: c.linha }]}
        >
          <Texto cor="suave">Região</Texto>
          <View style={estilos.regiaoValor}>
            <Texto peso="bold" cor={dados.escolhido ? 'tinta' : 'teal'}>
              {descreverRegiao(dados)}
            </Texto>
            <Texto tamanho="sm" peso="bold" cor="teal">
              Editar
            </Texto>
          </View>
        </Pressable>
        <View style={[estilos.dado, { borderBottomWidth: 1, borderBottomColor: c.linha }]}>
          <Texto cor="suave">Cupons escaneados</Texto>
          <Texto peso="bold">{String(dados.cuponsEscaneados)}</Texto>
        </View>
        <View style={estilos.dado}>
          <Texto cor="suave">Modo escuro</Texto>
          <Switch
            value={escuro}
            onValueChange={alternar}
            trackColor={{ true: c.teal, false: c.borda }}
            thumbColor={c.branco}
          />
        </View>
      </Cartao>
      <Texto cor="fraco" tamanho="sm" style={estilos.regiaoNota}>
        A região é usada só para achar os preços da sua cidade. Não é enviada com seus dados.
      </Texto>

      <Texto peso="extrabold" tamanho="lg" style={estilos.secao}>
        Seus mercados
      </Texto>
      {dados.mercados.length === 0 ? (
        <Cartao>
          <View style={estilos.vazio}>
            <Texto cor="suave" centralizado>
              Os mercados onde você mais compra aparecem aqui conforme você escaneia cupons.
            </Texto>
          </View>
        </Cartao>
      ) : (
        <Cartao semPadding>
          {dados.mercados.map((m, idx) => (
            <View
              key={m.lojaNome}
              style={[
                estilos.mercado,
                idx < dados.mercados.length - 1 && {
                  borderBottomWidth: 1,
                  borderBottomColor: c.linha,
                },
              ]}
            >
              <View style={[estilos.mercadoIcone, { backgroundColor: c.tealWash }]}>
                <IconeLoja tamanho={18} cor={c.teal} />
              </View>
              <View style={{ flex: 1 }}>
                <Texto peso="bold" numberOfLines={1}>
                  {m.lojaNome}
                </Texto>
                <Texto cor="fraco" tamanho="sm" style={{ marginTop: 2 }}>
                  {m.visitas} {m.visitas === 1 ? 'compra' : 'compras'}
                  {dataCurta(m.ultimaVisitaEm) ? ` · última em ${dataCurta(m.ultimaVisitaEm)}` : ''}
                </Texto>
              </View>
            </View>
          ))}
        </Cartao>
      )}

      <Texto cor="fraco" tamanho="sm" centralizado style={estilos.nota}>
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

      <Modal
        visible={editando}
        transparent
        animationType="fade"
        onRequestClose={() => setEditando(false)}
      >
        <Pressable style={estilos.modalFundo} onPress={() => setEditando(false)}>
          <Pressable
            style={[estilos.modalCartao, { backgroundColor: c.cartao }]}
            onPress={() => {}}
          >
            <Texto peso="extrabold" tamanho="lg">
              Sua região
            </Texto>
            <Texto cor="suave" tamanho="sm" style={{ marginTop: espaco.xs }}>
              Escolha o estado e, se quiser, a cidade — a comparação fica mais próxima da sua
              gôndola.
            </Texto>

            <Texto peso="semibold" tamanho="sm" cor="suave" style={estilos.rotuloUf}>
              Estado (UF)
            </Texto>
            <ScrollView
              horizontal
              showsHorizontalScrollIndicator={false}
              contentContainerStyle={estilos.ufChips}
            >
              {UFS.map((uf) => {
                const ativo = ufSel === uf;
                return (
                  <Pressable
                    key={uf}
                    onPress={() => setUfSel(uf)}
                    style={[
                      estilos.ufChip,
                      {
                        backgroundColor: ativo ? c.teal : c.cartao,
                        borderColor: ativo ? c.teal : c.borda,
                      },
                    ]}
                  >
                    <Texto
                      tamanho="sm"
                      peso={ativo ? 'bold' : 'semibold'}
                      cor={ativo ? 'branco' : 'suave'}
                    >
                      {uf}
                    </Texto>
                  </Pressable>
                );
              })}
            </ScrollView>

            <View style={{ marginTop: espaco.md }}>
              <CampoTexto
                rotulo="Cidade (opcional)"
                value={municipioInput}
                onChangeText={setMunicipioInput}
                placeholder="Ex.: Rio de Janeiro"
                autoCapitalize="words"
              />
            </View>

            <View style={{ marginTop: espaco.lg, gap: espaco.sm }}>
              <Botao
                titulo="Salvar região"
                bloco
                carregando={salvandoRegiao}
                desabilitado={!ufSel || salvandoRegiao}
                onPress={() => void salvarRegiao()}
              />
              <Botao
                titulo="Cancelar"
                variante="fantasma"
                bloco
                onPress={() => setEditando(false)}
              />
            </View>
          </Pressable>
        </Pressable>
      </Modal>
    </Tela>
  );
}

const estilos = StyleSheet.create({
  cabecalho: { alignItems: 'center', marginBottom: espaco.xl },
  avatar: {
    width: 60,
    height: 60,
    borderRadius: 30,
    alignItems: 'center',
    justifyContent: 'center',
  },
  dado: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: espaco.md,
  },
  regiaoValor: { flexDirection: 'row', alignItems: 'center', gap: espaco.sm },
  regiaoNota: { marginTop: espaco.xs, marginLeft: espaco.xs, lineHeight: 18 },
  secao: { marginTop: espaco.xl, marginBottom: espaco.sm },
  vazio: { alignItems: 'center', paddingVertical: espaco.lg },
  mercado: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: espaco.md,
    paddingHorizontal: espaco.lg,
    paddingVertical: espaco.md,
  },
  mercadoIcone: {
    width: 36,
    height: 36,
    borderRadius: raio.sm,
    alignItems: 'center',
    justifyContent: 'center',
  },
  nota: { marginTop: espaco.lg, lineHeight: 19 },
  modalFundo: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.5)',
    justifyContent: 'center',
    paddingHorizontal: espaco.lg,
  },
  modalCartao: { borderRadius: raio.hero, padding: espaco.lg },
  rotuloUf: { marginTop: espaco.lg, marginLeft: espaco.xs, marginBottom: espaco.sm },
  ufChips: { gap: espaco.xs, paddingRight: espaco.md },
  ufChip: {
    paddingHorizontal: espaco.md,
    paddingVertical: espaco.sm,
    borderRadius: raio.pill,
    borderWidth: 1,
  },
});
