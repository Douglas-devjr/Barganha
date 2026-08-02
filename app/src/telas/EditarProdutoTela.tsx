/**
 * Redesign "3a" — Editar produto. Header modal (Cancelar / título / Salvar),
 * alerta de preço ("avisar abaixo de" + toggle) e a presença na lista de
 * compras, com "Excluir da lista" abrindo o diálogo de confirmação.
 *
 * Duas diferenças conscientes em relação ao handoff, para não inventar dado:
 *
 *  • **Sem chips de categoria** — categoria só existe no enriquecimento do
 *    backend (C11.5) e não desce para o catálogo local; os chips seriam rótulo
 *    fabricado no aparelho.
 *  • **Nome não editável** — o nome vem da descrição do próprio cupom. Deixar
 *    renomear exigiria uma tabela de apelidos que divergiria do dado fiscal;
 *    aqui ele aparece como contexto.
 *
 * O que sobra é o que o usuário realmente controla, e tudo em tabela real.
 */

import { useFocusEffect } from '@react-navigation/native';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { useCallback, useState } from 'react';
import { Pressable, StyleSheet, Switch, TextInput, View } from 'react-native';

import { Cartao, Dialogo, IconeLixeira, Tela, Texto, useToast } from '@/componentes';
import { alertas, lista } from '@/dados';
import { definirAlerta, removerAlerta } from '@/nucleo/alertas';
import { usePermissaoNotificacao } from '@/nucleo/notificacoes-push';
import { espaco, fontes, raio, tamanhos, useTema } from '@/tema';
import type { RootStackParamList } from '@/navegacao/tipos';

type Props = NativeStackScreenProps<RootStackParamList, 'EditarProduto'>;

/** "4,70" ou "4.70" → 4.7; vazio/inválido → null. */
function lerPreco(texto: string): number | null {
  const n = Number(texto.replace(/\s/g, '').replace(',', '.'));
  return Number.isFinite(n) && n > 0 ? n : null;
}

export function EditarProdutoTela({ navigation, route }: Props) {
  const { nome, produtoCanonicoId, unidadeBase } = route.params;
  const { c } = useTema();
  const toast = useToast();
  const permissaoNotificacao = usePermissaoNotificacao();

  const [avisar, setAvisar] = useState(false);
  const [alvo, setAlvo] = useState('');
  const [naLista, setNaLista] = useState(false);
  const [confirmando, setConfirmando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);

  // O alerta e a lista são indexados pelo id canônico; produto só do histórico
  // local (sem id canônico ainda) não tem onde ancorar essas preferências.
  const ancoravel = produtoCanonicoId != null;

  useFocusEffect(
    useCallback(() => {
      if (!ancoravel) return;
      let ativo = true;
      void (async () => {
        const [alerta, temNaLista] = await Promise.all([
          alertas.obter(produtoCanonicoId),
          lista.contem(produtoCanonicoId),
        ]);
        if (!ativo) return;
        setAvisar(alerta != null);
        setAlvo(alerta ? alerta.precoAlvo.toFixed(2).replace('.', ',') : '');
        setNaLista(temNaLista);
      })();
      return () => {
        ativo = false;
      };
    }, [ancoravel, produtoCanonicoId]),
  );

  async function salvar() {
    if (!ancoravel) {
      navigation.goBack();
      return;
    }

    if (avisar) {
      const valor = lerPreco(alvo);
      if (valor == null) {
        setErro('Informe um preço válido para o aviso.');
        return;
      }
      const primeiroAlerta = (await alertas.listar()).length === 0;
      await definirAlerta(produtoCanonicoId, nome, valor);
      if (primeiroAlerta) permissaoNotificacao.solicitar();
    } else {
      await removerAlerta(produtoCanonicoId);
    }

    if (naLista) await lista.adicionar(produtoCanonicoId, nome);
    else await lista.remover(produtoCanonicoId);

    toast('Alterações salvas');
    navigation.goBack();
  }

  async function excluirDaLista() {
    if (ancoravel) await lista.remover(produtoCanonicoId);
    setConfirmando(false);
    toast('Removido da lista');
    navigation.goBack();
  }

  return (
    <Tela>
      {/* header modal do handoff: Cancelar / título / Salvar */}
      <View style={estilos.header}>
        <Pressable onPress={() => navigation.goBack()} accessibilityRole="button" hitSlop={8}>
          <Texto peso="semibold" tamanho="sm" cor="suave">
            Cancelar
          </Texto>
        </Pressable>
        <Texto peso="bold" tamanho="lg">
          Editar produto
        </Texto>
        <Pressable onPress={() => void salvar()} accessibilityRole="button" hitSlop={8}>
          <Texto peso="bold" tamanho="sm">
            Salvar
          </Texto>
        </Pressable>
      </View>

      <Cartao>
        <Texto peso="semibold" cor="fraco" style={estilos.eyebrow}>
          PRODUTO
        </Texto>
        <Texto peso="bold" style={{ marginTop: espaco.xs }}>
          {nome}
        </Texto>
        <Texto cor="fraco" tamanho="xs" style={{ marginTop: 2 }}>
          {/* o nome vem do cupom: deixar claro por que não dá para editar */}
          Nome como veio no cupom fiscal
          {unidadeBase ? ` · preços em R$/${unidadeBase}` : ''}
        </Texto>
      </Cartao>

      {!ancoravel ? (
        <Cartao style={{ marginTop: espaco.lg }}>
          <Texto cor="suave" tamanho="sm">
            Este produto ainda não foi identificado na base compartilhada, então não dá para criar
            alerta nem incluir na lista. Assim que ele for reconhecido num cupom, as opções aparecem
            aqui.
          </Texto>
        </Cartao>
      ) : (
        <>
          <Cartao style={{ marginTop: espaco.lg }}>
            <View style={estilos.linhaSwitch}>
              <View style={{ flex: 1 }}>
                <Texto peso="semibold">Avisar quando baixar</Texto>
                <Texto cor="fraco" tamanho="xs" style={{ marginTop: 2 }}>
                  Checado contra o preço típico da sua região
                </Texto>
              </View>
              <Switch
                value={avisar}
                onValueChange={(v) => {
                  setAvisar(v);
                  setErro(null);
                }}
                trackColor={{ true: c.tinta, false: c.borda }}
                thumbColor={c.sobreTeal}
              />
            </View>

            {avisar ? (
              <View style={{ marginTop: espaco.lg }}>
                <Texto peso="semibold" tamanho="sm" cor="suave" style={{ marginLeft: espaco.xs }}>
                  Avisar abaixo de
                </Texto>
                <View
                  style={[
                    estilos.campoPreco,
                    { backgroundColor: c.superficie, borderColor: erro ? c.caro : c.borda },
                  ]}
                >
                  <Texto peso="bold" cor="suave">
                    R$
                  </Texto>
                  <TextInput
                    value={alvo}
                    onChangeText={(t) => {
                      setAlvo(t);
                      setErro(null);
                    }}
                    keyboardType="decimal-pad"
                    placeholder="0,00"
                    placeholderTextColor={c.fraco}
                    style={[estilos.campoPrecoInput, { color: c.tinta }]}
                  />
                  {unidadeBase ? (
                    <Texto cor="fraco" tamanho="sm">
                      /{unidadeBase}
                    </Texto>
                  ) : null}
                </View>
                {erro ? (
                  <Texto
                    tamanho="sm"
                    cor="caro"
                    style={{ marginLeft: espaco.xs, marginTop: espaco.xs }}
                  >
                    {erro}
                  </Texto>
                ) : null}
              </View>
            ) : null}
          </Cartao>

          <Cartao style={{ marginTop: espaco.lg }}>
            <View style={estilos.linhaSwitch}>
              <View style={{ flex: 1 }}>
                <Texto peso="semibold">Na lista de compras</Texto>
                <Texto cor="fraco" tamanho="xs" style={{ marginTop: 2 }}>
                  Entra na comparação de onde a cesta sai mais barata
                </Texto>
              </View>
              <Switch
                value={naLista}
                onValueChange={setNaLista}
                trackColor={{ true: c.tinta, false: c.borda }}
                thumbColor={c.sobreTeal}
              />
            </View>
          </Cartao>

          {naLista ? (
            <Pressable
              onPress={() => setConfirmando(true)}
              accessibilityRole="button"
              style={[estilos.excluir, { backgroundColor: c.cartao, borderColor: c.cartaoBorda }]}
            >
              <IconeLixeira tamanho={16} cor={c.caro} />
              <Texto peso="semibold" style={{ color: c.caro, fontSize: 13.5 }}>
                Excluir da lista
              </Texto>
            </Pressable>
          ) : null}
        </>
      )}

      <Texto cor="fraco" tamanho="xs" centralizado style={estilos.nota}>
        Alertas e lista ficam só neste aparelho. Nada disso é enviado com seus dados.
      </Texto>

      <Dialogo
        visivel={confirmando}
        titulo="Excluir da lista?"
        mensagem={`"${nome}" sai da sua lista de compras. O histórico de preços continua intacto.`}
        rotuloConfirmar="Excluir"
        icone={<IconeLixeira tamanho={24} cor={c.caro} />}
        aoConfirmar={() => void excluirDaLista()}
        aoCancelar={() => setConfirmando(false)}
      />
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
  linhaSwitch: { flexDirection: 'row', alignItems: 'center', gap: espaco.md },
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
  excluir: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: espaco.sm,
    borderWidth: 1,
    borderRadius: raio.cartao,
    padding: 14,
    marginTop: espaco.lg,
    minHeight: 44,
  },
  nota: { marginTop: espaco.lg, lineHeight: 16 },
});
