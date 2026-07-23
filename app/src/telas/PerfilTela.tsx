/**
 * C8.2 + Redesign "3a" — Perfil. Cabeçalho com avatar + nome + email; cartão de
 * conta (Região com "Editar" + Cupons escaneados + Aparência claro/escuro); os
 * mercados frequentes; e as ações de conta: SAIR (encerra a sessão e limpa este
 * aparelho) e APAGAR CONTA (direito ao apagamento, docs/04).
 *
 * A região escolhida mora só neste aparelho e serve apenas para recortar a
 * consulta anônima de preço — nunca viaja junto com dado privado (decisão #4).
 */

import Constants from 'expo-constants';
import { useFocusEffect, useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { useCallback, useState } from 'react';
import { Linking, Modal, Pressable, ScrollView, StyleSheet, Switch, View } from 'react-native';

import { clienteApi } from '@/api';
import { useAuth } from '@/auth';
import {
  Botao,
  CampoTexto,
  CartaoLista,
  Dialogo,
  IconeCadeado,
  IconeLixeira,
  IconeLoja,
  IconePino,
  IconeRecibo,
  IconeSino,
  IconeTema,
  IconeTrofeu,
  LinhaLista,
  Tela,
  Texto,
  useToast,
} from '@/componentes';
import { cache, cupons, fila, meta, produtos } from '@/dados';
import type { LocalEscolhido } from '@/dados/repositorio-meta';
import type { MercadoFrequente } from '@/dados/repositorio-cupom';
import type { RootStackParamList } from '@/navegacao/tipos';
import { dataCurta } from '@/nucleo/formato';
import { calcularContribuicao, type Contribuicao } from '@/nucleo/gamificacao';
import { UFS } from '@/nucleo/localizacao';
import { sincronizarEstatisticas } from '@/nucleo/sincronizador';
import { espaco, raio, useTema } from '@/tema';

/** Versão real do build (o protótipo trazia "2.0.1" como exemplo). */
const VERSAO = Constants.expoConfig?.version ?? '0.0.0';

/** Política publicada (site/, GitHub Pages) — "Privacidade dos dados" abre aqui. */
const URL_PRIVACIDADE =
  'https://douglas-devjr.github.io/barganha-legal/politica-de-privacidade.html';

interface DadosPerfil {
  escolhido: LocalEscolhido | null;
  ufHistorico: string | null;
  cuponsEscaneados: number;
  mercados: MercadoFrequente[];
  /** C12.2 — sequência de semanas + selos, do histórico local. */
  contribuicao: Contribuicao;
}

const VAZIO: DadosPerfil = {
  escolhido: null,
  ufHistorico: null,
  cuponsEscaneados: 0,
  mercados: [],
  contribuicao: calcularContribuicao([]),
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
  const navigation = useNavigation<NativeStackNavigationProp<RootStackParamList>>();
  const { usuario, sair } = useAuth();
  const { c } = useTema();
  const toast = useToast();
  const [dados, setDados] = useState<DadosPerfil>(VAZIO);
  const [ocupado, setOcupado] = useState(false);
  /** Chave-mestra dos alertas (linha "Alertas de preço" do handoff). */
  const [alertasLigados, setAlertasLigados] = useState(true);

  /** Diálogo de confirmação aberto (handoff 3a: `sair` | `conta`). */
  const [dialogo, setDialogo] = useState<'sair' | 'conta' | null>(null);
  /**
   * Cupons ainda na fila de upload quando o usuário pede para sair. Sair limpa
   * o aparelho, então eles se perdem — o diálogo precisa dizer isso ANTES.
   */
  const [pendentesAoSair, setPendentesAoSair] = useState(0);
  const [editando, setEditando] = useState(false);
  const [ufSel, setUfSel] = useState<string | null>(null);
  const [municipioInput, setMunicipioInput] = useState('');
  const [salvandoRegiao, setSalvandoRegiao] = useState(false);

  const carregar = useCallback(async () => {
    const [escolhido, ufHistorico, cuponsEscaneados, mercados, datas, ligados] = await Promise.all([
      meta.obterLocalEscolhido(),
      produtos.obterUfRecente(),
      cupons.contarCupons(),
      cupons.listarMercadosFrequentes(5),
      cupons.listarDatasCapturas(),
      meta.alertasAtivos(),
    ]);
    setAlertasLigados(ligados);
    return {
      escolhido,
      ufHistorico,
      cuponsEscaneados,
      mercados,
      contribuicao: calcularContribuicao(datas),
    };
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

  async function alternarAlertas(ligar: boolean) {
    setAlertasLigados(ligar);
    await meta.definirAlertasAtivos(ligar);
    toast(ligar ? 'Alertas de preço ligados' : 'Alertas de preço desligados');
  }

  async function apagarConta() {
    setOcupado(true);
    try {
      await clienteApi.apagarConta();
      await sair();
    } catch {
      setOcupado(false);
      setDialogo(null);
      toast('Não foi possível apagar agora. Verifique a conexão.');
    }
  }

  const nome = nomeDe(
    usuario?.email,
    (usuario?.user_metadata?.full_name ?? usuario?.user_metadata?.name) as string | undefined,
  );

  return (
    <Tela>
      <View style={estilos.cabecalho}>
        <View style={[estilos.avatar, { backgroundColor: c.tinta }]}>
          <Texto peso="bold" cor="sobreTeal" style={estilos.avatarLetra}>
            {nome.charAt(0)}
          </Texto>
        </View>
        <View style={{ flex: 1 }}>
          <Texto peso="bold" tamanho="xl" style={estilos.nome}>
            {nome}
          </Texto>
          <Texto cor="fraco" style={estilos.email} numberOfLines={1}>
            {usuario?.email ?? '—'}
          </Texto>
        </View>
      </View>

      {/* card de região */}
      <CartaoLista style={estilos.blocoTopo}>
        <LinhaLista
          icone={<IconePino tamanho={18} cor={c.tinta} />}
          titulo={descreverRegiao(dados)}
          subtitulo="Região usada nas comparações"
          chevron
          ultima
          onPress={abrirEditor}
        />
      </CartaoLista>

      {/* lista de ajustes */}
      <CartaoLista style={estilos.bloco}>
        <LinhaLista
          icone={<IconeTrofeu tamanho={18} cor={c.suave} />}
          titulo="Conquistas e prêmios"
          chevron
          direita={
            <Texto peso="bold" cor="fraco" numerico style={estilos.contador}>
              {dados.contribuicao.selos.filter((s) => s.conquistado).length}/
              {dados.contribuicao.selos.length}
            </Texto>
          }
          onPress={() => navigation.navigate('Conquistas')}
        />
        <LinhaLista
          icone={<IconeSino tamanho={18} cor={c.suave} />}
          titulo="Notificações"
          chevron
          onPress={() => navigation.navigate('Notificacoes')}
        />
        <LinhaLista
          icone={<IconeSino tamanho={18} cor={c.suave} />}
          titulo="Alertas de preço"
          direita={
            <Switch
              value={alertasLigados}
              onValueChange={(v) => void alternarAlertas(v)}
              trackColor={{ false: c.linha, true: c.tinta }}
              thumbColor={c.cartao}
              accessibilityLabel="Alertas de preço"
            />
          }
        />
        <LinhaLista
          icone={<IconeRecibo tamanho={18} cor={c.suave} />}
          titulo="Cupons escaneados"
          direita={
            <Texto peso="bold" cor="fraco" numerico style={estilos.contador}>
              {dados.cuponsEscaneados}
            </Texto>
          }
        />
        <LinhaLista
          icone={<IconeTema tamanho={18} cor={c.suave} />}
          titulo="Tema"
          direita={<SegmentadoTema />}
        />
        <LinhaLista
          icone={<IconeCadeado tamanho={18} cor={c.suave} />}
          titulo="Privacidade dos dados"
          chevron
          ultima
          onPress={() => void Linking.openURL(URL_PRIVACIDADE)}
        />
      </CartaoLista>

      <Texto cor="fraco" tamanho="xs" style={estilos.regiaoNota}>
        A região é usada só para achar os preços da sua cidade. Não é enviada com seus dados.
      </Texto>

      <Texto peso="bold" style={estilos.secao}>
        Seus mercados
      </Texto>
      {dados.mercados.length === 0 ? (
        <CartaoLista>
          <View style={estilos.vazio}>
            <Texto cor="suave" tamanho="sm" centralizado>
              Os mercados onde você mais compra aparecem aqui conforme você escaneia cupons.
            </Texto>
          </View>
        </CartaoLista>
      ) : (
        <CartaoLista>
          {dados.mercados.map((m, idx) => (
            <LinhaLista
              key={m.lojaNome}
              icone={<IconeLoja tamanho={18} cor={c.tinta} />}
              titulo={m.lojaNome}
              subtitulo={`${m.visitas} ${m.visitas === 1 ? 'compra' : 'compras'}${
                dataCurta(m.ultimaVisitaEm) ? ` · última em ${dataCurta(m.ultimaVisitaEm)}` : ''
              }`}
              ultima={idx === dados.mercados.length - 1}
            />
          ))}
        </CartaoLista>
      )}

      <Texto cor="fraco" tamanho="xs" centralizado style={estilos.nota}>
        Guardamos só seu email para o login. Os preços que você compartilha entram anônimos e
        soltos, sem ligação com você (LGPD).
      </Texto>

      <Botao
        titulo="Sair"
        variante="secundario"
        bloco
        desabilitado={ocupado}
        onPress={() => {
          // Consulta a fila antes de abrir: o texto do diálogo muda se houver
          // cupom que ainda não subiu.
          void fila
            .contarPendentes()
            .then(setPendentesAoSair)
            .catch(() => setPendentesAoSair(0));
          setDialogo('sair');
        }}
        style={{ marginTop: espaco.md }}
      />

      {/* Excluir conta: cartão próprio em `caro`, como no protótipo. */}
      <Pressable
        onPress={() => setDialogo('conta')}
        disabled={ocupado}
        accessibilityRole="button"
        style={[
          estilos.apagarConta,
          { backgroundColor: c.cartao, borderColor: c.cartaoBorda, opacity: ocupado ? 0.6 : 1 },
        ]}
      >
        <IconeLixeira tamanho={16} cor={c.caro} />
        <Texto peso="semibold" style={{ color: c.caro, fontSize: 13.5 }}>
          Excluir conta
        </Texto>
      </Pressable>

      <Texto cor="fraco" centralizado style={estilos.rodape}>
        BARGANHA V{VERSAO} · BASE COLABORATIVA
      </Texto>

      <Modal
        visible={editando}
        transparent
        animationType="fade"
        onRequestClose={() => setEditando(false)}
      >
        <Pressable
          style={[estilos.modalFundo, { backgroundColor: c.veu }]}
          onPress={() => setEditando(false)}
        >
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
                      cor={ativo ? 'sobreTeal' : 'suave'}
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

      <Dialogo
        visivel={dialogo === 'sair'}
        titulo="Sair da conta?"
        mensagem={
          (pendentesAoSair > 0
            ? `${pendentesAoSair} cupom(ns) ainda não foram enviados. Vamos tentar enviá-los ` +
              'agora; o que não subir será perdido. Conecte-se à internet antes, se puder. '
            : '') +
          'Você precisará entrar de novo para registrar cupons. O histórico deste aparelho é ' +
          'limpo; os preços já compartilhados são anônimos e continuam na base.'
        }
        rotuloConfirmar="Sair"
        aoConfirmar={() => {
          setDialogo(null);
          void sair();
        }}
        aoCancelar={() => setDialogo(null)}
      />

      <Dialogo
        visivel={dialogo === 'conta'}
        titulo="Apagar conta?"
        mensagem={
          'Isto remove sua conta e todo o seu histórico, no aparelho e no servidor. Não dá para ' +
          'desfazer. Os preços que você já compartilhou são anônimos e soltos — seguem ajudando ' +
          'a comunidade, sem ligação com você (LGPD).'
        }
        rotuloConfirmar="Apagar conta"
        icone={<IconeLixeira tamanho={24} cor={c.caro} />}
        ocupado={ocupado}
        aoConfirmar={() => void apagarConta()}
        aoCancelar={() => setDialogo(null)}
      />
    </Tela>
  );
}

/**
 * Segmentado Claro/Escuro do handoff. Fixa o modo (não volta a seguir o
 * sistema): quem toca aqui está escolhendo explicitamente.
 */
function SegmentadoTema() {
  const { c, escuro, definir } = useTema();
  const opcoes: { modo: 'claro' | 'escuro'; rotulo: string }[] = [
    { modo: 'claro', rotulo: 'Claro' },
    { modo: 'escuro', rotulo: 'Escuro' },
  ];

  return (
    <View style={[estilos.segmentado, { backgroundColor: c.linha }]}>
      {opcoes.map((o) => {
        const ativo = escuro === (o.modo === 'escuro');
        return (
          <Pressable
            key={o.modo}
            onPress={() => definir(o.modo)}
            accessibilityRole="button"
            accessibilityState={ativo ? { selected: true } : {}}
            style={[estilos.segmento, ativo && { backgroundColor: c.cartao }]}
          >
            <Texto peso="semibold" cor={ativo ? 'tinta' : 'suave'} style={estilos.segmentoTexto}>
              {o.rotulo}
            </Texto>
          </Pressable>
        );
      })}
    </View>
  );
}

const estilos = StyleSheet.create({
  cabecalho: { flexDirection: 'row', alignItems: 'center', gap: 14, paddingTop: espaco.xs },
  avatarLetra: { fontSize: 24 },
  nome: { letterSpacing: -0.5 },
  email: { fontSize: 12.5 },
  contador: { fontSize: 11 },
  segmentado: { flexDirection: 'row', borderRadius: 9, padding: 3 },
  segmento: {
    height: 26,
    paddingHorizontal: 12,
    borderRadius: 7,
    alignItems: 'center',
    justifyContent: 'center',
  },
  segmentoTexto: { fontSize: 11 },
  blocoTopo: { marginTop: 16 },
  bloco: { marginTop: 14 },
  rodape: { fontSize: 10.5, letterSpacing: 1, marginTop: 12 },
  apagarConta: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: espaco.sm,
    borderWidth: 1,
    borderRadius: raio.cartao,
    padding: 14,
    marginTop: 14,
    minHeight: 44,
  },
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
  contribuicaoTopo: { flexDirection: 'row', alignItems: 'center', marginBottom: espaco.md },
  linkConquistas: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: espaco.md,
    borderTopWidth: 1,
    paddingTop: espaco.lg,
    minHeight: 44,
  },
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
