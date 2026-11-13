'use strict';
// Tema da loja: cores, fonte dos títulos e imagens viram CSS em /tema.css, sem abrir espaço para injeção.
// As alterações ficam como rascunho (só o painel vê) até serem publicadas.

const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { subirServidor, dadosCliente, PNG_1X1 } = require('./apoio');
const { gerarCss, contraste, legivelComoTexto, normalizarCor, imagemSegura, FONTES } = require('../src/tema');

const PADRAO = { corPrincipal: '', corSecundaria: '', fonteTitulos: 'classica', logo: '', favicon: '', banner: '' };

let servidor, loja, visitante;
before(async () => {
  servidor = await subirServidor();
  loja = servidor.navegador();
  await loja.entrarComoAdmin();
  visitante = servidor.navegador();
});
after(() => servidor.parar());

const css = async (quem = visitante) => (await quem.get('/tema.css')).texto;
const variavel = (texto, nome) => new RegExp(`${nome}: ([^;]+);`).exec(texto)?.[1];
const arquivos = () => fs.readdirSync(path.join(servidor.pasta, 'uploads')).sort();
const nomeDe = (caminho) => path.basename(caminho);

// Salva no rascunho e publica em seguida: o caminho completo até os clientes.
async function aplicar(corpo) {
  const r = await loja.put('/api/tema/rascunho', corpo);
  if (r.status !== 200) return r;
  return loja.post('/api/tema/publicar');
}
// Volta ao visual padrão, sem imagens e sem rascunho.
async function limpar() {
  await loja.delete('/api/tema/rascunho');
  for (const qual of ['logo', 'favicon', 'banner']) await loja.put(`/api/tema/rascunho/imagem/${qual}`, { imagem: '' });
  await loja.put('/api/tema/rascunho', {});
  const r = await loja.post('/api/tema/publicar');
  assert.deepEqual(r.dados, { publicado: PADRAO, rascunho: null });
  assert.deepEqual(arquivos(), []);
}

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
  // A resposta muda conforme quem pede (painel vê o rascunho): nenhum cache pode servi-la a outra pessoa.
  assert.match(r.cabecalhos.get('cache-control'), /private/);
  assert.equal(r.cabecalhos.get('vary'), 'Cookie');
  assert.doesNotMatch(r.texto, /:root|\.capa/);
  const site = (await visitante.get('/api/site')).dados;
  assert.deepEqual(site.tema, PADRAO);
  assert.equal(site.previaTema, false);
});

test('todas as páginas carregam o tema depois do CSS padrão', async () => {
  for (const pagina of fs.readdirSync(path.join(__dirname, '..', 'pages'))) {
    const html = fs.readFileSync(path.join(__dirname, '..', 'pages', pagina), 'utf8');
    assert.ok(html.indexOf('/css/site.css') > 0 && html.indexOf('/tema.css') > html.indexOf('/css/site.css'), pagina);
  }
});

test('só a loja mexe na aparência', async () => {
  const cliente = servidor.navegador();
  await cliente.post('/api/cadastro', dadosCliente());
  for (const quem of [visitante, cliente]) {
    assert.equal((await quem.get('/api/tema')).status, 401);
    assert.equal((await quem.put('/api/tema/rascunho', { corPrincipal: '#000000' })).status, 401);
    assert.equal((await quem.put('/api/tema/rascunho/imagem/logo', { imagem: PNG_1X1 })).status, 401);
    assert.equal((await quem.post('/api/tema/publicar')).status, 401);
    assert.equal((await quem.delete('/api/tema/rascunho')).status, 401);
  }
  // A gravação direta do tema, sem passar pelo rascunho, não existe: nem para a loja.
  assert.equal((await loja.put('/api/configuracoes/tema', { corPrincipal: '#000000' })).status, 404);
  assert.equal((await loja.put('/api/configuracoes/temaRascunho', { corPrincipal: '#000000' })).status, 404);
  assert.equal('tema' in (await loja.get('/api/configuracoes')).dados, false);
});

test('valores inválidos são recusados e não criam rascunho', async () => {
  const ruins = [
    { corPrincipal: 'red' }, { corPrincipal: '#fff' }, { corSecundaria: '#12345g' },
    { corPrincipal: '#000000; } body { display: none } :root { --x: 1' }, { corPrincipal: 'url(https://evil.example/x)' },
    { corPrincipal: ['#000000'] }, { fonteTitulos: 'Comic Sans' }, { fonteTitulos: 'constructor' }, { fonteTitulos: 5 },
    { fonteTitulos: "x; } body { background: url('//evil.example') }" },
  ];
  for (const corpo of ruins) assert.equal((await loja.put('/api/tema/rascunho', corpo)).status, 400, JSON.stringify(corpo));
  assert.equal((await loja.get('/api/tema')).dados.rascunho, null);
  assert.doesNotMatch(await css(loja), /:root|evil|display/);
});

test('rascunho: só o painel vê; os clientes continuam com o tema publicado', async () => {
  const cliente = servidor.navegador();
  await cliente.post('/api/cadastro', dadosCliente());

  const r = await loja.put('/api/tema/rascunho', { corPrincipal: '#006D77', fonteTitulos: 'moderna' });
  assert.equal(r.status, 200);
  assert.deepEqual(r.dados.publicado, PADRAO);
  assert.deepEqual(r.dados.rascunho, { ...PADRAO, corPrincipal: '#006d77', fonteTitulos: 'moderna' });

  // Painel: vê a prévia em todo o site.
  assert.equal(variavel(await css(loja), '--destaque'), '#006d77');
  const sitePainel = (await loja.get('/api/site')).dados;
  assert.equal(sitePainel.previaTema, true);
  assert.equal(sitePainel.tema.corPrincipal, '#006d77');

  // Visitante e cliente logado: nada mudou, e nem ficam sabendo que existe rascunho.
  for (const quem of [visitante, cliente]) {
    assert.doesNotMatch(await css(quem), /:root/);
    const site = (await quem.get('/api/site')).dados;
    assert.equal(site.previaTema, false);
    assert.deepEqual(site.tema, PADRAO);
    assert.doesNotMatch(JSON.stringify(site), /006d77|Rascunho|rascunho/);
  }

  // Sair do painel devolve a visão de cliente no mesmo navegador.
  const outro = servidor.navegador();
  await outro.entrarComoAdmin();
  assert.match(await css(outro), /#006d77/);
  await outro.post('/api/logout');
  assert.doesNotMatch(await css(outro), /:root/);
});

test('publicar leva o rascunho aos clientes; descartar joga fora', async () => {
  const r = await loja.post('/api/tema/publicar');
  assert.equal(r.dados.rascunho, null);
  assert.equal(r.dados.publicado.corPrincipal, '#006d77');
  assert.equal(variavel(await css(), '--destaque'), '#006d77');
  assert.equal((await loja.get('/api/site')).dados.previaTema, false);
  // Publicar de novo, sem rascunho, não muda nada.
  assert.deepEqual((await loja.post('/api/tema/publicar')).dados, r.dados);

  await loja.put('/api/tema/rascunho', { corPrincipal: '#ff0000', fonteTitulos: 'moderna' });
  assert.equal(variavel(await css(loja), '--destaque'), '#ff0000');
  const d = await loja.delete('/api/tema/rascunho');
  assert.equal(d.dados.rascunho, null);
  assert.equal(d.dados.publicado.corPrincipal, '#006d77');
  assert.equal(variavel(await css(loja), '--destaque'), '#006d77');
  assert.deepEqual((await loja.delete('/api/tema/rascunho')).dados, d.dados, 'descartar sem rascunho não muda nada');
});

test('rascunho igual ao publicado deixa de ser rascunho', async () => {
  await loja.put('/api/tema/rascunho', { corPrincipal: '#123456', fonteTitulos: 'moderna' });
  assert.notEqual((await loja.get('/api/tema')).dados.rascunho, null);
  const r = await loja.put('/api/tema/rascunho', { corPrincipal: '#006d77', fonteTitulos: 'moderna' });
  assert.equal(r.dados.rascunho, null);
  assert.equal((await loja.get('/api/site')).dados.previaTema, false);
  await limpar();
});

test('cor principal clara e faixa escura: textos continuam legíveis', async () => {
  const r = await aplicar({ corPrincipal: '#F5C518', corSecundaria: '#1b1b1b', fonteTitulos: 'moderna' });
  assert.equal(r.status, 200);
  assert.equal(r.dados.publicado.corPrincipal, '#f5c518');
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
  await aplicar({ corPrincipal: '', corSecundaria: '#e3f2fd' });
  const texto = await css();
  assert.equal(variavel(texto, '--faixa'), '#e3f2fd');
  assert.equal(variavel(texto, '--marca'), '#e3f2fd');
  assert.equal(variavel(texto, '--texto-na-faixa'), 'var(--tinta)');
  assert.equal(variavel(texto, '--destaque'), '#b8436a', 'sem cor principal escolhida, vale a padrão');
  assert.equal(variavel(texto, '--fonte-titulos'), undefined, 'fonte omitida volta para a padrão');

  await aplicar({});
  assert.doesNotMatch(await css(), /:root/);
});

test('imagens: entram no rascunho, só valem para os clientes depois de publicar', async () => {
  assert.equal((await visitante.get('/favicon.ico')).status, 404);
  assert.equal((await loja.put('/api/tema/rascunho/imagem/capa', { imagem: PNG_1X1 })).status, 404, 'só logo, favicon e banner');
  assert.equal((await loja.put('/api/tema/rascunho/imagem/logo', { imagem: 'data:image/svg+xml;base64,PHN2Zz48L3N2Zz4=' })).status, 400);
  assert.equal((await loja.get('/api/tema')).dados.rascunho, null);

  let estado;
  for (const qual of ['logo', 'favicon', 'banner']) {
    const r = await loja.put(`/api/tema/rascunho/imagem/${qual}`, { imagem: PNG_1X1 });
    assert.equal(r.status, 200, qual);
    assert.match(r.dados.rascunho[qual], new RegExp(`^/uploads/${qual}-\\d+\\.png$`));
    assert.equal(r.dados.publicado[qual], '');
    estado = r.dados;
  }
  const tema = estado.rascunho;

  // Antes de publicar: o painel vê, o visitante não.
  assert.equal((await loja.get('/favicon.ico')).status, 200);
  assert.equal((await visitante.get('/favicon.ico')).status, 404);
  assert.ok((await css(loja)).includes(`url("${tema.banner}")`));
  assert.doesNotMatch(await css(), /\.capa/);
  assert.equal((await visitante.get('/api/site')).dados.tema.logo, '');

  await loja.post('/api/tema/publicar');
  const icone = await visitante.get('/favicon.ico');
  assert.equal(icone.status, 200);
  assert.equal(icone.cabecalhos.get('content-type'), 'image/png');
  assert.ok((await css()).includes(`url("${tema.banner}")`));
  assert.equal((await visitante.get((await visitante.get('/api/site')).dados.tema.logo)).status, 200);

  // Salvar cores não mexe nas imagens, e ninguém consegue trocar o endereço delas pelo formulário de cores.
  const depois = await aplicar({ corPrincipal: '#006d77', logo: 'https://evil.example/x.png', banner: '") } body { display:none } .x { y: url("' });
  assert.equal(depois.dados.publicado.logo, tema.logo);
  assert.equal(depois.dados.publicado.banner, tema.banner);
  assert.doesNotMatch(await css(), /evil|display/);
});

test('arquivos de imagem: nada que esteja no ar é apagado por causa do rascunho, e nada fica sobrando', async () => {
  const noAr = (await loja.get('/api/tema')).dados.publicado;
  assert.equal(arquivos().length, 3);

  // Trocar o logotipo no rascunho: o arquivo publicado continua lá, porque os clientes ainda o veem.
  await new Promise((resolve) => setTimeout(resolve, 5)); // o nome do arquivo leva o horário
  const r1 = (await loja.put('/api/tema/rascunho/imagem/logo', { imagem: PNG_1X1 })).dados;
  assert.notEqual(r1.rascunho.logo, noAr.logo);
  assert.equal((await visitante.get(noAr.logo)).status, 200);
  assert.equal(arquivos().length, 4);

  // Trocar de novo: o logotipo intermediário, que só existia no rascunho, some.
  await new Promise((resolve) => setTimeout(resolve, 5));
  const r2 = (await loja.put('/api/tema/rascunho/imagem/logo', { imagem: PNG_1X1 })).dados;
  assert.ok(!arquivos().includes(nomeDe(r1.rascunho.logo)));
  assert.equal(arquivos().length, 4);

  // Remover o banner só no rascunho: o arquivo fica, o site dos clientes não muda.
  await loja.put('/api/tema/rascunho/imagem/banner', { imagem: '' });
  assert.equal((await visitante.get(noAr.banner)).status, 200);
  assert.ok((await css()).includes(noAr.banner));
  assert.doesNotMatch(await css(loja), /\.capa/);

  // Descartar: some o que era só do rascunho; o que está no ar fica intacto.
  await loja.delete('/api/tema/rascunho');
  assert.deepEqual(arquivos(), [noAr.banner, noAr.favicon, noAr.logo].map(nomeDe).sort());
  assert.ok(!arquivos().includes(nomeDe(r2.rascunho.logo)));

  // Publicar uma troca: o arquivo antigo, que ninguém mais usa, é apagado.
  await new Promise((resolve) => setTimeout(resolve, 5));
  const r3 = (await loja.put('/api/tema/rascunho/imagem/logo', { imagem: PNG_1X1 })).dados;
  await loja.post('/api/tema/publicar');
  assert.equal((await visitante.get(noAr.logo)).status, 404);
  assert.equal((await visitante.get(r3.rascunho.logo)).status, 200);
  assert.equal(arquivos().length, 3);

  await limpar();
  assert.equal((await visitante.get('/favicon.ico')).status, 404);
  assert.doesNotMatch(await css(), /\.capa|:root/);
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

test('tela de Aparência recebe o estado e a lista de fontes', async () => {
  const r = (await loja.get('/api/tema')).dados;
  assert.deepEqual(r.publicado, PADRAO);
  assert.equal(r.rascunho, null);
  assert.equal(r.fontePadrao, 'classica');
  assert.deepEqual(r.fontes.map((f) => f.id), Object.keys(FONTES));
});
