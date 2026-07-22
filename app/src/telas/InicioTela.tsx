/**
 * C8.1 + Redesign "3a" — Início. Estrutura do protótipo: header (eyebrow
 * dia·cidade + saudação + sino e avatar em círculos de 44px), card de economia
 * chapado, atalho de conquistas e o cartão de "Últimas compras".
 *
 * Tudo do histórico PRIVADO local (offline); recarrega ao focar a aba para
 * refletir cupons recém-processados. A economia é o desconto honesto da própria
 * NFC-e, nunca estimativa — por isso os stats da linha inferior são contagens
 * reais e o card não projeta nada.
 */

import { useFocusEffect, useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { useCallback, useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';

import { useAuth } from '@/auth';
import {
  Botao,
  CartaoEconomia,
  CartaoLista,
  Eyebrow,
  IconeLoja,
  IconeRecibo,
  IconeSino,
  IconeTendenciaBaixo,
  IconeTrofeu,
  LinhaLista,
  Tela,
  Texto,
} from '@/componentes';
import { cupons, notificacoes } from '@/dados';
import type { CompraResumo, EconomiaMensal, ResumoCompras } from '@/dados/repositorio-cupom';
import { verificarAlertas, type AlertaDisparado } from '@/nucleo/alertas';
import { dataCurta, moeda } from '@/nucleo/formato';
import { calcularContribuicao, type Selo } from '@/nucleo/gamificacao';
import { resolverLocalizacao } from '@/nucleo/localizacao';
import { sincronizarFeed } from '@/nucleo/notificacoes';
import { espaco, raio, useTema } from '@/tema';
import type { RootStackParamList } from '@/navegacao/tipos';

type Navegacao = NativeStackNavigationProp<RootStackParamList>;

const RESUMO_VAZIO: ResumoCompras = {
  totalCupons: 0,
  totalItens: 0,
  gastoTotal: 0,
  economiaTotal: 0,
};

const DIAS = ['DOM', 'SEG', 'TER', 'QUA', 'QUI', 'SEX', 'SÁB'];
const MESES = ['JAN', 'FEV', 'MAR', 'ABR', 'MAI', 'JUN', 'JUL', 'AGO', 'SET', 'OUT', 'NOV', 'DEZ'];

/** Primeiro nome do usuário (metadados do Google ou parte local do email). */
function primeiroNome(nome?: string | null, email?: string | null): string {
  const bruto = (nome ?? email?.split('@')[0] ?? '').trim();
  const primeiro = bruto.split(/[.\s_]+/)[0];
  if (!primeiro) return 'por aí';
  return primeiro.charAt(0).toUpperCase() + primeiro.slice(1);
}

/** "SEG · 21 JUL · RIO DE JANEIRO" — cidade só entra quando conhecida. */
function eyebrowDe(cidade: string | null, agora = new Date()): string {
  const dia = `${DIAS[agora.getDay()]} · ${agora.getDate()} ${MESES[agora.getMonth()]}`;
  return cidade ? `${dia} · ${cidade.toUpperCase()}` : dia;
}

export function InicioTela() {
  const navigation = useNavigation<Navegacao>();
  const { usuario } = useAuth();
  const { c } = useTema();
  const [resumo, setResumo] = useState<ResumoCompras>(RESUMO_VAZIO);
  const [recentes, setRecentes] = useState<CompraResumo[]>([]);
  const [cidade, setCidade] = useState<string | null>(null);
  const [meses, setMeses] = useState<EconomiaMensal[]>([]);
  const [mercados, setMercados] = useState(0);
  const [disparos, setDisparos] = useState<AlertaDisparado[]>([]);
  const [selo, setSelo] = useState<Selo | null>(null);
  /** Ponto de não-lidas no sino do header. */
  const [naoLidas, setNaoLidas] = useState(0);

  useFocusEffect(
    useCallback(() => {
      let ativo = true;
      void (async () => {
        const [r, lista, local, porMes, alertas, lojas, datas] = await Promise.all([
          cupons.resumoCompras(),
          cupons.listarComprasRecentes(3),
          resolverLocalizacao(),
          cupons.economiaPorMes(2),
          verificarAlertas(),
          cupons.listarMercadosFrequentes(50),
          cupons.listarDatasCapturas(),
        ]);
        if (!ativo) return;
        setResumo(r);
        setRecentes(lista);
        setCidade(local?.municipio ?? local?.uf ?? null);
        setMeses(porMes);
        setDisparos(alertas);
        setMercados(lojas.length);

        // Conquista mais recente: a última da lista que já caiu.
        const conquistados = calcularContribuicao(datas).selos.filter((s) => s.conquistado);
        setSelo(conquistados.at(-1) ?? null);

        await sincronizarFeed(alertas);
        const pendentes = await notificacoes.contarNaoLidas();
        if (ativo) setNaoLidas(pendentes);
      })();
      return () => {
        ativo = false;
      };
    }, []),
  );

  const nome = primeiroNome(
    (usuario?.user_metadata?.full_name ?? usuario?.user_metadata?.name) as string | undefined,
    usuario?.email,
  );
  const inicial = nome.charAt(0).toUpperCase();
  const mesAtual = new Date().toISOString().slice(0, 7);
  const economiaMes = meses.find((m) => m.mes === mesAtual)?.economia ?? 0;

  return (
    <Tela>
      <View style={estilos.header}>
        <View style={{ flex: 1 }}>
          <Eyebrow>{eyebrowDe(cidade)}</Eyebrow>
          <Texto peso="bold" tamanho="titulo" style={estilos.saudacao}>
            Olá, {nome}
          </Texto>
        </View>

        <Pressable
          onPress={() => navigation.navigate('Notificacoes')}
          accessibilityRole="button"
          accessibilityLabel={naoLidas > 0 ? `Notificações, ${naoLidas} não lidas` : 'Notificações'}
          style={[estilos.circulo, { backgroundColor: c.cartao, borderColor: c.cartaoBorda }]}
        >
          <IconeSino tamanho={20} cor={c.tinta} />
          {naoLidas > 0 ? (
            <View style={[estilos.ponto, { backgroundColor: c.caro, borderColor: c.cartao }]} />
          ) : null}
        </Pressable>

        <Pressable
          onPress={() => navigation.navigate('Abas', { screen: 'Perfil' })}
          accessibilityRole="button"
          accessibilityLabel="Abrir perfil"
          style={[estilos.circulo, { backgroundColor: c.cartao, borderColor: c.cartaoBorda }]}
        >
          <Texto peso="bold" style={{ fontSize: 16 }}>
            {inicial}
          </Texto>
        </Pressable>
      </View>

      <Pressable
        onPress={() => navigation.navigate('Dashboard')}
        accessibilityRole="button"
        accessibilityLabel="Ver resumo de economia"
        style={estilos.blocoTopo}
      >
        <CartaoEconomia
          rotulo={`Economia · ${MESES[new Date().getMonth()]}`}
          valor={moeda(economiaMes)}
          legenda={legendaEconomia(resumo, economiaMes)}
          acao="Ver resumo →"
          stats={[
            `${resumo.totalItens} ${resumo.totalItens === 1 ? 'produto' : 'produtos'}`,
            `${mercados} ${mercados === 1 ? 'mercado' : 'mercados'}`,
            `${resumo.totalCupons} ${resumo.totalCupons === 1 ? 'cupom' : 'cupons'}`,
          ]}
        />
      </Pressable>

      {/* alerta de preço disparado tem prioridade sobre a conquista */}
      {disparos.length > 0 ? (
        <CartaoLista style={estilos.bloco}>
          {disparos.slice(0, 3).map((d, idx) => (
            <LinhaLista
              key={d.produtoCanonicoId}
              icone={<IconeTendenciaBaixo tamanho={18} cor={c.barato} />}
              titulo={`${d.nome} chegou ao seu alvo`}
              subtitulo={`${
                d.motivo === 'tipico'
                  ? `Típico na região ${moeda(d.mediana ?? 0)}`
                  : `Menor visto ${moeda(d.menorVisto ?? 0)}`
              } · alvo ${moeda(d.precoAlvo)}`}
              chevron
              ultima={idx === Math.min(disparos.length, 3) - 1}
              onPress={() =>
                navigation.navigate('ProdutoDetalhe', { chave: d.produtoCanonicoId, nome: d.nome })
              }
            />
          ))}
        </CartaoLista>
      ) : selo ? (
        <CartaoLista style={estilos.bloco}>
          <LinhaLista
            icone={<IconeTrofeu tamanho={18} cor={c.tinta} />}
            titulo={`Conquista: ${selo.titulo}`}
            subtitulo={selo.descricao}
            chevron
            ultima
            onPress={() => navigation.navigate('Conquistas')}
          />
        </CartaoLista>
      ) : null}

      <View style={estilos.secao}>
        <Texto peso="bold" style={estilos.secaoTitulo}>
          Últimas compras
        </Texto>
        {recentes.length > 0 ? (
          <Pressable
            onPress={() => navigation.navigate('Abas', { screen: 'Produtos' })}
            accessibilityRole="button"
            hitSlop={8}
          >
            <Texto peso="semibold" cor="suave" style={estilos.verTudo}>
              Ver tudo
            </Texto>
          </Pressable>
        ) : null}
      </View>

      {recentes.length === 0 ? (
        <VazioCompras aoEscanear={() => navigation.navigate('Scanner')} />
      ) : (
        <CartaoLista>
          {recentes.map((compra, idx) => (
            <LinhaLista
              key={compra.cupomLocalId}
              icone={<IconeLoja tamanho={18} cor={c.tinta} />}
              titulo={compra.lojaNome ?? 'Compra'}
              subtitulo={`${dataCurta(compra.observadoEm)}${
                compra.totalItens > 0
                  ? ` · ${compra.totalItens} ${compra.totalItens === 1 ? 'item' : 'itens'}`
                  : ''
              }`}
              ultima={idx === recentes.length - 1}
              direita={<ValorCompra compra={compra} />}
              onPress={() =>
                navigation.navigate('NotaFiscal', { cupomLocalId: compra.cupomLocalId })
              }
            />
          ))}
        </CartaoLista>
      )}
    </Tela>
  );
}

/** Preço + economia, alinhados à direita da linha de compra. */
function ValorCompra({ compra }: { compra: CompraResumo }) {
  // Cupom ainda na fila não tem total: mostra o estado em vez de "R$ 0,00".
  const processado = compra.status === 'processado';
  return (
    <View style={estilos.valorCompra}>
      {processado ? (
        <Texto peso="bold" tamanho="sm" numerico>
          {moeda(compra.valorTotal)}
        </Texto>
      ) : (
        <Texto cor="fraco" tamanho="xs">
          processando…
        </Texto>
      )}
      {compra.economia > 0 ? (
        <Texto cor="suave" numerico style={estilos.economia}>
          economia {moeda(compra.economia)}
        </Texto>
      ) : processado ? (
        <Texto cor="fraco" style={estilos.economia}>
          —
        </Texto>
      ) : null}
    </View>
  );
}

function legendaEconomia(resumo: ResumoCompras, economiaMes: number): string {
  if (resumo.totalCupons === 0) {
    return 'Escaneie um cupom para acompanhar suas compras e promoções.';
  }
  if (economiaMes > 0) return 'economizado em promoções este mês';
  return 'sem promoções registradas neste mês';
}

/** Estado vazio (primeiro uso): tile + apoio + botão primário. */
function VazioCompras({ aoEscanear }: { aoEscanear: () => void }) {
  const { c } = useTema();
  return (
    <CartaoLista>
      <View style={estilos.vazio}>
        <View style={[estilos.vazioIcone, { backgroundColor: c.linha }]}>
          <IconeRecibo tamanho={26} cor={c.tinta} />
        </View>
        <Texto peso="bold" centralizado style={{ marginTop: espaco.md }}>
          Nenhuma compra ainda
        </Texto>
        <Texto cor="suave" tamanho="sm" centralizado style={estilos.vazioTexto}>
          Escaneie o QR do seu cupom fiscal para montar seu histórico e alimentar os preços da sua
          região.
        </Texto>
        <Botao
          titulo="Escanear cupom"
          bloco
          onPress={aoEscanear}
          style={{ marginTop: espaco.lg }}
        />
      </View>
    </CartaoLista>
  );
}

const estilos = StyleSheet.create({
  header: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingTop: espaco.sm },
  saudacao: { letterSpacing: -0.8, marginTop: 3 },
  circulo: {
    width: 44,
    height: 44,
    borderRadius: raio.pill,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  ponto: {
    position: 'absolute',
    top: 9,
    right: 10,
    width: 8,
    height: 8,
    borderRadius: raio.pill,
    borderWidth: 2,
  },
  blocoTopo: { marginTop: espaco.lg },
  bloco: { marginTop: 14 },
  secao: {
    flexDirection: 'row',
    alignItems: 'baseline',
    justifyContent: 'space-between',
    marginTop: 18,
    marginBottom: 6,
  },
  secaoTitulo: { fontSize: 16, letterSpacing: -0.4 },
  verTudo: { fontSize: 12, textDecorationLine: 'underline' },
  valorCompra: { alignItems: 'flex-end' },
  economia: { fontSize: 10.5, marginTop: 1 },
  vazio: { alignItems: 'center', paddingVertical: espaco.lg },
  vazioIcone: {
    width: 56,
    height: 56,
    borderRadius: 28,
    alignItems: 'center',
    justifyContent: 'center',
  },
  vazioTexto: { marginTop: espaco.xs, lineHeight: 18, maxWidth: 280 },
});
