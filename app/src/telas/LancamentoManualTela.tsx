/**
 * C11.3 — Lançamento manual de preço de gôndola. O usuário viu o preço mas não
 * tem cupom (produto avulso, promoção rápida, mercado sem NFC-e à mão): informa
 * o que está na etiqueta e o backend guarda como PENDENTE até um curador aprovar
 * (fila de moderação, fora do escopo desta tela — C11.3 backend já existe).
 *
 * O `ean` chega SEMPRE de uma leitura real de código de barras (nunca digitado):
 * é o que garante que o lançamento aponta para o produto certo. Por isso o campo
 * é só leitura aqui — quem quiser trocar de produto cancela e escaneia de novo
 * (reabrir o scanner desta tela reaproveitaria o "correio" de EAN pendente que
 * hoje só a aba Verificar consome, e sempre devolve para lá; ver nota no rodapé).
 *
 * Loja: sem uma tela de "escolher mercado" no app, o CNPJ é digitado à mão (com
 * máscara) — é o único jeito de ancorar a geo pela LOJA (decisão travada nº4)
 * sem inventar uma busca de estabelecimentos que não existe ainda.
 */

import { useFocusEffect } from '@react-navigation/native';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import type { UnidadeBase } from '@barganha/shared';
import { useCallback, useState } from 'react';
import { Pressable, StyleSheet, Switch, TextInput, View } from 'react-native';

import {
  Botao,
  CampoTexto,
  Cartao,
  Estado,
  IconeCheck,
  IconeEtiqueta,
  Segmentado,
  Tela,
  Texto,
  type OpcaoSegmentada,
} from '@/componentes';
import { clienteApi, ErroApi } from '@/api';
import { cnpjPareceValido, mascararCnpj, parseMoeda, somenteDigitos } from '@/nucleo/formato';
import { type LocalizacaoEfetiva, resolverLocalizacao } from '@/nucleo/localizacao';
import { espaco, raio, tamanhos, fontes, useTema } from '@/tema';
import type { RootStackParamList } from '@/navegacao/tipos';

type Props = NativeStackScreenProps<RootStackParamList, 'LancamentoManual'>;

/** Unidades de venda mais comuns numa etiqueta de gôndola (subconjunto direto do
 * mapa de `@barganha/shared` — nada aqui é inventado além do que o backend já
 * normaliza de cara, sem precisar de contagem de embalagem). */
const OPCOES_UNIDADE: readonly OpcaoSegmentada<string>[] = [
  { valor: 'UN', rotulo: 'un' },
  { valor: 'KG', rotulo: 'kg' },
  { valor: 'G', rotulo: 'g' },
  { valor: 'L', rotulo: 'L' },
  { valor: 'ML', rotulo: 'mL' },
];

function unidadeInicial(unidadeBase?: string | null): string {
  const b = unidadeBase as UnidadeBase | null | undefined;
  if (b === 'kg') return 'KG';
  if (b === 'L') return 'L';
  return 'UN';
}

export function LancamentoManualTela({ navigation, route }: Props) {
  const { ean, unidadeBase } = route.params;
  const { c } = useTema();

  const [descricao, setDescricao] = useState(route.params.descricao ?? '');
  const [unidade, setUnidade] = useState(() => unidadeInicial(unidadeBase));
  const [precoTexto, setPrecoTexto] = useState('');
  const [cnpjTexto, setCnpjTexto] = useState('');
  const [emPromocao, setEmPromocao] = useState(false);
  const [local, setLocal] = useState<LocalizacaoEfetiva | null>(null);
  const [enviando, setEnviando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const [enviado, setEnviado] = useState(false);

  useFocusEffect(
    useCallback(() => {
      let ativo = true;
      void resolverLocalizacao().then((l) => {
        if (ativo) setLocal(l);
      });
      return () => {
        ativo = false;
      };
    }, []),
  );

  async function enviar() {
    const desc = descricao.trim();
    if (!desc) {
      setErro('Informe a descrição do produto, como está na etiqueta.');
      return;
    }
    const preco = parseMoeda(precoTexto);
    if (preco == null) {
      setErro('Informe o preço visto na prateleira.');
      return;
    }
    if (!cnpjPareceValido(cnpjTexto)) {
      setErro('Informe o CNPJ do mercado (14 dígitos).');
      return;
    }

    setErro(null);
    setEnviando(true);
    try {
      const resposta = await clienteApi.lancarPrecoManual({
        ean,
        descricao: desc,
        unidade,
        valorUnitario: preco,
        lojaCnpj: somenteDigitos(cnpjTexto),
        ...(local?.municipio ? { municipio: local.municipio } : {}),
        ...(local?.uf ? { uf: local.uf } : {}),
        ...(emPromocao ? { emPromocao: true } : {}),
      });
      if (resposta.status) setEnviado(true);
    } catch (e) {
      if (e instanceof ErroApi && e.status === 401) {
        setErro('Sua sessão expirou. Saia e entre de novo para lançar preços.');
      } else if (e instanceof ErroApi && e.status === 400) {
        // LancamentoInvalidoError do backend (unidade não normalizável / CNPJ
        // inválido) — a mensagem já vem em PT-BR pronta para a tela.
        setErro(e.message);
      } else {
        setErro('Não deu para enviar agora. Verifique a conexão e tente de novo.');
      }
    } finally {
      setEnviando(false);
    }
  }

  if (enviado) {
    return (
      <Tela>
        <Estado
          icone={<IconeCheck tamanho={30} cor={c.teal} />}
          titulo="Preço enviado"
          texto="Ele passa por revisão antes de entrar na base compartilhada — pode levar um tempinho para valer para os outros."
          acao={{ titulo: 'Concluir', onPress: () => navigation.goBack() }}
        />
      </Tela>
    );
  }

  return (
    <Tela>
      <View style={estilos.header}>
        <Pressable onPress={() => navigation.goBack()} accessibilityRole="button" hitSlop={8}>
          <Texto peso="semibold" tamanho="sm" cor="suave">
            Cancelar
          </Texto>
        </Pressable>
        <Texto peso="bold" tamanho="lg">
          Lançar preço
        </Texto>
        <View style={{ width: 60 }} />
      </View>

      <Cartao>
        <View style={estilos.linhaEan}>
          <View style={[estilos.tileEtiqueta, { backgroundColor: c.tealWash2 }]}>
            <IconeEtiqueta tamanho={16} cor={c.tinta} />
          </View>
          <View style={{ flex: 1 }}>
            <Texto peso="semibold" cor="fraco" style={estilos.eyebrow}>
              CÓDIGO DE BARRAS
            </Texto>
            <Texto peso="bold" numerico style={{ marginTop: 2 }}>
              {ean}
            </Texto>
          </View>
        </View>
        <Texto cor="fraco" tamanho="xs" style={{ marginTop: espaco.sm }}>
          Errou o produto? Cancele e escaneie de novo pelo botão de código de barras.
        </Texto>

        <View style={{ marginTop: espaco.lg }}>
          <CampoTexto
            rotulo="Descrição (como está na etiqueta)"
            value={descricao}
            onChangeText={setDescricao}
            placeholder="ex.: Arroz Tio João Tipo 1 5kg"
            editable={!enviando}
          />
        </View>
      </Cartao>

      <Cartao style={{ marginTop: espaco.lg }}>
        <Texto peso="semibold" tamanho="sm" cor="suave" style={{ marginBottom: espaco.sm }}>
          Unidade de venda
        </Texto>
        <Segmentado
          opcoes={OPCOES_UNIDADE}
          valor={unidade}
          aoMudar={setUnidade}
          rotuloGrupo="Unidade de venda"
        />

        <Texto
          peso="semibold"
          tamanho="sm"
          cor="suave"
          style={{ marginTop: espaco.lg, marginLeft: espaco.xs }}
        >
          Preço visto na prateleira
        </Texto>
        <View style={[estilos.campoPreco, { backgroundColor: c.superficie, borderColor: c.borda }]}>
          <Texto peso="bold" cor="suave">
            R$
          </Texto>
          <TextInput
            value={precoTexto}
            onChangeText={setPrecoTexto}
            editable={!enviando}
            keyboardType="decimal-pad"
            placeholder="0,00"
            placeholderTextColor={c.fraco}
            accessibilityLabel="Preço visto na prateleira"
            style={[estilos.campoPrecoInput, { color: c.tinta }]}
          />
          <Texto cor="fraco" tamanho="sm">
            /{unidade.toLowerCase()}
          </Texto>
        </View>

        <View style={[estilos.linhaSwitch, { marginTop: espaco.lg }]}>
          <View style={{ flex: 1 }}>
            <Texto peso="semibold" tamanho="sm">
              Está em promoção?
            </Texto>
            <Texto cor="fraco" tamanho="xs" style={{ marginTop: 2 }}>
              Fica marcado à parte — nunca entra no típico da região
            </Texto>
          </View>
          <Switch
            value={emPromocao}
            onValueChange={setEmPromocao}
            trackColor={{ true: c.tinta, false: c.borda }}
            thumbColor={c.sobreTeal}
            disabled={enviando}
          />
        </View>
      </Cartao>

      <Cartao style={{ marginTop: espaco.lg }}>
        <CampoTexto
          rotulo="CNPJ do mercado (não do produto)"
          value={cnpjTexto}
          onChangeText={(t) => setCnpjTexto(mascararCnpj(t))}
          placeholder="00.000.000/0000-00"
          keyboardType="number-pad"
          maxLength={18}
          editable={!enviando}
        />
        <Texto cor="fraco" tamanho="xs" style={{ marginTop: espaco.xs, marginLeft: espaco.xs }}>
          {local?.municipio || local?.uf
            ? `Vamos usar a sua região configurada (${[local.municipio, local.uf].filter(Boolean).join(', ')}) junto com esta loja.`
            : 'Sem região configurada ainda — o CNPJ da loja já é o principal para localizar o preço.'}
        </Texto>
      </Cartao>

      {erro ? (
        <Texto tamanho="sm" cor="caro" style={{ marginTop: espaco.md, marginLeft: espaco.xs }}>
          {erro}
        </Texto>
      ) : null}

      <Botao
        titulo="Enviar preço"
        bloco
        carregando={enviando}
        onPress={() => void enviar()}
        style={{ marginTop: espaco.lg }}
      />

      <Texto cor="fraco" tamanho="xs" centralizado style={estilos.nota}>
        O preço não aparece na hora: passa por revisão antes de valer para a base compartilhada.
      </Texto>
    </Tela>
  );
}

const estilos = StyleSheet.create({
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: espaco.md,
    marginBottom: espaco.lg,
    minHeight: 44,
  },
  eyebrow: { fontSize: 11, letterSpacing: 1.3 },
  linhaEan: { flexDirection: 'row', alignItems: 'center', gap: espaco.md },
  tileEtiqueta: {
    width: 36,
    height: 36,
    borderRadius: raio.sm,
    alignItems: 'center',
    justifyContent: 'center',
  },
  campoPreco: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: espaco.sm,
    height: 54,
    borderRadius: raio.md,
    borderWidth: 1.5,
    paddingHorizontal: espaco.lg,
    marginTop: espaco.xs,
  },
  campoPrecoInput: {
    flex: 1,
    fontFamily: fontes.bold,
    fontSize: tamanhos.md,
    fontVariant: ['tabular-nums'],
    paddingVertical: 0,
  },
  linhaSwitch: { flexDirection: 'row', alignItems: 'center', gap: espaco.md },
  nota: { marginTop: espaco.lg, lineHeight: 16 },
});
