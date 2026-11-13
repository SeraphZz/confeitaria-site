'use strict';
// Fluxo de pedidos: criação pelo cliente, painel da loja, mudança de status, clientes e resumo.

const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { subirServidor, dadosCliente, hojeLocal } = require('./apoio');

let servidor, loja, cliente, dados, produtos;

const ENDERECO = { cep: '01001-000', rua: 'Praça da Sé', numero: '10', complemento: 'apto 2', bairro: 'Sé', cidade: 'São Paulo', uf: 'SP' };
function corpoPedido(extra = {}) {
  return {
    cliente: { nome: dados.nome, telefone: dados.telefone },
    entrega: { tipo: 'retirada', data: hojeLocal(1) },
    itens: [{ produtoId: produtos[0].id, quantidade: 2, observacoes: 'sem granulado' }, { produtoId: produtos[1].id, quantidade: 1 }],
    observacoes: 'Tocar a campainha', ...extra,
  };
}

before(async () => {
  servidor = await subirServidor();
  loja = servidor.navegador();
  await loja.entrarComoAdmin();
  cliente = servidor.navegador();
  dados = dadosCliente();
  await cliente.post('/api/cadastro', dados);
  produtos = (await loja.get('/api/produtos')).dados;
});
after(() => servidor.parar());

test('visitante e loja não criam pedido: só cliente logado', async () => {
  assert.equal((await servidor.navegador().post('/api/pedidos', corpoPedido())).status, 401);
  assert.equal((await loja.post('/api/pedidos', corpoPedido())).status, 401);
});

test('pedido válido recebe número e total calculado pelo servidor', async () => {
  // Preço e nome enviados pelo navegador são ignorados.
  const corpo = corpoPedido();
  corpo.itens[0].precoUnit = 1;
  corpo.itens[0].nome = 'Nome forjado';
  corpo.total = 1;
  const r = await cliente.post('/api/pedidos', corpo);
  assert.equal(r.status, 200);
  assert.equal(r.dados.numero, 1);
  assert.equal(r.dados.total, produtos[0].preco * 2 + produtos[1].preco);

  const [pedido] = (await loja.get('/api/pedidos')).dados.itens;
  assert.equal(pedido.numero, 1);
  assert.equal(pedido.status, 'novo');
  assert.equal(pedido.cliente.nome, dados.nome);
  assert.equal(pedido.cliente.telefone, '11987654321');
  assert.deepEqual(pedido.entrega, { tipo: 'retirada', data: hojeLocal(1), endereco: '' });
  assert.equal(pedido.observacoes, 'Tocar a campainha');
  assert.deepEqual(pedido.itens.map((i) => [i.nome, i.precoUnit, i.quantidade, i.observacoes]), [
    [produtos[0].nome, produtos[0].preco, 2, 'sem granulado'],
    [produtos[1].nome, produtos[1].preco, 1, ''],
  ]);
  assert.ok(!Number.isNaN(Date.parse(pedido.criadoEm)));
});

test('pedido com entrega exige endereço, grava-o formatado e guarda no cadastro', async () => {
  assert.equal((await cliente.post('/api/pedidos', corpoPedido({ entrega: { tipo: 'entrega', data: hojeLocal(2) } }))).status, 400);
  const r = await cliente.post('/api/pedidos', corpoPedido({ entrega: { tipo: 'entrega', data: hojeLocal(2), endereco: ENDERECO } }));
  assert.equal(r.status, 200);
  assert.equal(r.dados.numero, 2);
  const pedido = (await loja.get('/api/pedidos')).dados.itens.find((p) => p.numero === 2);
  assert.equal(pedido.entrega.endereco, 'Praça da Sé, 10 - apto 2 - Sé, São Paulo/SP - CEP 01001-000');
  assert.equal((await cliente.get('/api/site')).dados.cliente.endereco.cep, '01001000');
});

test('pedidos inválidos são recusados', async () => {
  const casos = [
    [corpoPedido({ itens: [] }), 400],
    [corpoPedido({ itens: [{ produtoId: produtos[0].id, quantidade: 0 }] }), 400],
    [corpoPedido({ itens: [{ produtoId: produtos[0].id, quantidade: 1.5 }] }), 400],
    [corpoPedido({ itens: [{ produtoId: produtos[0].id, quantidade: 1000 }] }), 400],
    [corpoPedido({ itens: [{ produtoId: '00000000-0000-0000-0000-000000000000', quantidade: 1 }] }), 409],
    [corpoPedido({ entrega: { tipo: 'retirada', data: hojeLocal(-1) } }), 400],
    [corpoPedido({ entrega: { tipo: 'retirada', data: 'amanhã' } }), 400],
    [corpoPedido({ cliente: { nome: '', telefone: dados.telefone } }), 400],
    [corpoPedido({ cliente: { nome: dados.nome, telefone: '12' } }), 400],
    [corpoPedido({ observacoes: 'x'.repeat(501) }), 400],
  ];
  for (const [corpo, esperado] of casos) {
    assert.equal((await cliente.post('/api/pedidos', corpo)).status, esperado, JSON.stringify(corpo).slice(0, 160));
  }
  assert.equal((await loja.get('/api/pedidos')).dados.itens.length, 2, 'nenhum pedido inválido deveria ter sido gravado');
});

test('produto indisponível não pode ser pedido', async () => {
  const alvo = produtos[2];
  await loja.put(`/api/produtos/${alvo.id}`, { disponivel: false });
  assert.equal((await cliente.post('/api/pedidos', corpoPedido({ itens: [{ produtoId: alvo.id, quantidade: 1 }] }))).status, 409);
  await loja.put(`/api/produtos/${alvo.id}`, { disponivel: true });
});

test('cliente vê só os próprios pedidos, sem dados internos', async () => {
  const outro = servidor.navegador();
  await outro.post('/api/cadastro', dadosCliente());
  assert.deepEqual((await outro.get('/api/conta/pedidos')).dados.itens, []);

  const meus = (await cliente.get('/api/conta/pedidos')).dados.itens;
  assert.deepEqual(meus.map((p) => p.numero), [2, 1]);
  assert.deepEqual(Object.keys(meus[0]).sort(), ['criadoEm', 'entrega', 'historico', 'itens', 'numero', 'status', 'total']);
});

test('painel: a loja lista os pedidos do mais novo para o mais antigo', async () => {
  const lista = (await loja.get('/api/pedidos')).dados.itens;
  assert.deepEqual(lista.map((p) => p.numero), [2, 1]);
});

test('mudança de status: só a loja, só status conhecidos', async () => {
  const [pedido] = (await loja.get('/api/pedidos')).dados.itens.filter((p) => p.numero === 1);
  assert.equal((await cliente.patch(`/api/pedidos/${pedido.id}`, { status: 'confirmado' })).status, 401);
  assert.equal((await servidor.navegador().patch(`/api/pedidos/${pedido.id}`, { status: 'confirmado' })).status, 401);
  assert.equal((await loja.patch(`/api/pedidos/${pedido.id}`, { status: 'inventado' })).status, 400);
  assert.equal((await loja.patch('/api/pedidos/00000000-0000-0000-0000-000000000000', { status: 'confirmado' })).status, 404);

  for (const status of ['confirmado', 'producao', 'pronto', 'entregue']) {
    const r = await loja.patch(`/api/pedidos/${pedido.id}`, { status });
    assert.equal(r.status, 200, status);
    assert.equal(r.dados.status, status);
    assert.equal(r.dados.numero, 1);
  }
  assert.equal((await cliente.get('/api/conta/pedidos')).dados.itens.find((p) => p.numero === 1).status, 'entregue');
});

test('pedido guarda nome e preço da época, mesmo que o produto mude ou seja apagado', async () => {
  const novo = (await loja.post('/api/produtos', { nome: 'Doce Passageiro', preco: 700 })).dados;
  const r = await cliente.post('/api/pedidos', corpoPedido({ itens: [{ produtoId: novo.id, quantidade: 3 }] }));
  assert.equal(r.dados.total, 2100);
  await loja.put(`/api/produtos/${novo.id}`, { preco: 9900, nome: 'Outro Nome' });
  await loja.delete(`/api/produtos/${novo.id}`);
  const pedido = (await loja.get('/api/pedidos')).dados.itens.find((p) => p.numero === r.dados.numero);
  assert.equal(pedido.total, 2100);
  assert.deepEqual([pedido.itens[0].nome, pedido.itens[0].precoUnit], ['Doce Passageiro', 700]);
});

test('aba Clientes agrupa pedidos por pessoa e ignora cancelados no total', async () => {
  const lista = (await loja.get('/api/pedidos')).dados.itens;
  const antes = (await loja.get('/api/clientes')).dados.itens.find((p) => p.email === dados.email);
  assert.equal(antes.cadastrado, true);
  assert.equal(antes.quantidade, 3);
  assert.equal(antes.total, lista.reduce((s, p) => s + p.total, 0));
  assert.equal(antes.pedidos.length, 3);
  assert.doesNotMatch(JSON.stringify(antes), /hash|salt/);

  const cancelar = lista.find((p) => p.numero === 2);
  await loja.patch(`/api/pedidos/${cancelar.id}`, { status: 'cancelado' });
  const depois = (await loja.get('/api/clientes')).dados.itens.find((p) => p.email === dados.email);
  assert.equal(depois.quantidade, 2);
  assert.equal(depois.total, antes.total - cancelar.total);
  assert.equal(depois.pedidos.length, 3);
});

test('resumo: receita, pedidos e status do período', async () => {
  const lista = (await loja.get('/api/pedidos')).dados.itens;
  const validos = lista.filter((p) => p.status !== 'cancelado');
  const r = (await loja.get('/api/dashboard?dias=7')).dados;
  assert.equal(r.dias, 7);
  assert.equal(r.serie.length, 7);
  assert.equal(r.kpis.pedidos, validos.length);
  assert.equal(r.kpis.receita, validos.reduce((s, p) => s + p.total, 0));
  assert.equal(r.kpis.ticketMedio, Math.round(r.kpis.receita / r.kpis.pedidos));
  assert.equal(r.kpis.emAberto, lista.filter((p) => ['novo', 'confirmado', 'producao', 'pronto'].includes(p.status)).length);
  assert.equal(r.status.cancelado, 1);
  assert.equal(r.status.entregue, 1);
  assert.equal(r.serie.at(-1).data, hojeLocal());
  assert.equal(r.serie.at(-1).receita, r.kpis.receita);
  assert.ok(r.topProdutos.length >= 1 && r.topProdutos.length <= 6);
  // Período fora da lista permitida cai no padrão de 30 dias.
  assert.equal((await loja.get('/api/dashboard?dias=999')).dados.dias, 30);
});
