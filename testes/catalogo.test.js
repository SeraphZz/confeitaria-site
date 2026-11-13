'use strict';
// "Doces" viram "produtos": endereços antigos continuam valendo e cada loja escolhe como chamar o que vende.

const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { subirServidor, dadosCliente, hojeLocal } = require('./apoio');

let servidor, loja, visitante;
before(async () => {
  servidor = await subirServidor();
  loja = servidor.navegador();
  await loja.entrarComoAdmin();
  visitante = servidor.navegador();
});
after(() => servidor.parar());

test('link antigo /doce/... leva para /produto/..., mantendo o que vem depois do "?"', async () => {
  const r = await visitante.get('/doce/brigadeiro-gourmet');
  assert.equal(r.status, 301);
  assert.equal(r.cabecalhos.get('location'), '/produto/brigadeiro-gourmet');
  assert.equal((await visitante.get('/doce/brigadeiro-gourmet?editar')).cabecalhos.get('location'), '/produto/brigadeiro-gourmet?editar');
  assert.equal((await visitante.get('/produto/brigadeiro-gourmet')).status, 200);
  // O destino sai sempre do próprio site: nada do endereço pedido consegue apontar para fora.
  for (const caminho of ['/doce/%2F%2Fevil.example', '/doce/..%2f..%2fadmin', '/doce/https:evil.example', '/doce/']) {
    const ruim = await visitante.get(caminho);
    assert.ok(ruim.status === 404 || /^\/produto\/[a-z0-9-]+$/.test(ruim.cabecalhos.get('location')), caminho);
  }
});

test('a API antiga /api/doces deixou de existir', async () => {
  assert.equal((await visitante.get('/api/doces')).status, 404);
});

test('pedido aceita o campo antigo "doceId" (carrinho guardado antes da atualização)', async () => {
  const cliente = servidor.navegador();
  const dados = dadosCliente();
  await cliente.post('/api/cadastro', dados);
  const [produto] = (await visitante.get('/api/produtos')).dados;
  const r = await cliente.post('/api/pedidos', {
    cliente: { nome: dados.nome, telefone: dados.telefone }, entrega: { tipo: 'retirada', data: hojeLocal(1) },
    itens: [{ doceId: produto.id, quantidade: 2 }],
  });
  assert.equal(r.status, 200);
  assert.equal(r.dados.total, produto.preco * 2);
  const [pedido] = (await loja.get('/api/pedidos')).dados.itens;
  assert.equal(pedido.itens[0].produtoId, produto.id);
  assert.equal('doceId' in pedido.itens[0], false);
});

test('vocabulário: a loja de exemplo fala "doces"; o visitante recebe os nomes', async () => {
  const { catalogo } = (await visitante.get('/api/site')).dados;
  assert.deepEqual(catalogo, { nomeSingular: 'Doce', nomePlural: 'Doces', emojiPadrao: '🧁' });
});

test('vocabulário: a loja troca os nomes e o ícone padrão dos produtos novos', async () => {
  assert.equal((await visitante.put('/api/configuracoes/catalogo', { nomeSingular: 'X', nomePlural: 'Y' })).status, 401);
  assert.equal((await loja.put('/api/configuracoes/catalogo', { nomeSingular: '', nomePlural: 'Pratos' })).status, 400);
  assert.equal((await loja.put('/api/configuracoes/catalogo', { nomeSingular: 'Prato', nomePlural: 'x'.repeat(31) })).status, 400);

  const r = await loja.put('/api/configuracoes/catalogo', { nomeSingular: ' Prato ', nomePlural: 'Pratos', emojiPadrao: '🍽️' });
  assert.equal(r.status, 200);
  assert.deepEqual(r.dados, { nomeSingular: 'Prato', nomePlural: 'Pratos', emojiPadrao: '🍽️' });
  assert.deepEqual((await visitante.get('/api/site')).dados.catalogo, r.dados);

  const novo = (await loja.post('/api/produtos', { nome: 'Feijoada', preco: 3900 })).dados;
  assert.equal(novo.emoji, '🍽️');
  assert.equal(novo.slug, 'feijoada');
  // Apagar o emoji de um produto volta para o ícone padrão da loja; os produtos antigos não são alterados.
  assert.equal((await loja.put(`/api/produtos/${novo.id}`, { emoji: '' })).dados.emoji, '🍽️');
  assert.equal((await loja.get('/api/produtos/brigadeiro-gourmet')).dados.emoji, '🍫');

  // Ícone vazio cai no padrão do sistema.
  assert.equal((await loja.put('/api/configuracoes/catalogo', { nomeSingular: 'Item', nomePlural: 'Itens', emojiPadrao: '' })).dados.emojiPadrao, '🛍️');
});

test('nomes com HTML são guardados como texto (as páginas escapam ao mostrar)', async () => {
  const r = await loja.put('/api/configuracoes/catalogo', { nomeSingular: '<b>Doce</b>', nomePlural: '<script>x</script>' });
  assert.equal(r.status, 200);
  assert.equal(r.dados.nomePlural, '<script>x</script>');
});

test('produto sem nome utilizável ganha o slug "produto"', async () => {
  assert.equal((await loja.post('/api/produtos', { nome: '🎂🎂', preco: 100 })).dados.slug, 'produto');
  assert.equal((await loja.post('/api/produtos', { nome: '!!!', preco: 100 })).dados.slug, 'produto-2');
});
