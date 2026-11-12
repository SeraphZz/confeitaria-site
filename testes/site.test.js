'use strict';
// Páginas, arquivos estáticos, cabeçalhos de segurança e regras gerais da API.

const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { subirServidor } = require('./apoio');

let servidor, visitante;
before(async () => { servidor = await subirServidor(); visitante = servidor.navegador(); });
after(() => servidor.parar());

test('páginas públicas respondem com HTML', async () => {
  for (const caminho of ['/', '/sobre', '/carrinho', '/login', '/cadastro', '/conta', '/esqueci-senha', '/redefinir-senha', '/admin', '/doce/brigadeiro-gourmet']) {
    const r = await visitante.get(caminho);
    assert.equal(r.status, 200, caminho);
    assert.match(r.cabecalhos.get('content-type'), /text\/html/, caminho);
  }
});

test('arquivos de css e js são servidos com o tipo certo', async () => {
  const css = await visitante.get('/css/site.css');
  assert.equal(css.status, 200);
  assert.match(css.cabecalhos.get('content-type'), /text\/css/);
  const js = await visitante.get('/js/app.js');
  assert.equal(js.status, 200);
  assert.match(js.cabecalhos.get('content-type'), /text\/javascript/);
});

test('respostas levam os cabeçalhos de segurança', async () => {
  for (const caminho of ['/', '/api/site', '/nao-existe']) {
    const r = await visitante.get(caminho);
    assert.equal(r.cabecalhos.get('x-content-type-options'), 'nosniff', caminho);
    assert.equal(r.cabecalhos.get('x-frame-options'), 'DENY', caminho);
    assert.match(r.cabecalhos.get('content-security-policy'), /script-src 'self'/, caminho);
  }
});

test('caminho desconhecido devolve 404', async () => {
  assert.equal((await visitante.get('/nao-existe')).status, 404);
  assert.equal((await visitante.get('/api/nao-existe')).status, 404);
  assert.equal((await visitante.get('/css/nao-existe.css')).status, 404);
});

test('não é possível sair das pastas públicas com "../"', async () => {
  for (const caminho of ['/css/..%2fserver.js', '/js/..%2f..%2fbanco.js', '/uploads/..%2floja.db', '/css/%2e%2e%2fpackage.json']) {
    const r = await visitante.get(caminho);
    assert.equal(r.status, 404, caminho);
    assert.doesNotMatch(r.texto, /require\(|"scripts"|SQLite format/, caminho);
  }
});

test('arquivos fora das pastas públicas não são servidos', async () => {
  for (const caminho of ['/server.js', '/banco.js', '/package.json', '/data/loja.db', '/.gitignore']) {
    assert.equal((await visitante.get(caminho)).status, 404, caminho);
  }
});

test('/api/site entrega os dados da loja e nenhum segredo', async () => {
  const r = await visitante.get('/api/site');
  assert.equal(r.status, 200);
  assert.equal(r.dados.admin, false);
  assert.equal(r.dados.cliente, null);
  assert.equal(typeof r.dados.loja.nome, 'string');
  assert.equal(typeof r.dados.sobre.titulo, 'string');
  assert.doesNotMatch(r.texto, /hash|salt|senha/i);
});

test('a API só aceita gravações em JSON', async () => {
  const r = await visitante.pedir('POST', '/api/login', 'usuario=a&senha=b', { 'Content-Type': 'application/x-www-form-urlencoded' });
  assert.equal(r.status, 415);
  const invalido = await visitante.pedir('POST', '/api/login', '{quebrado', { 'Content-Type': 'application/json' });
  assert.equal(invalido.status, 400);
  const lista = await visitante.pedir('POST', '/api/login', '[1,2]', { 'Content-Type': 'application/json' });
  assert.equal(lista.status, 400);
});

test('métodos de gravação fora da API são recusados', async () => {
  assert.equal((await visitante.post('/')).status, 405);
});

test('primeira execução cria o cardápio de exemplo', async () => {
  const r = await visitante.get('/api/doces');
  assert.equal(r.status, 200);
  assert.equal(r.dados.length, 6);
  const doce = r.dados[0];
  assert.deepEqual(Object.keys(doce).sort(), ['descricao', 'disponivel', 'emoji', 'id', 'imagem', 'nome', 'preco', 'slug', 'unidade']);
  const porSlug = await visitante.get(`/api/doces/${doce.slug}`);
  assert.equal(porSlug.dados.id, doce.id);
  assert.equal((await visitante.get('/api/doces/nao-existe')).status, 404);
});
