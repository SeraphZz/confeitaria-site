'use strict';
// Categorias de produtos: a loja cria, renomeia, ordena e exclui; o visitante só consulta.

const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { subirServidor } = require('./apoio');

let servidor, loja, visitante;
before(async () => {
  servidor = await subirServidor();
  loja = servidor.navegador();
  await loja.entrarComoAdmin();
  visitante = servidor.navegador();
});
after(() => servidor.parar());

const nomes = async (quem = visitante) => (await quem.get('/api/categorias')).dados.map((c) => c.nome);
const criar = async (nome) => (await loja.post('/api/categorias', { nome })).dados;

test('instalação sem categorias: lista vazia e produtos sem categoria', async () => {
  assert.deepEqual((await visitante.get('/api/categorias')).dados, []);
  const produtos = (await visitante.get('/api/produtos')).dados;
  assert.ok(produtos.length > 0);
  assert.ok(produtos.every((p) => p.categoriaId === null));
});

test('só a loja cria, altera, ordena e exclui categorias', async () => {
  const { id } = await criar('Protegida');
  assert.equal((await visitante.post('/api/categorias', { nome: 'X' })).status, 401);
  assert.equal((await visitante.put(`/api/categorias/${id}`, { nome: 'X' })).status, 401);
  assert.equal((await visitante.put('/api/categorias/ordem', { ids: [id] })).status, 401);
  assert.equal((await visitante.delete(`/api/categorias/${id}`)).status, 401);
  assert.deepEqual(await nomes(), ['Protegida']);
  assert.equal((await loja.delete(`/api/categorias/${id}`)).status, 200);
});

test('criar: valida o nome e recusa repetido (sem diferenciar maiúsculas e acentos)', async () => {
  assert.equal((await loja.post('/api/categorias', { nome: '  ' })).status, 400);
  assert.equal((await loja.post('/api/categorias', { nome: 'x'.repeat(41) })).status, 400);
  assert.equal((await loja.post('/api/categorias', { nome: 42 })).status, 400);

  const r = await loja.post('/api/categorias', { nome: ' Bolos ' });
  assert.equal(r.status, 200);
  assert.equal(r.dados.nome, 'Bolos');
  assert.match(r.dados.id, /^[0-9a-f-]{36}$/);
  assert.equal((await loja.post('/api/categorias', { nome: 'bolos' })).status, 409);
  assert.equal((await loja.post('/api/categorias', { nome: 'BÓLOS' })).status, 409);
  assert.deepEqual(await nomes(), ['Bolos']);
});

test('renomear: mantém o próprio nome, recusa o de outra categoria', async () => {
  const [bolos] = (await loja.get('/api/categorias')).dados;
  const bebidas = await criar('Bebidas');
  assert.equal((await loja.put(`/api/categorias/${bebidas.id}`, { nome: 'Bolos' })).status, 409);
  assert.equal((await loja.put(`/api/categorias/${bebidas.id}`, { nome: '' })).status, 400);
  assert.equal((await loja.put(`/api/categorias/${bolos.id}`, { nome: 'BOLOS' })).dados.nome, 'BOLOS'); // só mudou a caixa
  assert.equal((await loja.put(`/api/categorias/${bebidas.id}`, { nome: 'Sucos' })).status, 200);
  assert.equal((await loja.put('/api/categorias/00000000-0000-4000-8000-000000000000', { nome: 'X' })).status, 404);
  assert.deepEqual(await nomes(), ['BOLOS', 'Sucos']);
});

test('ordem: novas entram no fim; a loja reordena com a lista completa', async () => {
  await criar('Salgados');
  const lista = (await loja.get('/api/categorias')).dados;
  assert.deepEqual(lista.map((c) => c.nome), ['BOLOS', 'Sucos', 'Salgados']);
  const [bolos, sucos, salgados] = lista.map((c) => c.id);

  const r = await loja.put('/api/categorias/ordem', { ids: [salgados, bolos, sucos] });
  assert.equal(r.status, 200);
  assert.deepEqual(r.dados.map((c) => c.nome), ['Salgados', 'BOLOS', 'Sucos']);
  assert.deepEqual(await nomes(), ['Salgados', 'BOLOS', 'Sucos']);

  // Lista incompleta, repetida, com id estranho ou em formato errado: nada muda.
  for (const ids of [[bolos, sucos], [bolos, bolos, sucos], [bolos, sucos, 'outro'], 'texto', undefined]) {
    assert.equal((await loja.put('/api/categorias/ordem', { ids })).status, 409, JSON.stringify(ids));
  }
  assert.deepEqual(await nomes(), ['Salgados', 'BOLOS', 'Sucos']);

  // Categoria criada depois de uma reordenação continua indo para o fim.
  await criar('Promoções');
  assert.deepEqual(await nomes(), ['Salgados', 'BOLOS', 'Sucos', 'Promoções']);
});

test('produto: entra em uma categoria, troca, sai; categoria inexistente é recusada', async () => {
  const [produto] = (await loja.get('/api/produtos')).dados;
  const [salgados, bolos] = (await loja.get('/api/categorias')).dados;

  assert.equal((await visitante.put(`/api/produtos/${produto.id}`, { categoriaId: bolos.id })).status, 401);
  assert.equal((await loja.put(`/api/produtos/${produto.id}`, { categoriaId: bolos.id })).dados.categoriaId, bolos.id);
  assert.equal((await visitante.get(`/api/produtos/${produto.slug}`)).dados.categoriaId, bolos.id);
  // Alterar outro campo não mexe na categoria.
  assert.equal((await loja.put(`/api/produtos/${produto.id}`, { disponivel: true })).dados.categoriaId, bolos.id);
  assert.equal((await loja.put(`/api/produtos/${produto.id}`, { categoriaId: salgados.id })).dados.categoriaId, salgados.id);

  for (const categoriaId of ['00000000-0000-4000-8000-000000000000', 'x', 7, { id: bolos.id }]) {
    assert.equal((await loja.put(`/api/produtos/${produto.id}`, { categoriaId })).status, 400, JSON.stringify(categoriaId));
  }
  assert.equal((await loja.get(`/api/produtos/${produto.slug}`)).dados.categoriaId, salgados.id);

  assert.equal((await loja.put(`/api/produtos/${produto.id}`, { categoriaId: '' })).dados.categoriaId, null);
  assert.equal((await loja.post('/api/produtos', { nome: 'Coxinha', preco: 800, categoriaId: salgados.id })).dados.categoriaId, salgados.id);
});

test('excluir a categoria mantém os produtos, que ficam sem categoria', async () => {
  const salgados = (await loja.get('/api/categorias')).dados.find((c) => c.nome === 'Salgados');
  const antes = (await loja.get('/api/produtos')).dados;
  assert.ok(antes.some((p) => p.categoriaId === salgados.id));

  assert.equal((await loja.delete(`/api/categorias/${salgados.id}`)).status, 200);
  assert.equal((await loja.delete(`/api/categorias/${salgados.id}`)).status, 404);
  const depois = (await loja.get('/api/produtos')).dados;
  assert.equal(depois.length, antes.length);
  assert.ok(depois.every((p) => p.categoriaId !== salgados.id));
  assert.equal(depois.find((p) => p.nome === 'Coxinha').categoriaId, null);
  assert.ok(!(await nomes()).includes('Salgados'));
});

test('nome com HTML é guardado como texto (as páginas escapam ao mostrar)', async () => {
  const r = await loja.post('/api/categorias', { nome: '<img src=x onerror=alert(1)>' });
  assert.equal(r.status, 200);
  assert.equal(r.dados.nome, '<img src=x onerror=alert(1)>');
});

test('limite de 50 categorias', async () => {
  const faltam = 50 - (await loja.get('/api/categorias')).dados.length;
  for (let i = 0; i < faltam; i++) assert.equal((await loja.post('/api/categorias', { nome: `Categoria ${i}` })).status, 200);
  assert.equal((await loja.post('/api/categorias', { nome: 'Uma a mais' })).status, 400);
});
