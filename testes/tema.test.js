'use strict';
// Tema da loja: cores, fonte dos títulos e imagens viram CSS em /tema.css, sem abrir espaço para injeção.

const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { subirServidor, PNG_1X1 } = require('./apoio');
const { gerarCss, contraste, legivelComoTexto, normalizarCor, imagemSegura, FONTES } = require('../src/tema');

let servidor, loja, visitante;
before(async () => {
  servidor = await subirServidor();
  loja = servidor.navegador();
  await loja.entrarComoAdmin();
  visitante = servidor.navegador();
});
after(() => servidor.parar());

const css = async () => (await visitante.get('/tema.css')).texto;
const variavel = (texto, nome) => new RegExp(`${nome}: ([^;]+);`).exec(texto)?.[1];

test('contas de cor: contraste e ajuste de legibilidade', () => {
  assert.equal(Math.round(contraste('#000000', '#ffffff')), 21);
  assert.equal(contraste('#777777', '#777777'), 1);
  assert.equal(legivelComoTexto('#b8436a'), '#b8436a', 'cor que já dá leitura não muda');
  const amarelo = legivelComoTexto('#ffe600');
  assert.notEqual(amarelo, '#ffe600');
  assert.ok(contraste(amarelo, '#ffffff') >= 4.5);
  assert.equal(normalizarCor(' #AbCdEf '), '#abcdef');
  for (const ruim of ['red', '#fff', '#12345g', 'rgb(1,2,3)', '#123456; x', null, 7, {}]) assert.equal(normalizarCor(ruim), null, String(ruim));
});

test('visual padrão: /tema.css não troca nenhuma variável', async () => {
  const r = await visitante.get('/tema.css');
  assert.equal(r.status, 200);
  assert.match(r.cabecalhos.get('content-type'), /text\/css/);
  assert.equal(r.cabecalhos.get('x-content-type-options'), 'nosniff');
  assert.doesNotMatch(r.texto, /:root|\.capa/);
  assert.deepEqual((await visitante.get('/api/site')).dados.tema, { corPrincipal: '', corSecundaria: '', fonteTitulos: 'classica', logo: '', favicon: '', banner: '' });
});

test('todas as páginas carregam o tema depois do CSS padrão', async () => {
  for (const pagina of fs.readdirSync(path.join(__dirname, '..', 'pages'))) {
    const html = fs.readFileSync(path.join(__dirname, '..', 'pages', pagina), 'utf8');
    assert.ok(html.indexOf('/css/site.css') > 0 && html.indexOf('/tema.css') > html.indexOf('/css/site.css'), pagina);
  }
});

test('só a loja altera o tema; valores inválidos são recusados', async () => {
  assert.equal((await visitante.put('/api/configuracoes/tema', { corPrincipal: '#000000' })).status, 401);
  assert.equal((await visitante.put('/api/tema/imagem/logo', { imagem: PNG_1X1 })).status, 401);
  assert.equal((await visitante.get('/api/tema/opcoes')).status, 401);
  const ruins = [
    { corPrincipal: 'red' }, { corPrincipal: '#fff' }, { corSecundaria: '#12345g' },
    { corPrincipal: '#000000; } body { display: none } :root { --x: 1' }, { corPrincipal: 'url(https://evil.example/x)' },
    { corPrincipal: ['#000000'] }, { fonteTitulos: 'Comic Sans' }, { fonteTitulos: 'constructor' }, { fonteTitulos: 5 },
    { fonteTitulos: "x; } body { background: url('//evil.example') }" },
  ];
  for (const corpo of ruins) assert.equal((await loja.put('/api/configuracoes/tema', corpo)).status, 400, JSON.stringify(corpo));
  assert.doesNotMatch(await css(), /:root|evil|display/);
});

test('cor principal clara e faixa escura: textos continuam legíveis', async () => {
  const r = await loja.put('/api/configuracoes/tema', { corPrincipal: '#F5C518', corSecundaria: '#1b1b1b', fonteTitulos: 'moderna' });
  assert.equal(r.status, 200);
  assert.equal(r.dados.corPrincipal, '#f5c518');
  const texto = await css();
  assert.equal(variavel(texto, '--destaque'), '#f5c518');
  assert.equal(variavel(texto, '--faixa'), '#1b1b1b');
  assert.equal(variavel(texto, '--texto-na-faixa'), '#ffffff');
  assert.equal(variavel(texto, '--fonte-titulos'), FONTES.moderna.css);
  // Amarelo não dá leitura como texto nem com letra branca em cima: o tema corrige os dois casos.
  assert.ok(contraste(variavel(texto, '--destaque-texto'), '#ffffff') >= 4.5);
  assert.ok(contraste(variavel(texto, '--bs-primary-contrast'), '#f5c518') >= 4.5);
  // Os detalhes claros do site (bordas, selos) usam um tom claro da faixa, não o preto cheio.
  assert.ok(contraste(variavel(texto, '--marca'), '#ffffff') < 1.5);
});

test('faixa clara mantém texto escuro; voltar ao padrão limpa o CSS', async () => {
  await loja.put('/api/configuracoes/tema', { corPrincipal: '', corSecundaria: '#e3f2fd' });
  let texto = await css();
  assert.equal(variavel(texto, '--faixa'), '#e3f2fd');
  assert.equal(variavel(texto, '--marca'), '#e3f2fd');
  assert.equal(variavel(texto, '--texto-na-faixa'), 'var(--tinta)');
  assert.equal(variavel(texto, '--destaque'), '#b8436a', 'sem cor principal escolhida, vale a padrão');
  assert.equal(variavel(texto, '--fonte-titulos'), undefined, 'fonte omitida volta para a padrão');

  await loja.put('/api/configuracoes/tema', {});
  texto = await css();
  assert.doesNotMatch(texto, /:root/);
});

test('imagens do tema: envio, uso no CSS e no ícone da aba, e remoção', async () => {
  assert.equal((await visitante.get('/favicon.ico')).status, 404);
  assert.equal((await loja.put('/api/tema/imagem/capa', { imagem: PNG_1X1 })).status, 404, 'só logo, favicon e banner');
  assert.equal((await loja.put('/api/tema/imagem/logo', { imagem: 'data:image/svg+xml;base64,PHN2Zz48L3N2Zz4=' })).status, 400);

  for (const qual of ['logo', 'favicon', 'banner']) {
    const r = await loja.put(`/api/tema/imagem/${qual}`, { imagem: PNG_1X1 });
    assert.equal(r.status, 200, qual);
    assert.match(r.dados[qual], new RegExp(`^/uploads/${qual}-\\d+\\.png$`));
  }
  const { tema } = (await visitante.get('/api/site')).dados;
  assert.equal((await visitante.get(tema.logo)).status, 200);

  const icone = await visitante.get('/favicon.ico');
  assert.equal(icone.status, 200);
  assert.equal(icone.cabecalhos.get('content-type'), 'image/png');

  const texto = await css();
  assert.ok(texto.includes(`url("${tema.banner}")`));

  // Salvar cores não mexe nas imagens, e ninguém consegue trocar o endereço delas pelo formulário de cores.
  const depois = await loja.put('/api/configuracoes/tema', { corPrincipal: '#006d77', logo: 'https://evil.example/x.png', banner: '") } body { display:none } .x { y: url("' });
  assert.equal(depois.dados.logo, tema.logo);
  assert.equal(depois.dados.banner, tema.banner);
  assert.doesNotMatch(await css(), /evil|display/);

  // Trocar apaga o arquivo antigo; remover apaga o atual.
  await new Promise((resolve) => setTimeout(resolve, 5));
  const novoLogo = (await loja.put('/api/tema/imagem/logo', { imagem: PNG_1X1 })).dados.logo;
  assert.notEqual(novoLogo, tema.logo);
  assert.equal((await visitante.get(tema.logo)).status, 404);
  for (const qual of ['logo', 'favicon', 'banner']) assert.equal((await loja.put(`/api/tema/imagem/${qual}`, { imagem: '' })).dados[qual], '');
  assert.deepEqual(fs.readdirSync(path.join(servidor.pasta, 'uploads')), []);
  assert.equal((await visitante.get('/favicon.ico')).status, 404);
  assert.doesNotMatch(await css(), /\.capa/);
});

test('gerador de CSS ignora valores que não passaram pela validação (banco adulterado)', () => {
  const texto = gerarCss({
    corPrincipal: 'red; } * { display: none', corSecundaria: 'javascript:alert(1)', fonteTitulos: 'inexistente',
    banner: '/uploads/x.png") } body { display: none } .y { z: url("',
  });
  assert.doesNotMatch(texto, /:root|display|javascript|\.capa/);
  assert.equal(imagemSegura('/uploads/../loja.db'), '');
  assert.equal(imagemSegura('//evil.example/a.png'), '');
  assert.equal(imagemSegura('/uploads/banner-123.webp'), '/uploads/banner-123.webp');
});

test('lista de fontes para a tela de Aparência', async () => {
  const r = (await loja.get('/api/tema/opcoes')).dados;
  assert.equal(r.fontePadrao, 'classica');
  assert.deepEqual(r.fontes.map((f) => f.id), Object.keys(FONTES));
});
