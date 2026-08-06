/**
 * C11.5 — HTML da interface web de curadoria (`GET /curadoria/painel`).
 *
 * String estática, sem build step: o backend serve isto direto, sem workspace
 * novo. É JS puro no navegador que chama as MESMAS rotas de curadoria já
 * autenticadas por Bearer — a página não é uma via de autenticação nova, é só
 * um cliente HTTP com formulário. O token digitado fica em `localStorage` do
 * NAVEGADOR do curador (nunca no backend, nunca em log).
 *
 * Deliberadamente NÃO tem campo de preço/valor: curadoria aqui é metadado de
 * EXIBIÇÃO (nome, marca, categoria, foto, casamento de descrição) — nunca a
 * mediana/faixa que vira veredito (decisão travada #6/#8, CLAUDE.md).
 */

export const PAINEL_CURADORIA_HTML = `<!DOCTYPE html>
<html lang="pt-BR">
<head>
<meta charset="UTF-8" />
<meta name="viewport" content="width=device-width, initial-scale=1.0" />
<meta name="robots" content="noindex, nofollow" />
<title>Barganha — Curadoria</title>
<style>
  :root { color-scheme: light dark; }
  * { box-sizing: border-box; }
  body {
    font-family: system-ui, -apple-system, "Segoe UI", Roboto, sans-serif;
    margin: 0; padding: 1.5rem; max-width: 960px; margin-inline: auto;
    background: #f7f7f5; color: #1a1a1a;
  }
  h1 { font-size: 1.4rem; margin-bottom: 0.25rem; }
  h2 { font-size: 1.1rem; margin: 0 0 0.75rem; }
  p.sub { color: #555; margin-top: 0; margin-bottom: 1.5rem; }
  section {
    background: #fff; border: 1px solid #ddd; border-radius: 8px;
    padding: 1rem 1.25rem; margin-bottom: 1.25rem;
  }
  label { display: block; font-size: 0.85rem; font-weight: 600; margin-top: 0.6rem; margin-bottom: 0.2rem; }
  input, select, textarea {
    width: 100%; padding: 0.45rem 0.6rem; border: 1px solid #ccc; border-radius: 6px;
    font-size: 0.95rem; font-family: inherit;
  }
  button {
    margin-top: 0.9rem; padding: 0.5rem 1rem; border: none; border-radius: 6px;
    background: #1a5c3a; color: #fff; font-weight: 600; cursor: pointer; font-size: 0.9rem;
  }
  button:hover { background: #144a2f; }
  button.secundario { background: #666; }
  button.perigo { background: #a33; }
  button.pequeno { margin-top: 0; padding: 0.3rem 0.6rem; font-size: 0.8rem; }
  .linha-botoes { display: flex; gap: 0.5rem; flex-wrap: wrap; }
  .msg { margin-top: 0.75rem; padding: 0.6rem 0.75rem; border-radius: 6px; font-size: 0.88rem; white-space: pre-wrap; }
  .msg.ok { background: #e1f3e6; color: #1a5c3a; border: 1px solid #b6ddc2; }
  .msg.erro { background: #fbe4e2; color: #8a2a1f; border: 1px solid #f0b8b2; }
  .item-fila { border: 1px solid #e2e2e2; border-radius: 6px; padding: 0.6rem 0.75rem; margin-bottom: 0.5rem; font-size: 0.85rem; }
  .item-fila pre { white-space: pre-wrap; word-break: break-word; margin: 0.35rem 0; font-size: 0.8rem; background: #f2f2f0; padding: 0.4rem; border-radius: 4px; }
  .sugestao { display: flex; justify-content: space-between; align-items: center; border: 1px solid #e2e2e2; border-radius: 6px; padding: 0.5rem 0.7rem; margin-bottom: 0.4rem; font-size: 0.85rem; }
  .badge { display: inline-block; background: #eee; border-radius: 4px; padding: 0.1rem 0.4rem; font-size: 0.75rem; margin-left: 0.4rem; }
  .token-status { font-size: 0.8rem; color: #555; margin-top: 0.3rem; }
  .token-status.ok { color: #1a5c3a; }
  .pagina-info { font-size: 0.85rem; color: #555; }
  fieldset { border: none; padding: 0; margin: 0; }
</style>
</head>
<body>

<h1>Barganha — Painel de curadoria</h1>
<p class="sub">Ferramenta interna (C11.5). Apenas metadado de exibição — nunca preço.</p>

<section>
  <h2>Autenticação</h2>
  <label for="token">Token de curadoria (Bearer)</label>
  <input type="password" id="token" placeholder="cole o token aqui" autocomplete="off" />
  <div class="linha-botoes">
    <button id="btnSalvarToken">Salvar token</button>
    <button class="secundario" id="btnLimparToken">Limpar</button>
  </div>
  <div id="tokenStatus" class="token-status">Nenhum token salvo neste navegador.</div>
</section>

<section>
  <h2>Corrigir metadado de produto</h2>
  <p class="sub">Nome de exibição, marca, categoria e imagem — nunca preço nem casamento por descrição/EAN.</p>

  <label for="buscaTermo">Buscar produto (nome ou EAN)</label>
  <div class="linha-botoes">
    <input id="buscaTermo" placeholder="ex.: arroz ou 7891234567890" style="flex: 1;" />
    <button class="secundario pequeno" id="btnBuscarProduto">Buscar</button>
  </div>
  <div id="msgBusca"></div>
  <div id="listaBusca" style="margin-top: 0.5rem;"></div>
  <div class="linha-botoes" id="paginacaoBusca" style="display: none; align-items: center; margin-top: 0.5rem;">
    <button class="secundario pequeno" id="btnBuscaAnterior">Anterior</button>
    <span id="infoPaginaBusca" class="pagina-info"></span>
    <button class="secundario pequeno" id="btnBuscaProxima">Próxima</button>
  </div>

  <fieldset>
    <label for="prodId">produtoCanonicoId (ou preencha o EAN abaixo)</label>
    <input id="prodId" placeholder="uuid do produto" />
    <label for="prodEan">EAN</label>
    <input id="prodEan" placeholder="código de barras" />
    <label for="prodNome">Nome de exibição</label>
    <input id="prodNome" placeholder="ex.: Arroz Tipo 1 5kg" />
    <label for="prodMarca">Marca</label>
    <input id="prodMarca" placeholder="ex.: Camil" />
    <label for="prodCategoria">Categoria</label>
    <input id="prodCategoria" placeholder="ex.: Mercearia" />
    <label for="prodImagem">URL da imagem</label>
    <input id="prodImagem" placeholder="https://..." />
  </fieldset>
  <button id="btnEnriquecer">Salvar produto</button>
  <div id="msgEnriquecer"></div>
</section>

<section>
  <h2>Casamento por descrição (itens sem EAN)</h2>
  <p class="sub">Busca candidatos por similaridade de texto. Confirmar grava o alias — decisão sempre humana.</p>
  <label for="casDescricao">Descrição do item</label>
  <input id="casDescricao" placeholder="descrição como veio do cupom" />
  <label for="casUnidade">Unidade-base</label>
  <select id="casUnidade">
    <option value="kg">kg</option>
    <option value="L">L</option>
    <option value="un">un</option>
  </select>
  <button id="btnSugerir">Buscar sugestões</button>
  <div id="msgSugerir"></div>
  <div id="listaSugestoes" style="margin-top: 0.75rem;"></div>
</section>

<section>
  <h2>Fila de moderação (lançamentos manuais)</h2>
  <div class="linha-botoes"><button class="secundario pequeno" id="btnCarregarModeracao">Carregar fila</button></div>
  <div id="msgModeracao"></div>
  <div id="listaModeracao" style="margin-top: 0.75rem;"></div>
</section>

<section>
  <h2>Fila de denúncias</h2>
  <div class="linha-botoes"><button class="secundario pequeno" id="btnCarregarDenuncias">Carregar fila</button></div>
  <div id="msgDenuncias"></div>
  <div id="listaDenuncias" style="margin-top: 0.75rem;"></div>
</section>

<section>
  <h2>Fila de códigos-loja suspeitos</h2>
  <p class="sub">O casamento por (loja + código interno) recusou estas linhas — a descrição/preço mudou o bastante para desconfiar que a loja reciclou o código para outro produto. Enquanto isso, o item continua resolvendo por descrição/alias normalmente. <strong>Confirmar</strong> mantém o produto atual (a descrição só variou); <strong>Reapontar</strong> aponta para outro produto (use a busca "Corrigir metadado de produto" acima para achar o produtoCanonicoId certo).</p>
  <div class="linha-botoes"><button class="secundario pequeno" id="btnCarregarFilaCodigoLoja">Carregar fila</button></div>
  <div id="msgFilaCodigoLoja"></div>
  <div id="listaFilaCodigoLoja" style="margin-top: 0.75rem;"></div>
</section>

<section>
  <h2>Reprocessamento retroativo</h2>
  <p class="sub">Re-enfileira QRs represados de uma UF (ou todas as suportadas, se em branco).</p>
  <label for="reprocUf">UF (opcional, 2 letras)</label>
  <input id="reprocUf" maxlength="2" placeholder="ex.: RJ" />
  <label for="reprocLimite">Limite (opcional)</label>
  <input id="reprocLimite" type="number" min="1" placeholder="ex.: 200" />
  <button id="btnReprocessar">Reprocessar</button>
  <div id="msgReprocessar"></div>
</section>

<script>
(function () {
  const CHAVE_TOKEN = 'barganha_curadoria_token';

  function pegarToken() {
    return localStorage.getItem(CHAVE_TOKEN) || '';
  }

  function atualizarStatusToken() {
    const el = document.getElementById('tokenStatus');
    const tok = pegarToken();
    if (tok) {
      el.textContent = 'Token salvo neste navegador (' + tok.length + ' caracteres).';
      el.classList.add('ok');
    } else {
      el.textContent = 'Nenhum token salvo neste navegador.';
      el.classList.remove('ok');
    }
  }

  document.getElementById('btnSalvarToken').addEventListener('click', function () {
    const valor = document.getElementById('token').value.trim();
    if (!valor) { return; }
    localStorage.setItem(CHAVE_TOKEN, valor);
    document.getElementById('token').value = '';
    atualizarStatusToken();
  });

  document.getElementById('btnLimparToken').addEventListener('click', function () {
    localStorage.removeItem(CHAVE_TOKEN);
    atualizarStatusToken();
  });

  atualizarStatusToken();

  function mostrarMsg(elId, texto, tipo) {
    const el = document.getElementById(elId);
    el.className = 'msg ' + (tipo === 'erro' ? 'erro' : 'ok');
    el.textContent = texto;
  }

  function limparMsg(elId) {
    const el = document.getElementById(elId);
    el.className = '';
    el.textContent = '';
  }

  async function chamar(caminho, opcoes) {
    const token = pegarToken();
    if (!token) {
      throw new Error('Salve o token de curadoria antes de continuar.');
    }
    const resposta = await fetch(caminho, Object.assign({}, opcoes, {
      headers: Object.assign(
        { 'Content-Type': 'application/json', Authorization: 'Bearer ' + token },
        (opcoes && opcoes.headers) || {}
      ),
    }));
    let corpo = null;
    try { corpo = await resposta.json(); } catch (e) { corpo = null; }
    if (!resposta.ok) {
      const detalhe = (corpo && (corpo.erro || corpo.message)) || resposta.statusText;
      if (resposta.status === 403) {
        throw new Error('Token inválido ou sem permissão (403). ' + (detalhe || ''));
      }
      if (resposta.status === 400) {
        throw new Error('Requisição inválida (400): ' + (detalhe || 'confira os campos.'));
      }
      if (resposta.status === 404) {
        throw new Error('Não encontrado (404): ' + (detalhe || ''));
      }
      throw new Error('Erro ' + resposta.status + ': ' + (detalhe || 'falha desconhecida.'));
    }
    return corpo;
  }

  function textoOuTraco(v) {
    return v === undefined || v === null || v === '' ? '—' : v;
  }

  // ── Busca de produtos (curadoria) ─────────────────────────────────────
  // Encontra o produto a corrigir sem exigir que o curador já saiba o
  // produtoCanonicoId de cor: clicar em "Editar" preenche o formulário abaixo.
  const buscaEstado = { termo: '', pagina: 1, tamanhoPagina: 20, total: 0 };

  function preencherFormularioEdicao(produto) {
    document.getElementById('prodId').value = produto.produtoCanonicoId || '';
    document.getElementById('prodEan').value = produto.ean || '';
    document.getElementById('prodNome').value = produto.nomeExibicao || '';
    document.getElementById('prodMarca').value = produto.marca || '';
    document.getElementById('prodCategoria').value = produto.categoria || '';
    limparMsg('msgEnriquecer');
  }

  async function carregarPaginaBusca() {
    limparMsg('msgBusca');
    const lista = document.getElementById('listaBusca');
    lista.innerHTML = '';
    try {
      const resp = await chamar(
        '/curadoria/produtos?q=' + encodeURIComponent(buscaEstado.termo) + '&pagina=' + buscaEstado.pagina,
        { method: 'GET' }
      );
      buscaEstado.total = resp.total;
      buscaEstado.pagina = resp.pagina;
      buscaEstado.tamanhoPagina = resp.tamanhoPagina;

      if (!resp.itens || resp.itens.length === 0) {
        mostrarMsg('msgBusca', 'Nenhum produto encontrado para esse termo.', 'ok');
      } else {
        resp.itens.forEach(function (p) {
          const div = document.createElement('div');
          div.className = 'sugestao';
          const info = document.createElement('span');
          info.textContent = textoOuTraco(p.nomeExibicao) + ' ';
          if (p.ean) {
            const badgeEan = document.createElement('span');
            badgeEan.className = 'badge';
            badgeEan.textContent = 'EAN ' + p.ean;
            info.appendChild(badgeEan);
          }
          if (p.marca) {
            const badgeMarca = document.createElement('span');
            badgeMarca.className = 'badge';
            badgeMarca.textContent = p.marca;
            info.appendChild(badgeMarca);
          }
          if (p.categoria) {
            const badgeCategoria = document.createElement('span');
            badgeCategoria.className = 'badge';
            badgeCategoria.textContent = p.categoria;
            info.appendChild(badgeCategoria);
          }
          const btn = document.createElement('button');
          btn.className = 'pequeno';
          btn.textContent = 'Editar';
          btn.addEventListener('click', function () { preencherFormularioEdicao(p); });
          div.appendChild(info);
          div.appendChild(btn);
          lista.appendChild(div);
        });
      }

      const totalPaginas = Math.max(Math.ceil(buscaEstado.total / buscaEstado.tamanhoPagina), 1);
      document.getElementById('infoPaginaBusca').textContent =
        'Página ' + buscaEstado.pagina + ' de ' + totalPaginas + ' (' + buscaEstado.total + ' produtos)';
      document.getElementById('paginacaoBusca').style.display = 'flex';
      document.getElementById('btnBuscaAnterior').disabled = buscaEstado.pagina <= 1;
      document.getElementById('btnBuscaProxima').disabled = buscaEstado.pagina >= totalPaginas;
    } catch (e) {
      document.getElementById('paginacaoBusca').style.display = 'none';
      mostrarMsg('msgBusca', e.message, 'erro');
    }
  }

  document.getElementById('btnBuscarProduto').addEventListener('click', function () {
    const termo = document.getElementById('buscaTermo').value.trim();
    if (!termo) {
      mostrarMsg('msgBusca', 'Informe um termo (nome ou EAN).', 'erro');
      return;
    }
    buscaEstado.termo = termo;
    buscaEstado.pagina = 1;
    carregarPaginaBusca();
  });

  document.getElementById('btnBuscaAnterior').addEventListener('click', function () {
    if (buscaEstado.pagina <= 1) return;
    buscaEstado.pagina -= 1;
    carregarPaginaBusca();
  });

  document.getElementById('btnBuscaProxima').addEventListener('click', function () {
    buscaEstado.pagina += 1;
    carregarPaginaBusca();
  });

  // ── Enriquecimento de produto ─────────────────────────────────────────
  document.getElementById('btnEnriquecer').addEventListener('click', async function () {
    limparMsg('msgEnriquecer');
    const corpo = {};
    const id = document.getElementById('prodId').value.trim();
    const ean = document.getElementById('prodEan').value.trim();
    const nomeExibicao = document.getElementById('prodNome').value.trim();
    const marca = document.getElementById('prodMarca').value.trim();
    const categoria = document.getElementById('prodCategoria').value.trim();
    const imagemUrl = document.getElementById('prodImagem').value.trim();
    if (id) corpo.produtoCanonicoId = id;
    if (ean) corpo.ean = ean;
    if (nomeExibicao) corpo.nomeExibicao = nomeExibicao;
    if (marca) corpo.marca = marca;
    if (categoria) corpo.categoria = categoria;
    if (imagemUrl) corpo.imagemUrl = imagemUrl;
    if (!corpo.produtoCanonicoId && !corpo.ean) {
      mostrarMsg('msgEnriquecer', 'Informe produtoCanonicoId ou EAN.', 'erro');
      return;
    }
    try {
      const resp = await chamar('/curadoria/produto', { method: 'POST', body: JSON.stringify(corpo) });
      mostrarMsg('msgEnriquecer', 'Produto atualizado: ' + resp.produtoCanonicoId, 'ok');
    } catch (e) {
      mostrarMsg('msgEnriquecer', e.message, 'erro');
    }
  });

  // ── Sugestões de casamento ────────────────────────────────────────────
  let ultimaDescricaoBuscada = '';

  document.getElementById('btnSugerir').addEventListener('click', async function () {
    limparMsg('msgSugerir');
    document.getElementById('listaSugestoes').innerHTML = '';
    const descricao = document.getElementById('casDescricao').value.trim();
    const unidadeBase = document.getElementById('casUnidade').value;
    if (!descricao) {
      mostrarMsg('msgSugerir', 'Informe a descrição.', 'erro');
      return;
    }
    ultimaDescricaoBuscada = descricao;
    try {
      const resp = await chamar('/curadoria/casamento/sugestoes', {
        method: 'POST',
        body: JSON.stringify({ descricao: descricao, unidadeBase: unidadeBase }),
      });
      const lista = document.getElementById('listaSugestoes');
      if (!resp.sugestoes || resp.sugestoes.length === 0) {
        mostrarMsg('msgSugerir', 'Nenhuma sugestão encontrada (provável produto novo).', 'ok');
        return;
      }
      resp.sugestoes.forEach(function (s) {
        const div = document.createElement('div');
        div.className = 'sugestao';
        const info = document.createElement('span');
        info.textContent = s.produtoCanonicoId;
        const badge = document.createElement('span');
        badge.className = 'badge';
        badge.textContent = 'confiança ' + (Math.round(s.confianca * 100)) + '%';
        info.appendChild(badge);
        const btn = document.createElement('button');
        btn.className = 'pequeno';
        btn.textContent = 'Confirmar';
        btn.addEventListener('click', async function () {
          limparMsg('msgSugerir');
          try {
            const confirmado = await chamar('/curadoria/casamento/confirmar', {
              method: 'POST',
              body: JSON.stringify({
                produtoCanonicoId: s.produtoCanonicoId,
                confianca: s.confianca,
                textoOriginal: ultimaDescricaoBuscada,
              }),
            });
            mostrarMsg('msgSugerir', 'Casamento confirmado (alias ' + confirmado.aliasId + ').', 'ok');
          } catch (e) {
            mostrarMsg('msgSugerir', e.message, 'erro');
          }
        });
        div.appendChild(info);
        div.appendChild(btn);
        lista.appendChild(div);
      });
    } catch (e) {
      mostrarMsg('msgSugerir', e.message, 'erro');
    }
  });

  // ── Fila de moderação ─────────────────────────────────────────────────
  document.getElementById('btnCarregarModeracao').addEventListener('click', async function () {
    limparMsg('msgModeracao');
    const lista = document.getElementById('listaModeracao');
    lista.innerHTML = '';
    try {
      const resp = await chamar('/moderacao/fila', { method: 'GET' });
      if (!resp.lancamentos || resp.lancamentos.length === 0) {
        mostrarMsg('msgModeracao', 'Fila vazia.', 'ok');
        return;
      }
      resp.lancamentos.forEach(function (l) {
        const div = document.createElement('div');
        div.className = 'item-fila';
        const pre = document.createElement('pre');
        pre.textContent = l.descricao + ' — ' + l.unidade + ' — R$ ' + l.valorUnitario +
          '\\nEAN ' + textoOuTraco(l.ean) + ' · loja ' + textoOuTraco(l.lojaCnpj) +
          ' · ' + textoOuTraco(l.municipio) + '/' + textoOuTraco(l.uf) +
          (l.emPromocao ? ' · PROMOÇÃO' : '');
        div.appendChild(pre);
        const botoes = document.createElement('div');
        botoes.className = 'linha-botoes';
        const btnAprovar = document.createElement('button');
        btnAprovar.className = 'pequeno';
        btnAprovar.textContent = 'Aprovar';
        const btnRejeitar = document.createElement('button');
        btnRejeitar.className = 'pequeno perigo';
        btnRejeitar.textContent = 'Rejeitar';
        async function decidir(decisao) {
          limparMsg('msgModeracao');
          let motivo;
          if (decisao === 'rejeitar') {
            motivo = window.prompt('Motivo da rejeição (opcional):') || undefined;
          }
          try {
            await chamar('/moderacao/' + l.id + '/decisao', {
              method: 'POST',
              body: JSON.stringify(motivo ? { decisao: decisao, motivo: motivo } : { decisao: decisao }),
            });
            mostrarMsg('msgModeracao', 'Decisão registrada: ' + decisao + '.', 'ok');
            div.remove();
          } catch (e) {
            mostrarMsg('msgModeracao', e.message, 'erro');
          }
        }
        btnAprovar.addEventListener('click', function () { decidir('aprovar'); });
        btnRejeitar.addEventListener('click', function () { decidir('rejeitar'); });
        botoes.appendChild(btnAprovar);
        botoes.appendChild(btnRejeitar);
        div.appendChild(botoes);
        lista.appendChild(div);
      });
    } catch (e) {
      mostrarMsg('msgModeracao', e.message, 'erro');
    }
  });

  // ── Fila de denúncias ─────────────────────────────────────────────────
  document.getElementById('btnCarregarDenuncias').addEventListener('click', async function () {
    limparMsg('msgDenuncias');
    const lista = document.getElementById('listaDenuncias');
    lista.innerHTML = '';
    try {
      const resp = await chamar('/denuncia/fila', { method: 'GET' });
      if (!resp.denuncias || resp.denuncias.length === 0) {
        mostrarMsg('msgDenuncias', 'Fila vazia.', 'ok');
        return;
      }
      resp.denuncias.forEach(function (d) {
        const div = document.createElement('div');
        div.className = 'item-fila';
        const pre = document.createElement('pre');
        pre.textContent = 'produto ' + d.produtoCanonicoId + ' — motivo: ' + d.motivo +
          '\\n' + textoOuTraco(d.municipio) + '/' + textoOuTraco(d.uf) +
          ' · abertas no produto: ' + d.abertasNoProduto +
          (d.comentario ? ('\\n"' + d.comentario + '"') : '');
        div.appendChild(pre);
        const botoes = document.createElement('div');
        botoes.className = 'linha-botoes';
        const btnProcedente = document.createElement('button');
        btnProcedente.className = 'pequeno';
        btnProcedente.textContent = 'Procedente';
        const btnImprocedente = document.createElement('button');
        btnImprocedente.className = 'pequeno secundario';
        btnImprocedente.textContent = 'Improcedente';
        async function decidir(procedente) {
          limparMsg('msgDenuncias');
          const resolucao = window.prompt('Resolução (opcional):') || undefined;
          try {
            await chamar('/denuncia/' + d.id + '/decisao', {
              method: 'POST',
              body: JSON.stringify(resolucao ? { procedente: procedente, resolucao: resolucao } : { procedente: procedente }),
            });
            mostrarMsg('msgDenuncias', 'Denúncia decidida.', 'ok');
            div.remove();
          } catch (e) {
            mostrarMsg('msgDenuncias', e.message, 'erro');
          }
        }
        btnProcedente.addEventListener('click', function () { decidir(true); });
        btnImprocedente.addEventListener('click', function () { decidir(false); });
        botoes.appendChild(btnProcedente);
        botoes.appendChild(btnImprocedente);
        div.appendChild(botoes);
        lista.appendChild(div);
      });
    } catch (e) {
      mostrarMsg('msgDenuncias', e.message, 'erro');
    }
  });

  // ── Fila de códigos-loja suspeitos (C3.6.2) ───────────────────────────
  function tempoDecorrido(iso) {
    if (!iso) return '—';
    var ms = Date.now() - new Date(iso).getTime();
    var minutos = Math.floor(ms / 60000);
    if (minutos < 60) return 'há ' + Math.max(minutos, 0) + ' min';
    var horas = Math.floor(minutos / 60);
    if (horas < 24) return 'há ' + horas + 'h';
    var dias = Math.floor(horas / 24);
    return 'há ' + dias + ' dia' + (dias === 1 ? '' : 's');
  }

  document.getElementById('btnCarregarFilaCodigoLoja').addEventListener('click', async function () {
    limparMsg('msgFilaCodigoLoja');
    const lista = document.getElementById('listaFilaCodigoLoja');
    lista.innerHTML = '';
    try {
      const resp = await chamar('/curadoria/fila-codigo-loja', { method: 'GET' });
      if (!resp.itens || resp.itens.length === 0) {
        mostrarMsg('msgFilaCodigoLoja', 'Fila vazia.', 'ok');
        return;
      }
      resp.itens.forEach(function (it) {
        const div = document.createElement('div');
        div.className = 'item-fila';
        const loja = it.lojaRazaoSocial || it.lojaNomeFantasia || it.lojaCnpj;
        const produtoAtual = it.produtoCanonico.nomeExibicao || it.produtoCanonico.descricaoNormalizada;
        const pre = document.createElement('pre');
        pre.textContent =
          loja + ' (' + it.lojaCnpj + ') · código ' + it.codigo +
          '\\nstatus: ' + it.status + (it.motivoSuspeita ? ' — ' + it.motivoSuspeita : '') +
          '\\ndescrição de referência: ' + it.descricaoReferencia + ' (' + it.unidadeBase + ')' +
          '\\nproduto atual: ' + produtoAtual + textoOuTraco(it.produtoCanonico.ean ? ' · EAN ' + it.produtoCanonico.ean : '') +
          '\\nhits: ' + it.hits + ' · último uso: ' + it.ultimoVisto + ' · atualizado ' + tempoDecorrido(it.atualizadoEm);
        div.appendChild(pre);
        const botoes = document.createElement('div');
        botoes.className = 'linha-botoes';
        const btnConfirmar = document.createElement('button');
        btnConfirmar.className = 'pequeno';
        btnConfirmar.textContent = 'Confirmar (produto atual está certo)';
        const btnReapontar = document.createElement('button');
        btnReapontar.className = 'pequeno secundario';
        btnReapontar.textContent = 'Reapontar para outro produto';
        btnConfirmar.addEventListener('click', async function () {
          limparMsg('msgFilaCodigoLoja');
          try {
            await chamar('/curadoria/fila-codigo-loja/confirmar', {
              method: 'POST',
              body: JSON.stringify({ lojaCnpj: it.lojaCnpj, codigo: it.codigo }),
            });
            mostrarMsg('msgFilaCodigoLoja', 'Mapeamento confirmado.', 'ok');
            div.remove();
          } catch (e) {
            mostrarMsg('msgFilaCodigoLoja', e.message, 'erro');
          }
        });
        btnReapontar.addEventListener('click', async function () {
          limparMsg('msgFilaCodigoLoja');
          const novoId = window.prompt(
            'produtoCanonicoId do produto correto (use a busca "Corrigir metadado de produto" acima para achar):'
          );
          if (!novoId) return;
          try {
            const resp = await chamar('/curadoria/fila-codigo-loja/reapontar', {
              method: 'POST',
              body: JSON.stringify({ lojaCnpj: it.lojaCnpj, codigo: it.codigo, produtoCanonicoId: novoId.trim() }),
            });
            mostrarMsg('msgFilaCodigoLoja', 'Reapontado (' + resp.resultado + ').', 'ok');
            div.remove();
          } catch (e) {
            mostrarMsg('msgFilaCodigoLoja', e.message, 'erro');
          }
        });
        botoes.appendChild(btnConfirmar);
        botoes.appendChild(btnReapontar);
        div.appendChild(botoes);
        lista.appendChild(div);
      });
    } catch (e) {
      mostrarMsg('msgFilaCodigoLoja', e.message, 'erro');
    }
  });

  // ── Reprocessamento ───────────────────────────────────────────────────
  document.getElementById('btnReprocessar').addEventListener('click', async function () {
    limparMsg('msgReprocessar');
    const uf = document.getElementById('reprocUf').value.trim();
    const limiteStr = document.getElementById('reprocLimite').value.trim();
    const corpo = {};
    if (uf) corpo.uf = uf.toUpperCase();
    if (limiteStr) corpo.limite = Number(limiteStr);
    try {
      const resp = await chamar('/curadoria/reprocessar', { method: 'POST', body: JSON.stringify(corpo) });
      mostrarMsg('msgReprocessar', 'Reenfileirados: ' + resp.reenfileirados + '.', 'ok');
    } catch (e) {
      mostrarMsg('msgReprocessar', e.message, 'erro');
    }
  });
})();
</script>
</body>
</html>
`;
