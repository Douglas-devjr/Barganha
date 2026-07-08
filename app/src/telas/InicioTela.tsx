/**
 * C8.1 + Redesign "2a" — Início. Header (eyebrow dia·cidade, saudação, avatar) +
 * hero de economia (descontos de promoção já registrados nos cupons) + 2 stats +
 * lista das Últimas compras. Tudo do histórico PRIVADO local (offline); recarrega
 * ao focar a aba para refletir cupons recém-processados.
 *
 * "Economia acumulada/tendência" mais rica é C8.3/C8.4 (Pós); aqui o número é o
 * desconto honesto da própria NFC-e, nunca uma estimativa — por isso o hero não
 * mostra o chip de delta enquanto não houver comparação mês a mês.
 */

import { useFocusEffect, useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { useCallback, useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';

import { useAuth } from '@/auth';
import {
  Botao,
  Cartao,
  CartaoEconomia,
  CartaoStat,
  IconeChevron,
  IconeLoja,
  IconeRecibo,
  Tela,
  Texto,
} from '@/componentes';
import { cupons } from '@/dados';
import type { CompraResumo, ResumoCompras } from '@/dados/repositorio-cupom';
import { dataCurta, moeda } from '@/nucleo/formato';
import { resolverLocalizacao } from '@/nucleo/localizacao';
import { espaco, raio, useTema } from '@/tema';
import type { RootStackParamList } from '@/navegacao/tipos';

type Navegacao = NativeStackNavigationProp<RootStackParamList>;

const RESUMO_VAZIO: ResumoCompras = {
  totalCupons: 0,
  totalItens: 0,
  gastoTotal: 0,
  economiaTotal: 0,
};

const DIAS = ['Domingo', 'Segunda', 'Terça', 'Quarta', 'Quinta', 'Sexta', 'Sábado'];

/** Primeiro nome do usuário (metadados do Google ou parte local do email). */
function primeiroNome(nome?: string | null, email?: string | null): string {
  const bruto = (nome ?? email?.split('@')[0] ?? '').trim();
  const primeiro = bruto.split(/[.\s_]+/)[0];
  if (!primeiro) return 'por aí';
  return primeiro.charAt(0).toUpperCase() + primeiro.slice(1);
}

export function InicioTela() {
  const navigation = useNavigation<Navegacao>();
  const { usuario } = useAuth();
  const { c } = useTema();
  const [resumo, setResumo] = useState<ResumoCompras>(RESUMO_VAZIO);
  const [recentes, setRecentes] = useState<CompraResumo[]>([]);
  const [cidade, setCidade] = useState<string | null>(null);

  useFocusEffect(
    useCallback(() => {
      let ativo = true;
      void (async () => {
        const [r, lista, local] = await Promise.all([
          cupons.resumoCompras(),
          cupons.listarComprasRecentes(6),
          resolverLocalizacao(),
        ]);
        if (!ativo) return;
        setResumo(r);
        setRecentes(lista);
        setCidade(local?.municipio ?? local?.uf ?? null);
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
  const eyebrow = [DIAS[new Date().getDay()], cidade].filter(Boolean).join(' · ').toUpperCase();
  const inicial = nome.charAt(0).toUpperCase();

  return (
    <Tela>
      <View style={estilos.header}>
        <View style={estilos.headerTexto}>
          <Texto peso="bold" cor="fraco" style={estilos.eyebrow}>
            {eyebrow}
          </Texto>
          <Texto peso="extrabold" tamanho="titulo" style={estilos.saudacao}>
            Olá, {nome} 👋
          </Texto>
        </View>
        <View style={[estilos.avatar, { backgroundColor: c.tealWash2 }]}>
          <Texto peso="extrabold" tamanho="lg" cor="teal">
            {inicial}
          </Texto>
        </View>
      </View>

      <CartaoEconomia
        rotulo="Economia em promoções"
        valor={moeda(resumo.economiaTotal)}
        legenda={legendaEconomia(resumo)}
        pilula="Total"
      />

      <View style={estilos.stats}>
        <CartaoStat
          numero={String(resumo.totalCupons)}
          legenda={resumo.totalCupons === 1 ? 'Cupom escaneado' : 'Cupons escaneados'}
          icone={<IconeRecibo tamanho={18} cor={c.teal} />}
        />
        <CartaoStat
          numero={String(resumo.totalItens)}
          legenda={resumo.totalItens === 1 ? 'Item registrado' : 'Itens registrados'}
          icone={<IconeLoja tamanho={18} cor={c.teal} />}
        />
      </View>

      <View style={estilos.secao}>
        <Texto peso="extrabold" tamanho="lg" style={estilos.secaoTitulo}>
          Últimas compras
        </Texto>
        {recentes.length > 0 ? (
          <Texto peso="bold" tamanho="sm" cor="teal">
            Ver tudo
          </Texto>
        ) : null}
      </View>

      {recentes.length === 0 ? (
        <VazioCompras aoEscanear={() => navigation.navigate('Scanner')} />
      ) : (
        <Cartao semPadding>
          {recentes.map((compra, idx) => (
            <CompraLinha
              key={compra.cupomLocalId}
              compra={compra}
              ultima={idx === recentes.length - 1}
              aoAbrir={() =>
                navigation.navigate('NotaFiscal', { cupomLocalId: compra.cupomLocalId })
              }
            />
          ))}
        </Cartao>
      )}
    </Tela>
  );
}

function legendaEconomia(resumo: ResumoCompras): string {
  if (resumo.totalCupons === 0) {
    return 'Comece escaneando um cupom para acompanhar suas compras e promoções.';
  }
  if (resumo.economiaTotal > 0) {
    const n = resumo.totalCupons;
    return `Em descontos de promoção nos seus ${n} ${n === 1 ? 'cupom' : 'cupons'}.`;
  }
  return 'Ainda não vimos promoções nos seus cupons — aparecem aqui quando a nota traz desconto.';
}

/** Estado vazio (primeiro uso): receipt em círculo + apoio + botão primário. */
function VazioCompras({ aoEscanear }: { aoEscanear: () => void }) {
  const { c } = useTema();
  return (
    <Cartao>
      <View style={estilos.vazio}>
        <View style={[estilos.vazioIcone, { backgroundColor: c.tealWash2 }]}>
          <IconeRecibo tamanho={30} cor={c.teal} />
        </View>
        <Texto peso="extrabold" tamanho="lg" centralizado style={{ marginTop: espaco.md }}>
          Nenhuma compra ainda
        </Texto>
        <Texto cor="suave" centralizado style={estilos.vazioApoio}>
          Escaneie o QR code do seu cupom fiscal para montar seu histórico e ver a economia.
        </Texto>
        <Botao
          titulo="Escanear primeiro cupom"
          onPress={aoEscanear}
          style={{ marginTop: espaco.lg, alignSelf: 'stretch' }}
        />
      </View>
    </Cartao>
  );
}

function rotuloStatus(compra: CompraResumo): string {
  switch (compra.status) {
    case 'processado':
      return `${compra.totalItens} ${compra.totalItens === 1 ? 'item' : 'itens'}`;
    case 'falha':
      return 'Não foi possível ler';
    default:
      return 'Processando…';
  }
}

function CompraLinha({
  compra,
  ultima,
  aoAbrir,
}: {
  compra: CompraResumo;
  ultima: boolean;
  aoAbrir: () => void;
}) {
  const { c } = useTema();
  const processado = compra.status === 'processado';
  const data = dataCurta(compra.observadoEm);
  const titulo = compra.lojaNome ?? (processado ? 'Mercado' : 'Cupom escaneado');
  const detalhe = [data, rotuloStatus(compra)].filter(Boolean).join(' · ');

  return (
    <Pressable
      onPress={aoAbrir}
      accessibilityRole="button"
      style={({ pressed }) => [
        estilos.linha,
        !ultima && { borderBottomWidth: 1, borderBottomColor: c.linha },
        pressed && estilos.linhaPressionada,
      ]}
    >
      <View style={[estilos.tile, { backgroundColor: c.tealWash }]}>
        <IconeLoja tamanho={20} cor={c.teal} />
      </View>
      <View style={estilos.linhaTexto}>
        <Texto peso="bold" tamanho="md" numberOfLines={1}>
          {titulo}
        </Texto>
        <Texto cor="suave" tamanho="sm" style={{ marginTop: 2 }} numberOfLines={1}>
          {detalhe}
        </Texto>
      </View>
      <View style={estilos.linhaValor}>
        {processado ? <Texto peso="extrabold">{moeda(compra.valorTotal)}</Texto> : null}
        {compra.economia > 0 ? (
          <Texto peso="bold" tamanho="xs" cor="barato" style={{ marginTop: 2 }}>
            −{moeda(compra.economia)}
          </Texto>
        ) : null}
      </View>
      <IconeChevron tamanho={16} cor={c.fraco} />
    </Pressable>
  );
}

const estilos = StyleSheet.create({
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: espaco.xl,
  },
  headerTexto: { flex: 1 },
  eyebrow: { fontSize: 11, letterSpacing: 1.3 },
  saudacao: { marginTop: 4, letterSpacing: -0.5 },
  avatar: {
    width: 46,
    height: 46,
    borderRadius: 23,
    alignItems: 'center',
    justifyContent: 'center',
    marginLeft: espaco.md,
  },
  stats: { flexDirection: 'row', gap: espaco.md, marginBottom: espaco.xl },
  secao: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: espaco.sm,
  },
  secaoTitulo: { letterSpacing: -0.3 },
  vazio: { alignItems: 'center', paddingVertical: espaco.lg },
  vazioIcone: {
    width: 64,
    height: 64,
    borderRadius: 32,
    alignItems: 'center',
    justifyContent: 'center',
  },
  vazioApoio: { marginTop: espaco.xs, maxWidth: 280 },
  linha: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: espaco.md,
    paddingHorizontal: espaco.lg,
    paddingVertical: espaco.md,
  },
  tile: {
    width: 40,
    height: 40,
    borderRadius: raio.sm,
    alignItems: 'center',
    justifyContent: 'center',
  },
  linhaTexto: { flex: 1 },
  linhaValor: { alignItems: 'flex-end' },
  linhaPressionada: { opacity: 0.6 },
});
