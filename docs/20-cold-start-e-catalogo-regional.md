# 20 — Cold start: o catálogo regional (C4.4 / C4.5 / C7.6 / C7.7)

> Um usuário que acabou de criar a conta e ainda não escaneou nenhum cupom não
> tem produto nenhum para montar lista nem comparar. Este documento registra por
> que isso acontece, por que **não** deve continuar assim, e o que é preciso
> construir.

---

## 1. O problema

O catálogo de produtos do app é derivado **100% do histórico privado**:
`carregarCatalogo()` (`app/src/nucleo/catalogo.ts`) agrupa as observações que
vieram dos cupons do próprio usuário. Todas as telas de produto bebem dessa
fonte única.

Para quem tem zero cupom:

| Tela | Hoje |
|---|---|
| Produtos / Detalhe | vazia |
| Adicionar item à lista | vazia — o microcopy já assume: *"Escaneie um cupom para começar"* |
| Comparar mercados | vazia |
| Verificar (gôndola) | **funciona** — é a única que consulta o pool online, por EAN/nome |

O efeito prático: o escaneamento virou **pedágio de entrada** em vez de
recompensa. O usuário instala, cria conta, escolhe a região e encontra um app
vazio antes de ter qualquer motivo para confiar nele.

Isso não é exigência de nenhuma decisão travada. O pool é anônimo de nascença e
as rotas de leitura são explicitamente **sem conta** (`rotas/consulta.ts`,
docs/04). Deixar um usuário novo navegar os produtos da região dele não vaza
nada. A trava é arquitetural, não de privacidade: confundimos *"produtos que eu
posso comparar"* com *"produtos que eu já comprei"*.

**Regra nova, em uma frase:** o escaneamento é o que torna o app **pessoal**
(seu típico, seu histórico, sua economia) — nunca o que o torna **utilizável**.

## 2. O que não muda

- **Nada de dado pessoal.** A busca de catálogo lê só `produto_canonico` +
  `preco_estatistica` (mundo compartilhado). Não recebe conta, não recebe
  `usuario_id`, não escreve nada.
- **Mediana, nunca média** (decisão travada nº6). O típico exibido na busca é o
  mesmo `resolverFallback` da consulta na gôndola.
- **Muro da neutralidade** (decisão travada nº8). O ranking da busca é por
  **base de observações** e similaridade de texto — nunca por patrocínio. Oferta
  anunciada (C12.4) não entra nesta lista.
- **Supressão de célula pequena** (docs/04). O nível `loja` continua fora: a
  busca resolve em `municipio` → `regiao` → `uf`.
- **Offline-first.** A busca no pool é um *complemento* online; o que já está no
  cache continua respondendo sem sinal.

## 3. A decisão

Duas fontes de produto, não uma:

1. **Histórico** (privado, offline, já existe) — dá o "seu típico" e a evolução.
2. **Catálogo regional** (pool anônimo, online) — dá o que existe na região do
   usuário mesmo sem histórico nenhum.

A busca de produto do app passa a **mesclar** as duas, com o histórico na
frente. Um usuário novo está necessariamente online (acabou de criar conta), e
no instante em que ele põe um produto na lista o id entra no recorte do delta
sync e passa a valer offline.

## 4. As etapas

### `C4.4` — Busca de produtos no pool *(agora)*

`POST /consulta/produtos` — anônima, sob o mesmo teto de leitura pública das
outras rotas de consulta.

```
{ termo?: string, municipio?: string, uf?: string, limite?: number }
→ { produtos: [{ produto: ProdutoResumo, estatistica, escopoResolvido }] }
```

- **Com `termo`:** relevância de BUSCA, não casamento de identidade. Todo token
  digitado precisa prefixar algum token da descrição ("arroz int" acha "ARROZ
  INTEGRAL"), com a similaridade do C3.5 como rede para erro de digitação. O
  limiar do `sugerirCasamento` não serve aqui: "arroz" × "ARROZ TIPO 1 5KG" dá
  0,38 e seria reprovado — mas é exatamente o que o usuário quis dizer.
- **Sem `termo`:** os **populares da região**. É o que preenche a tela de quem
  nunca buscou nada.
- **A ordem é a mesma nos dois casos: `n_observacoes`.** Uma regra só, neutra por
  construção (nº8) e a mais útil — quem busca "arroz" quer primeiro o arroz que
  mais se vê na região dele.
- Só sobrevive quem tem estatística no recorte geo.
- O escopo de cada produto é resolvido pelo `resolverFallback` já existente
  (município → região → UF), e o escopo efetivo volta na resposta para a UI
  poder rotular ("na sua cidade" × "no seu estado").

### `C7.6` — Catálogo regional no app *(agora)*

O sheet de adicionar item e o Comparar mercados deixam de ser alimentados só
pelo histórico:

- digitou → busca local (instantânea) **+** busca no pool (com debounce);
- não digitou nada e o histórico não cobre → **populares da região**;
- resultado do pool vem rotulado como "na sua região" e traz o típico regional;
- resultado do histórico continua na frente e mostra "seu típico".

### `C7.7` — Escopo do delta sync inclui a lista *(agora)*

Hoje os ids do recorte do delta sync vêm só de `item_cupom_local`
(`listarProdutoCanonicoIds`). Produto que o usuário **só pôs na lista**, sem
nunca ter comprado, ficaria fora do sync — e portanto sem preço offline, que é
exatamente o caso criado pelo C7.6. A lista passa a contribuir com seus ids.

**E um furo que só aparece aqui:** o delta é por CURSOR, que avança sobre o que
foi *entregue*. Um produto que entra no recorte depois tem estatística mais
ANTIGA que o cursor — o delta incremental nunca a traria, e o item recém-posto na
lista ficaria para sempre "sem preço na sua região" com o pool cheio de dado
sobre ele. Por isso, os ids do recorte que ainda não têm nada em cache ganham uma
busca própria, **sem cursor, do começo**, que não mexe no cursor principal. Ela
roda uma vez por produto (memória em `meta_sync`): se a região não tem preço para
ele hoje, repetir a cada rodada é chamada jogada fora — e quando o preço
aparecer, será uma linha nova, que o delta incremental entrega sozinho.

### `C4.5` — Delta de catálogo *(depois, `[Pós]`)*

`POST /sync/produtos`: desce `ProdutoResumo` (nome/marca/categoria) dos ids que
o aparelho já tem em cache, para uma tabela local `cache_produto`. É o que torna
o catálogo regional **navegável offline** — hoje o `cache_estatistica` já traz
os produtos da região, mas sem nome nenhum. Destrava de quebra a categoria
offline, que hoje só existe no backend.

## 5. Critérios de aceite

**C4.4**
- [ ] `POST /consulta/produtos` responde sem `Authorization` e nunca lê o mundo privado.
- [ ] Com `termo`, um nome aproximado ("arroz tipo 1") casa por similaridade.
- [ ] Sem `termo`, devolve os produtos com mais observações no recorte geo.
- [ ] Produto sem estatística no recorte **não** aparece.
- [ ] Nenhuma linha de escopo `loja` é servida (supressão de célula pequena).
- [ ] `limite` tem teto de servidor; pedido maior é cortado, não recusado.
- [ ] Testes cobrindo: casamento por termo, populares, recorte geo, teto.

**C7.6**
- [ ] Conta nova, zero cupom, região escolhida: o sheet de adicionar item mostra produtos.
- [ ] O que vem do pool aparece rotulado e some do rótulo quando já é do histórico.
- [ ] Sem sinal, a busca continua funcionando sobre o histórico (sem erro na tela).
- [ ] Adicionar um produto do pool à lista persiste id canônico + nome.

**C7.7**
- [ ] Produto só listado (nunca comprado) entra no `produtoCanonicoIds` do delta.
- [ ] Após um sync, esse produto tem típico na Lista de compras offline — mesmo
      que a estatística dele seja anterior ao cursor.
- [ ] A recuperação sem cursor não avança o cursor principal.
- [ ] Trocar de região zera a memória da recuperação junto com o cache.

## 6. Limites conhecidos

- **Primeiro usuário de um município.** Se o pool não tem nada ali, não há o que
  mostrar — o fallback sobe para UF e a UI precisa dizer isso. Não se resolve com
  código.
- **Produto sem enriquecimento (C11.5)** aparece com a descrição técnica
  normalizada, não com um nome bonito.
- **Dados sem EAN** (o caso do RJ) dependem do casamento por texto, com a
  precisão que ele tem hoje.
