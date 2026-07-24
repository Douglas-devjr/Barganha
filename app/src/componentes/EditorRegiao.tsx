/**
 * Handoff 3a (`regiao`) — o editor da região usada nas comparações. Vive como
 * componente porque aparece em dois lugares: na tela `EditarRegiao` (Perfil) e
 * no passo de região da ABERTURA (primeiro uso).
 *
 * A região mora só no aparelho e serve apenas para recortar a consulta ANÔNIMA
 * de preço — nunca viaja junto com dado privado (decisão travada nº4).
 *
 * Três caminhos para definir a região, todos gravando SÓ município/UF:
 *   • GPS ("Usar minha localização") — detecta a cidade uma vez e pré-preenche;
 *     a posição (lat/lng) nunca é salva nem enviada (docs/04 admite GPS
 *     transitório). Módulo nativo `expo-location` → exige novo dev build.
 *   • Região das compras — deriva a UF da loja do último cupom (offline, é o
 *     fallback de quem não quer dar GPS).
 *   • Manual — filtra as UFs enquanto digita + cidade em texto livre.
 *
 * A agregação de preço continua pela LOJA (CNPJ); o GPS aqui só ajuda a pessoa a
 * escolher a região, não vira dado de rastreio. Autocomplete de município
 * pediria a base do IBGE embarcada, que o app ainda não tem.
 */

import { useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Linking,
  Pressable,
  ScrollView,
  StyleSheet,
  TextInput,
  View,
} from 'react-native';

import { cache, meta, produtos } from '@/dados';
import type { RaioKm } from '@/dados/repositorio-meta';
import { detectarRegiaoPorGps } from '@/nucleo/gps';
import { UFS } from '@/nucleo/localizacao';
import { sincronizarEstatisticas } from '@/nucleo/sincronizador';
import { espaco, raio, useTema } from '@/tema';

import { Botao } from './Botao';
import { Cartao } from './Cartao';
import { IconeBusca, IconeChevron, IconeGps, IconeLoja, IconePino } from './icones';
import { Eyebrow } from './layout3a';
import { Segmentado } from './Segmentado';
import { Texto } from './Texto';
import { useToast } from './Toast';

const RAIOS: readonly { valor: RaioKm; rotulo: string }[] = [
  { valor: 1, rotulo: '1 km' },
  { valor: 3, rotulo: '3 km' },
  { valor: 5, rotulo: '5 km' },
];

export interface EditorRegiaoProps {
  /** Chamado depois que a região é gravada (voltar, concluir a abertura…). */
  aoSalvar: () => void;
}

export function EditorRegiao({ aoSalvar }: EditorRegiaoProps) {
  const { c } = useTema();
  const toast = useToast();

  const [uf, setUf] = useState<string | null>(null);
  const [cidade, setCidade] = useState('');
  const [busca, setBusca] = useState('');
  const [raioKm, setRaioKm] = useState<RaioKm>(3);
  const [ufDoHistorico, setUfDoHistorico] = useState<string | null>(null);
  const [salvando, setSalvando] = useState(false);
  const [localizando, setLocalizando] = useState(false);

  useEffect(() => {
    let vivo = true;
    void (async () => {
      const [escolhido, doHistorico, km] = await Promise.all([
        meta.obterLocalEscolhido(),
        produtos.obterUfRecente(),
        meta.obterRaioKm(),
      ]);
      if (!vivo) return;
      setUf(escolhido?.uf ?? null);
      setCidade(escolhido?.municipio ?? '');
      setUfDoHistorico(doHistorico);
      setRaioKm(km);
    })();
    return () => {
      vivo = false;
    };
  }, []);

  /**
   * GPS: detecta a região UMA vez e só PRÉ-PREENCHE os campos — o usuário ainda
   * confirma e salva. A posição não é gravada (ver `nucleo/gps`).
   */
  async function usarGps() {
    setLocalizando(true);
    try {
      const r = await detectarRegiaoPorGps();
      if (r.ok) {
        setUf(r.uf);
        if (r.municipio) setCidade(r.municipio);
        toast(r.municipio ? `Você está em ${r.municipio} · ${r.uf}` : `Região detectada: ${r.uf}`);
        return;
      }
      if (r.motivo === 'permissao') {
        toast(
          'Permissão de localização negada. Você pode liberar nos ajustes ou escolher manualmente.',
        );
        void Linking.openSettings();
        return;
      }
      toast('Não deu para detectar sua região agora. Escolha manualmente abaixo.');
    } finally {
      setLocalizando(false);
    }
  }

  function usarRegiaoDasCompras() {
    if (!ufDoHistorico) {
      toast('Escaneie um cupom primeiro — a região vem da loja da sua compra');
      return;
    }
    setUf(ufDoHistorico);
    toast(`Região da sua última compra: ${ufDoHistorico}`);
  }

  async function salvar() {
    if (!uf) return;
    setSalvando(true);
    try {
      await meta.definirLocalEscolhido({ uf, municipio: cidade.trim() || undefined });
      await meta.definirRaioKm(raioKm);
      // Trocar a região invalida o cache: o recorte geográfico mudou, então as
      // linhas do recorte anterior não valem mais e o cursor volta ao zero.
      await meta.definirCursorDelta('');
      await cache.limpar();
      void sincronizarEstatisticas().catch(() => {});
      toast(cidade.trim() ? `Região salva: ${cidade.trim()} · ${uf}` : `Região salva: ${uf}`);
      aoSalvar();
    } finally {
      setSalvando(false);
    }
  }

  const ufsVisiveis = busca
    ? UFS.filter((u) => u.toLowerCase().includes(busca.trim().toLowerCase()))
    : UFS;

  return (
    <>
      <Texto cor="suave" tamanho="sm" style={estilos.intro}>
        Sua região define quais cupons entram nas comparações. Ela fica só neste aparelho e nunca
        viaja junto com seus dados.
      </Texto>

      {/* GPS: detecta a região pelo aparelho (posição não é salva) */}
      <Pressable
        onPress={() => void usarGps()}
        disabled={localizando}
        accessibilityRole="button"
        accessibilityLabel="Usar minha localização"
        style={({ pressed }) => [
          estilos.atalho,
          { backgroundColor: c.cartao, borderColor: c.cartaoBorda },
          (pressed || localizando) && { opacity: 0.6 },
        ]}
      >
        <View style={[estilos.atalhoTile, { backgroundColor: c.teal }]}>
          {localizando ? (
            <ActivityIndicator size="small" color={c.sobreTeal} />
          ) : (
            <IconeGps tamanho={18} cor={c.sobreTeal} larguraTraco={2} />
          )}
        </View>
        <View style={{ flex: 1 }}>
          <Texto peso="semibold" tamanho="sm">
            {localizando ? 'Localizando…' : 'Usar minha localização'}
          </Texto>
          <Texto cor="fraco" tamanho="xs">
            Detecta sua cidade pelo GPS — a posição não é salva
          </Texto>
        </View>
        <IconeChevron tamanho={16} cor={c.fraco} />
      </Pressable>

      {/* fallback offline: a região da loja do último cupom */}
      {ufDoHistorico ? (
        <Pressable
          onPress={usarRegiaoDasCompras}
          accessibilityRole="button"
          accessibilityLabel="Usar a região das minhas compras"
          style={({ pressed }) => [
            estilos.atalho,
            estilos.atalhoSecundario,
            { backgroundColor: c.cartao, borderColor: c.cartaoBorda },
            pressed && { opacity: 0.6 },
          ]}
        >
          <View style={[estilos.atalhoTile, { backgroundColor: c.linha }]}>
            <IconeLoja tamanho={18} cor={c.tinta} larguraTraco={2} />
          </View>
          <View style={{ flex: 1 }}>
            <Texto peso="semibold" tamanho="sm">
              Usar a região das minhas compras
            </Texto>
            <Texto cor="fraco" tamanho="xs">
              Detecta pela loja do último cupom ({ufDoHistorico})
            </Texto>
          </View>
          <IconeChevron tamanho={16} cor={c.fraco} />
        </Pressable>
      ) : null}

      <Eyebrow style={estilos.rotuloBusca}>Ou escolher manualmente</Eyebrow>

      <View style={[estilos.busca, { backgroundColor: c.superficie, borderColor: c.borda }]}>
        <IconeBusca tamanho={18} cor={c.fraco} />
        <TextInput
          value={busca}
          onChangeText={setBusca}
          placeholder="Filtrar estado… ex.: RJ"
          placeholderTextColor={c.fraco}
          autoCapitalize="characters"
          autoCorrect={false}
          style={[estilos.buscaInput, { color: c.tinta }]}
        />
      </View>

      {ufsVisiveis.length === 0 ? (
        <Texto cor="fraco" tamanho="sm" centralizado style={estilos.semResultado}>
          Nenhum estado com essa sigla.
        </Texto>
      ) : (
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={estilos.chips}
        >
          {ufsVisiveis.map((u) => {
            const ativo = uf === u;
            return (
              <Pressable
                key={u}
                onPress={() => setUf(u)}
                accessibilityRole="radio"
                accessibilityState={{ selected: ativo }}
                style={[
                  estilos.chip,
                  {
                    backgroundColor: ativo ? c.teal : c.cartao,
                    borderColor: ativo ? c.teal : c.borda,
                  },
                ]}
              >
                <Texto peso="semibold" tamanho="sm" cor={ativo ? 'sobreTeal' : 'suave'}>
                  {u}
                </Texto>
              </Pressable>
            );
          })}
        </ScrollView>
      )}

      <View style={[estilos.cidade, { backgroundColor: c.superficie, borderColor: c.borda }]}>
        <IconePino tamanho={18} cor={c.fraco} larguraTraco={2} />
        <TextInput
          value={cidade}
          onChangeText={setCidade}
          placeholder="Cidade (opcional) — ex.: Rio de Janeiro"
          placeholderTextColor={c.fraco}
          autoCapitalize="words"
          style={[estilos.buscaInput, { color: c.tinta }]}
        />
      </View>
      <Texto cor="fraco" tamanho="xs" style={estilos.notaCidade}>
        Com a cidade a comparação fica mais perto da sua gôndola. Sem ela, usamos o estado inteiro.
      </Texto>

      {/* raio */}
      <Cartao style={estilos.cartaoRaio}>
        <View style={estilos.raioTopo}>
          <Texto peso="semibold" tamanho="sm">
            Raio das comparações
          </Texto>
          <Texto peso="bold" style={estilos.raioValor}>
            {raioKm} km
          </Texto>
        </View>
        <Texto cor="fraco" tamanho="xs" style={estilos.raioNota}>
          Até onde procuramos mercados para o ranking da sua cesta.
        </Texto>
        <View style={estilos.raioSegmentado}>
          <Segmentado
            opcoes={RAIOS}
            valor={raioKm}
            aoMudar={setRaioKm}
            rotuloGrupo="Raio das comparações"
          />
        </View>
      </Cartao>

      <Botao
        titulo="Salvar região"
        bloco
        desabilitado={!uf}
        carregando={salvando}
        onPress={() => void salvar()}
        style={estilos.salvar}
      />
    </>
  );
}

const estilos = StyleSheet.create({
  intro: { lineHeight: 19, marginBottom: espaco.md },
  atalhoSecundario: { marginTop: espaco.sm },
  atalho: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: espaco.md,
    borderWidth: 1,
    borderRadius: raio.cartao,
    padding: 13,
    minHeight: 44,
  },
  atalhoTile: {
    width: 38,
    height: 38,
    borderRadius: raio.sm,
    alignItems: 'center',
    justifyContent: 'center',
  },
  rotuloBusca: { marginTop: espaco.lg, marginBottom: espaco.sm },
  busca: {
    height: 50,
    flexDirection: 'row',
    alignItems: 'center',
    gap: espaco.sm + 2,
    borderWidth: 1,
    borderRadius: raio.md,
    paddingHorizontal: 14,
  },
  buscaInput: { flex: 1, paddingVertical: 0, fontSize: 13.5 },
  semResultado: { marginTop: espaco.md },
  chips: { gap: espaco.sm, paddingVertical: espaco.md, paddingRight: espaco.md },
  chip: {
    minHeight: 40,
    justifyContent: 'center',
    paddingHorizontal: espaco.lg,
    borderRadius: raio.pill,
    borderWidth: 1,
  },
  cidade: {
    height: 50,
    flexDirection: 'row',
    alignItems: 'center',
    gap: espaco.sm + 2,
    borderWidth: 1,
    borderRadius: raio.md,
    paddingHorizontal: 14,
  },
  notaCidade: { marginTop: espaco.sm, marginLeft: espaco.xs, lineHeight: 16 },
  cartaoRaio: { marginTop: espaco.lg, padding: espaco.lg },
  raioTopo: { flexDirection: 'row', alignItems: 'baseline', justifyContent: 'space-between' },
  raioValor: { fontSize: 12 },
  raioNota: { marginTop: 2, lineHeight: 16 },
  raioSegmentado: { marginTop: espaco.md },
  salvar: { marginTop: espaco.lg },
});
