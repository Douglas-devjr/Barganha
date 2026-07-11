/**
 * Detectores de páginas de DEFESA/ERRO dos portais SEFAZ (C2.6). O esqueleto da
 * página `avisoErro` reproduz a captura real do RJ (backend/.debug-html, jul/2026):
 * pós-postback com reCAPTCHA recusado — sem itens, sem formulário, um beco sem
 * saída que antes ia ao parser e marcava o cupom como `falha` permanente.
 */

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import { pareceDefesaAntiBot, pareceErroPortal } from './html';

const NOTA_RJ = readFileSync(
  fileURLToPath(new URL('./__fixtures__/rj-nota-1.html', import.meta.url)),
  'utf8',
);

const PAGINA_DESAFIO = `
<html><head id="j_idt2"></head><body>
  <h1 class="titulopagina">Consulta DFe</h1>
  <form id="formulario">
    <input id="btSubmitQRCode" type="submit"/>
    <input id="recaptchaResponse" type="hidden"/>
  </form>
  <script>grecaptcha.execute('chave',{action:'consulta'})</script>
</body></html>`;

const PAGINA_AVISO_ERRO = `
<html class="ui-mobile"><head id="j_idt2"><base href="https://consultadfe.fazenda.rj.gov.br/"/></head>
<body class="ui-mobile-viewport ui-overlay-a">
  <div class="ui-page ui-page-theme-a ui-page-active">
    <title>Erro na consulta</title>
    <div class="avisoErro"></div>
    <iframe src="about:blank"></iframe>
  </div>
  <div class="ui-loader ui-corner-all"><span class="ui-icon-loading"></span><h1>loading</h1></div>
</body></html>`;

describe('pareceErroPortal (C2.6)', () => {
  it('reconhece a página avisoErro do RJ (reCAPTCHA recusado)', () => {
    expect(pareceErroPortal(PAGINA_AVISO_ERRO)).toBe(true);
  });

  it('não confunde a nota ENCAT real com erro do portal', () => {
    expect(pareceErroPortal(NOTA_RJ)).toBe(false);
  });

  it('não confunde a página de desafio (essa se resolve esperando)', () => {
    expect(pareceErroPortal(PAGINA_DESAFIO)).toBe(false);
  });

  it('ignora avisoErro quando a tabela de itens está presente (é uma nota)', () => {
    const notaComAviso = `<html><body><div class="avisoErro"></div><table id="tabResult"></table></body></html>`;
    expect(pareceErroPortal(notaComAviso)).toBe(false);
  });
});

describe('pareceDefesaAntiBot', () => {
  it('reconhece o gate reCAPTCHA v3 (grecaptcha.execute)', () => {
    expect(pareceDefesaAntiBot(PAGINA_DESAFIO)).toBe(true);
  });

  it('reconhece a página de bloqueio por IP', () => {
    expect(pareceDefesaAntiBot('<a href="https://meuip.com.br">seu IP</a>')).toBe(true);
  });

  it('não acusa a nota real', () => {
    expect(pareceDefesaAntiBot(NOTA_RJ)).toBe(false);
  });
});
