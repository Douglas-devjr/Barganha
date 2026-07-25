/**
 * C8.2 + Redesign "3a" — Perfil. Cabeçalho com avatar + nome + email; cartão de
 * conta (Região com "Editar" + Cupons escaneados + Aparência claro/escuro); os
 * mercados frequentes; e as ações de conta: SAIR (encerra a sessão e limpa este
 * aparelho — o histórico fica guardado na conta e volta no próximo login) e
 * APAGAR CONTA (direito ao apagamento, docs/04).
 *
 * A região escolhida mora só neste aparelho e serve apenas para recortar a
 * consulta anônima de preço — nunca viaja junto com dado privado (decisão #4).
 */

import type { User } from '@supabase/supabase-js';
import Constants from 'expo-constants';
import { useFocusEffect, useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { useCallback, useState } from 'react';
import { Modal, Pressable, StyleSheet, View } from 'react-native';

import { useAuth } from '@/auth';
import {
  Botao,
  CampoTexto,
  CartaoLista,
  IconeCadeado,
  IconeInfo,
  IconeLoja,
  IconePerfil,
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
import { cupons, meta } from '@/dados';
import type { LocalEscolhido } from '@/dados/repositorio-meta';
import type { MercadoFrequente } from '@/dados/repositorio-cupom';
import type { RootStackParamList } from '@/navegacao/tipos';
import { dataCurta } from '@/nucleo/formato';
import { calcularContribuicao, type Contribuicao } from '@/nucleo/gamificacao';
import { localDoHistorico, type LocalizacaoEfetiva } from '@/nucleo/localizacao';
import { espaco, raio, useTema } from '@/tema';

/** Versão real do build (o protótipo trazia "2.0.1" como exemplo). */
const VERSAO = Constants.expoConfig?.version ?? '0.0.0';

interface DadosPerfil {
  escolhido: LocalEscolhido | null;
  localHistorico: LocalizacaoEfetiva | null;
  cuponsEscaneados: number;
  mercados: MercadoFrequente[];
  /** C12.2 — sequência de semanas + selos, do histórico local. */
  contribuicao: Contribuicao;
}

const VAZIO: DadosPerfil = {
  escolhido: null,
  localHistorico: null,
  cuponsEscaneados: 0,
  mercados: [],
  contribuicao: calcularContribuicao([]),
};

function descreverRegiao(d: DadosPerfil): string {
  if (d.escolhido) {
    return d.escolhido.municipio ? `${d.escolhido.municipio} · ${d.escolhido.uf}` : d.escolhido.uf;
  }
  if (d.localHistorico) {
    const { uf, municipio } = d.localHistorico;
    return municipio ? `${municipio} · ${uf} (do histórico)` : `${uf} (do histórico)`;
  }
  return 'Toque para definir';
}

/**
 * Nome de exibição — do que o usuário informou, nunca do email.
 *
 * O fallback anterior era `email.split('@')[0]`, que transformava
 * "knowenter@gmail.com" em "Knowenter": um identificador de máquina exibido como
 * se fosse o nome da pessoa. Pior que não ter nome, porque parece um erro do app.
 * Sem nome informado, devolve `null` e a UI usa uma saudação neutra.
 *
 * Ordem: o que a pessoa digitou aqui (`nome`) ganha do que o Google mandou
 * (`full_name`/`name`) — ela pode ter editado justamente para mudar aquilo.
 */
function nomeDe(usuario: User | null): string | null {
  const meta = usuario?.user_metadata ?? {};
  const bruto = ((meta.nome ?? meta.full_name ?? meta.name ?? '') as string).trim();
  const parte = bruto.split(/[.\s_]+/)[0];
  if (!parte) return null;
  return parte.charAt(0).toUpperCase() + parte.slice(1);
}

export function PerfilTela() {
  const navigation = useNavigation<NativeStackNavigationProp<RootStackParamList>>();
  const { usuario, definirNomeExibicao } = useAuth();
  const { c } = useTema();
  const toast = useToast();
  const [dados, setDados] = useState<DadosPerfil>(VAZIO);
  const [editandoNome, setEditandoNome] = useState(false);
  const [nomeInput, setNomeInput] = useState('');
  const [salvandoNome, setSalvandoNome] = useState(false);
  /** Só o resumo "Ligados/Desligados" da linha de Alertas (edição vive em `Alertas`). */
  const [alertasLigados, setAlertasLigados] = useState(true);

  const carregar = useCallback(async () => {
    const [escolhido, localHistorico, cuponsEscaneados, mercados, datas, ligados] =
      await Promise.all([
        meta.obterLocalEscolhido(),
        localDoHistorico(),
        cupons.contarCupons(),
        cupons.listarMercadosFrequentes(5),
        cupons.listarDatasContribuicao(),
        meta.alertasAtivos(),
      ]);
    setAlertasLigados(ligados);
    return {
      escolhido,
      localHistorico,
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

  async function salvarNome() {
    setSalvandoNome(true);
    const r = await definirNomeExibicao(nomeInput);
    setSalvandoNome(false);
    if (r.erro) return toast(r.erro);
    // O `usuario` do contexto vem do listener de auth do supabase-js, que
    // reemite a sessão após o updateUser — a tela reflete sozinha.
    setEditandoNome(false);
    toast(nomeInput.trim() ? 'Nome atualizado' : 'Nome removido');
  }

  const nome = nomeDe(usuario);
  // Sem nome: o avatar mostra o ícone de pessoa em vez de uma inicial tirada do
  // email, e o título vira um convite a preencher.
  const exibicao = nome ?? 'Definir meu nome';

  return (
    <Tela>
      <Pressable
        style={estilos.cabecalho}
        onPress={() => {
          setNomeInput(nome ?? '');
          setEditandoNome(true);
        }}
        accessibilityRole="button"
        accessibilityLabel="Editar nome de exibição"
      >
        <View style={[estilos.avatar, { backgroundColor: c.tinta }]}>
          {nome ? (
            <Texto peso="bold" cor="sobreTeal" style={estilos.avatarLetra}>
              {nome.charAt(0)}
            </Texto>
          ) : (
            <IconePerfil tamanho={22} cor={c.sobreTeal} />
          )}
        </View>
        <View style={{ flex: 1 }}>
          <Texto peso="bold" tamanho="xl" cor={nome ? 'tinta' : 'suave'} style={estilos.nome}>
            {exibicao}
          </Texto>
          <Texto cor="fraco" style={estilos.email} numberOfLines={1}>
            {usuario?.email ?? '—'}
          </Texto>
        </View>
      </Pressable>

      <Modal
        visible={editandoNome}
        transparent
        animationType="fade"
        onRequestClose={() => setEditandoNome(false)}
      >
        <Pressable
          style={[estilos.modalFundo, { backgroundColor: c.veu }]}
          onPress={() => setEditandoNome(false)}
        >
          <Pressable
            style={[estilos.modalCartao, { backgroundColor: c.cartao }]}
            onPress={() => {}}
          >
            <Texto peso="extrabold" tamanho="lg">
              Como quer ser chamado?
            </Texto>
            <Texto cor="suave" tamanho="sm" style={estilos.modalApoio}>
              Só aparece para você, dentro do app. Deixe em branco para não usar nome.
            </Texto>
            <CampoTexto
              rotulo="Nome"
              value={nomeInput}
              onChangeText={setNomeInput}
              placeholder="Seu primeiro nome"
              autoCapitalize="words"
              editable={!salvandoNome}
            />
            <View style={estilos.modalAcoes}>
              <Botao
                titulo="Cancelar"
                variante="secundario"
                onPress={() => setEditandoNome(false)}
              />
              <Botao titulo="Salvar" carregando={salvandoNome} onPress={() => void salvarNome()} />
            </View>
          </Pressable>
        </Pressable>
      </Modal>

      {/* card de região */}
      <CartaoLista style={estilos.blocoTopo}>
        <LinhaLista
          icone={<IconePino tamanho={18} cor={c.tinta} />}
          titulo={descreverRegiao(dados)}
          subtitulo="Região usada nas comparações"
          chevron
          ultima
          onPress={() => navigation.navigate('EditarRegiao')}
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
          subtitulo={alertasLigados ? 'Ligados' : 'Desligados'}
          chevron
          onPress={() => navigation.navigate('Alertas')}
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
          titulo="Configurações da conta"
          chevron
          onPress={() => navigation.navigate('ConfiguracoesConta')}
        />
        <LinhaLista
          icone={<IconeInfo tamanho={18} cor={c.suave} />}
          titulo="Ajuda e suporte"
          chevron
          ultima
          onPress={() => navigation.navigate('Ajuda')}
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
        soltos, sem ligação com você (LGPD). Para sair ou excluir a conta, use Configurações da
        conta.
      </Texto>

      <Texto cor="fraco" centralizado style={estilos.rodape}>
        BARGANHA V{VERSAO} · BASE COLABORATIVA
      </Texto>
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
  modalApoio: { marginTop: espaco.xs, marginBottom: espaco.md },
  modalAcoes: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    gap: espaco.sm,
    marginTop: espaco.md,
  },
  rotuloUf: { marginTop: espaco.lg, marginLeft: espaco.xs, marginBottom: espaco.sm },
  ufChips: { gap: espaco.xs, paddingRight: espaco.md },
  ufChip: {
    paddingHorizontal: espaco.md,
    paddingVertical: espaco.sm,
    borderRadius: raio.pill,
    borderWidth: 1,
  },
});
