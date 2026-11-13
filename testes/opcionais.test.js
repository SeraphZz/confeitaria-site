'use strict';
// Recursos opcionais do catálogo: variações, adicionais e estoque. Cada um só vale depois que a loja liga.

const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { subirServidor, dadosCliente, hojeLocal } = require('./apoio');

let servidor, loja, visitante, cliente, dados, produtos;

before(async () => {
  servidor = await subirServidor();
  loja = servidor.navegador();
  await loja.entrarComoAdmin();
  visitante = servidor.navegador();
  cliente = servidor.navegador();
  dados = dadosCliente();
  await cliente.post('/api/cadastro', dados);
  produtos = (await loja.get('/api/produtos')).dados; // a loja de exemplo tem 6: cada teste usa os seus
});
after(() => servidor.parar());

const ligar = (modulos) => loja.put('/api/configuracoes/modulos', modulos);
const editar = (produto, corpo) => loja.put(`/api/produtos/${produto.id}`, corpo);
const ver = async (produto, quem = visitante) => (await quem.get(`/api/produtos/${produto.slug}`)).dados;
const pedir = (itens) => cliente.post('/api/pedidos', { cliente: { nome: dados.nome, telefone: dados.telefone }, entrega: { tipo: 'retirada', data: hojeLocal(1) }, itens });
const ultimoPedido = async () => (await loja.get('/api/pedidos')).dados.itens[0];
const quantosPedidos = async () => (await loja.get('/api/pedidos')).dados.total;
const mudarStatus = (pedido, status) => loja.patch(`/api/pedidos/${pedido.id}`, { status });

test('instalação nova: tudo desligado e os produtos sem variações, adicionais ou estoque', async () => {
  assert.deepEqual((await visitante.get('/api/site')).dados.modulos, { variacoes: false, adicionais: false, estoque: false });
  for (const p of (await visitante.get('/api/produtos')).dados) {
    assert.deepEqual([p.variacoes, p.adicionais, p.estoque, p.esgotado], [[], [], null, false]);
  }
});

test('recurso desligado: a loja não consegue cadastrar', async () => {
  const [p] = produtos;
  assert.equal((await editar(p, { variacoes: [{ nome: 'Grande', preco: 100 }] })).status, 400);
  assert.equal((await editar(p, { adicionais: [{ nome: 'Calda', preco: 100 }] })).status, 400);
  assert.equal((await editar(p, { estoque: 5 })).status, 400);
  assert.deepEqual((await ver(p, loja)).variacoes, []);
});

test('só a loja liga e desliga os recursos; qualquer valor que não seja "true" conta como desligado', async () => {
  assert.equal((await visitante.put('/api/configuracoes/modulos', { variacoes: true })).status, 401);
  assert.equal((await cliente.put('/api/configuracoes/modulos', { variacoes: true })).status, 401);
  assert.deepEqual((await ligar({ variacoes: 'sim', adicionais: 1, estoque: {} })).dados, { variacoes: false, adicionais: false, estoque: false });
  assert.deepEqual((await ligar({ variacoes: true, adicionais: true })).dados, { variacoes: true, adicionais: true, estoque: false });
  assert.deepEqual((await visitante.get('/api/site')).dados.modulos, { variacoes: true, adicionais: true, estoque: false });
});

test('variações: cadastro, validação e edição mantendo o id de quem já existia', async () => {
  const [p] = produtos;
  assert.equal((await visitante.put(`/api/produtos/${p.id}`, { variacoes: [] })).status, 401);
  for (const variacoes of [
    'texto', [null], [{ nome: '', preco: 100 }], [{ nome: 'P' }], [{ nome: 'P', preco: -1 }], [{ nome: 'P', preco: 1.5 }], [{ nome: 'P', preco: '100' }],
    [{ nome: 'x'.repeat(61), preco: 100 }], [{ nome: 'Grande', preco: 100 }, { nome: 'grande', preco: 200 }],
    Array.from({ length: 21 }, (_, i) => ({ nome: `Opção ${i}`, preco: 100 })),
  ]) {
    assert.equal((await editar(p, { variacoes })).status, 400, JSON.stringify(variacoes).slice(0, 80));
  }

  const r = await editar(p, { variacoes: [{ nome: ' Pequeno ', preco: 1000 }, { nome: 'Grande', preco: 2500, id: 'id-inventado' }] });
  assert.equal(r.status, 200);
  assert.deepEqual(r.dados.variacoes.map((v) => [v.nome, v.preco, v.estoque]), [['Pequeno', 1000, null], ['Grande', 2500, null]]);
  const [pequeno, grande] = r.dados.variacoes;
  assert.match(grande.id, /^[0-9a-f-]{36}$/); // id enviado pelo navegador só vale se for de uma variação deste produto
  assert.deepEqual((await ver(p)).variacoes, r.dados.variacoes);

  // Troca a ordem, altera o preço de uma, remove a outra e cria uma nova.
  const r2 = await editar(p, { variacoes: [{ nome: 'Médio', preco: 1800 }, { id: pequeno.id, nome: 'Pequeno', preco: 1200 }] });
  assert.deepEqual(r2.dados.variacoes.map((v) => [v.nome, v.preco]), [['Médio', 1800], ['Pequeno', 1200]]);
  assert.equal(r2.dados.variacoes[1].id, pequeno.id);
  assert.ok(!r2.dados.variacoes.some((v) => v.id === grande.id));

  // O id de uma variação não serve em outro produto, nem duas vezes no mesmo.
  const outro = await editar(produtos[1], { variacoes: [{ id: pequeno.id, nome: 'A', preco: 1 }, { id: pequeno.id, nome: 'B', preco: 2 }] });
  assert.ok(outro.dados.variacoes.every((v) => v.id !== pequeno.id));
  assert.notEqual(outro.dados.variacoes[0].id, outro.dados.variacoes[1].id);
  assert.equal((await ver(p)).variacoes[1].id, pequeno.id);
  await editar(produtos[1], { variacoes: [] });

  // Alterar outro campo não mexe nas variações.
  assert.equal((await editar(p, { descricao: 'Nova descrição' })).dados.variacoes.length, 2);
});

test('pedido de produto com variações: exige a escolha e cobra o preço dela', async () => {
  const p = await ver(produtos[0]);
  const [medio, pequeno] = p.variacoes;

  assert.equal((await pedir([{ produtoId: p.id, quantidade: 1 }])).status, 400);
  assert.equal((await pedir([{ produtoId: p.id, quantidade: 1, variacaoId: 'nao-existe' }])).status, 409);
  assert.equal((await pedir([{ produtoId: p.id, quantidade: 1, variacaoId: { id: medio.id } }])).status, 409);
  // Produto sem variações não aceita uma escolha que não existe (o cliente teria visto outro preço).
  assert.equal((await pedir([{ produtoId: produtos[1].id, quantidade: 1, variacaoId: medio.id }])).status, 409);
  assert.equal(await quantosPedidos(), 0);

  const r = await pedir([
    { produtoId: p.id, quantidade: 2, variacaoId: medio.id, precoUnit: 1, variacao: 'Forjada' },
    { produtoId: p.id, quantidade: 1, variacaoId: pequeno.id },
    { produtoId: produtos[1].id, quantidade: 1 },
  ]);
  assert.equal(r.status, 200);
  assert.equal(r.dados.total, 1800 * 2 + 1200 + produtos[1].preco);
  const pedido = await ultimoPedido();
  assert.deepEqual(pedido.itens.map((i) => [i.nome, i.variacao, i.variacaoId, i.precoUnit, i.quantidade, i.adicionais]), [
    [p.nome, 'Médio', medio.id, 1800, 2, []],
    [p.nome, 'Pequeno', pequeno.id, 1200, 1, []],
    [produtos[1].nome, '', null, produtos[1].preco, 1, []],
  ]);
});

test('adicionais: cadastro e pedido somando o preço de cada um, uma vez só', async () => {
  const p = produtos[2];
  assert.equal((await editar(p, { adicionais: Array.from({ length: 31 }, (_, i) => ({ nome: `Extra ${i}`, preco: 100 })) })).status, 400);
  assert.equal((await editar(p, { adicionais: [{ nome: 'Calda', preco: 100 }, { nome: 'CALDA', preco: 100 }] })).status, 400);
  const r = await editar(p, { adicionais: [{ nome: 'Calda', preco: 300 }, { nome: 'Granulado', preco: 150 }, { nome: 'Vela', preco: 0 }] });
  assert.equal(r.status, 200);
  const [calda, granulado, vela] = r.dados.adicionais;
  assert.deepEqual(Object.keys(calda).sort(), ['id', 'nome', 'preco']); // adicional não tem estoque
  assert.deepEqual((await ver(p)).adicionais, r.dados.adicionais);

  assert.equal((await pedir([{ produtoId: p.id, quantidade: 1, adicionaisIds: 'texto' }])).status, 400);
  assert.equal((await pedir([{ produtoId: p.id, quantidade: 1, adicionaisIds: [calda.id, 'nao-existe'] }])).status, 409);
  // Adicional de outro produto não vale.
  assert.equal((await pedir([{ produtoId: produtos[3].id, quantidade: 1, adicionaisIds: [calda.id] }])).status, 409);

  const antes = await quantosPedidos();
  const pedido = await pedir([
    { produtoId: p.id, quantidade: 3, adicionaisIds: [vela.id, calda.id, calda.id], adicionais: [{ nome: 'Forjado', preco: -5000 }] },
    { produtoId: p.id, quantidade: 1, adicionaisIds: [] },
    { produtoId: p.id, quantidade: 1 },
  ]);
  assert.equal(pedido.status, 200);
  assert.equal(pedido.dados.total, (p.preco + 300) * 3 + p.preco * 2);
  assert.equal(await quantosPedidos(), antes + 1);
  const [comExtras, semExtras] = (await ultimoPedido()).itens;
  assert.deepEqual(comExtras.adicionais, [{ nome: 'Calda', preco: 300 }, { nome: 'Vela', preco: 0 }]); // na ordem do cadastro
  assert.equal(comExtras.precoUnit, p.preco + 300);
  assert.deepEqual(semExtras.adicionais, []);
  assert.ok(granulado.id);
});

test('variação e adicionais juntos; o cliente e a loja veem o que foi escolhido', async () => {
  const p = produtos[0];
  const { adicionais: [recheio] } = (await editar(p, { adicionais: [{ nome: 'Recheio extra', preco: 500 }] })).dados;
  const [medio] = (await ver(p)).variacoes;
  const r = await pedir([{ produtoId: p.id, quantidade: 2, variacaoId: medio.id, adicionaisIds: [recheio.id] }]);
  assert.equal(r.dados.total, (1800 + 500) * 2);

  const [meu] = (await cliente.get('/api/conta/pedidos')).dados.itens;
  assert.deepEqual([meu.itens[0].variacao, meu.itens[0].adicionais], ['Médio', [{ nome: 'Recheio extra', preco: 500 }]]);
  const pessoa = (await loja.get('/api/clientes')).dados.itens.find((c) => c.nome === dados.nome);
  assert.equal(pessoa.pedidos[0].itens, `2× ${p.nome} (Médio) + Recheio extra`);

  // Mudar ou apagar a variação depois não altera o pedido já feito.
  await editar(p, { variacoes: [{ nome: 'Único', preco: 9900 }], adicionais: [] });
  const [mesmo] = (await cliente.get('/api/conta/pedidos')).dados.itens;
  assert.deepEqual([mesmo.itens[0].variacao, mesmo.itens[0].precoUnit, mesmo.total], ['Médio', 2300, 4600]);
});

test('desligar um recurso esconde o que foi cadastrado, sem apagar; religar traz de volta', async () => {
  const p = produtos[0];
  const antes = await ver(p);
  assert.equal(antes.variacoes.length, 1);

  await ligar({ variacoes: false, adicionais: false });
  const escondido = await ver(p, loja);
  assert.deepEqual([escondido.variacoes, escondido.preco], [[], p.preco]);
  assert.deepEqual((await ver(produtos[2])).adicionais, []);
  // Pedido volta a valer pelo preço do produto; carrinho antigo com a variação é recusado, não cobrado errado.
  assert.equal((await pedir([{ produtoId: p.id, quantidade: 1 }])).dados.total, p.preco);
  assert.equal((await pedir([{ produtoId: p.id, quantidade: 1, variacaoId: antes.variacoes[0].id }])).status, 409);
  // Editar o produto com o recurso desligado não apaga as variações guardadas.
  assert.equal((await editar(p, { descricao: 'Mudou com o recurso desligado' })).status, 200);

  await ligar({ variacoes: true, adicionais: true });
  assert.deepEqual((await ver(p)).variacoes, antes.variacoes);
  assert.equal((await ver(produtos[2])).adicionais.length, 3);
});

test('estoque: validação, baixa no pedido, falta e esgotado', async () => {
  await ligar({ variacoes: true, adicionais: true, estoque: true });
  const p = produtos[3];
  for (const estoque of [-1, 1.5, '3', 1_000_000, [], {}]) assert.equal((await editar(p, { estoque })).status, 400, JSON.stringify(estoque));
  assert.equal((await visitante.put(`/api/produtos/${p.id}`, { estoque: 3 })).status, 401);
  assert.equal((await editar(p, { estoque: 3 })).dados.estoque, 3);
  assert.deepEqual([(await ver(p)).estoque, (await ver(p)).esgotado], [3, false]);

  assert.equal((await pedir([{ produtoId: p.id, quantidade: 2 }])).status, 200);
  assert.equal((await ver(p)).estoque, 1);
  assert.equal((await ultimoPedido()).itens[0].estoqueSituacao, 1);

  const antes = await quantosPedidos();
  const falta = await pedir([{ produtoId: p.id, quantidade: 2 }]);
  assert.equal(falta.status, 409);
  assert.match(falta.dados.erro, /Só restam 1 de/);
  assert.equal((await ver(p)).estoque, 1);
  assert.equal(await quantosPedidos(), antes);

  // Dois itens do mesmo produto no mesmo pedido contam juntos.
  assert.equal((await pedir([{ produtoId: p.id, quantidade: 1 }, { produtoId: p.id, quantidade: 1, observacoes: 'outro' }])).status, 409);
  assert.equal((await ver(p)).estoque, 1);

  assert.equal((await pedir([{ produtoId: p.id, quantidade: 1 }])).status, 200);
  assert.deepEqual([(await ver(p)).estoque, (await ver(p)).esgotado], [0, true]);
  const esgotou = await pedir([{ produtoId: p.id, quantidade: 1 }]);
  assert.equal(esgotou.status, 409);
  assert.match(esgotou.dados.erro, /esgotou/);

  // Vazio volta a "sem controle": vende à vontade.
  assert.equal((await editar(p, { estoque: null })).dados.estoque, null);
  assert.equal((await pedir([{ produtoId: p.id, quantidade: 50 }])).status, 200);
  assert.equal((await ultimoPedido()).itens[0].estoqueSituacao, 0);
  assert.equal((await editar(p, { estoque: '' })).dados.estoque, null);
});

test('estoque: se falta um item, o pedido inteiro não acontece e nada é baixado', async () => {
  const [a, b] = [produtos[3], produtos[4]];
  await editar(a, { estoque: 10 });
  await editar(b, { estoque: 2 });
  const antes = await quantosPedidos();
  const r = await pedir([{ produtoId: a.id, quantidade: 4 }, { produtoId: b.id, quantidade: 3 }]);
  assert.equal(r.status, 409);
  assert.deepEqual([(await ver(a)).estoque, (await ver(b)).estoque], [10, 2]);
  assert.equal(await quantosPedidos(), antes);
});

test('estoque: cancelar devolve; reabrir tira de novo, e é recusado se não houver mais', async () => {
  const p = produtos[4]; // estoque 2
  assert.equal((await pedir([{ produtoId: p.id, quantidade: 2 }])).status, 200);
  const pedido = await ultimoPedido();
  assert.equal((await ver(p)).estoque, 0);

  // Mudanças entre status que não são "cancelado" não mexem no estoque.
  await mudarStatus(pedido, 'confirmado');
  assert.equal((await ver(p)).estoque, 0);

  const cancelado = await mudarStatus(pedido, 'cancelado');
  assert.deepEqual([cancelado.status, cancelado.dados.status, cancelado.dados.itens[0].estoqueSituacao], [200, 'cancelado', 2]);
  assert.equal((await ver(p)).estoque, 2);
  assert.equal((await mudarStatus(pedido, 'cancelado')).status, 409); // já está cancelado: nada é devolvido em dobro
  assert.equal((await ver(p)).estoque, 2);

  const reaberto = await mudarStatus(pedido, 'novo');
  assert.deepEqual([reaberto.dados.status, reaberto.dados.itens[0].estoqueSituacao], ['novo', 1]);
  assert.equal((await ver(p)).estoque, 0);

  // Cancelado de novo, outra pessoa leva uma unidade: não dá mais para reabrir, e nada muda.
  await mudarStatus(pedido, 'cancelado');
  assert.equal((await pedir([{ produtoId: p.id, quantidade: 1 }])).status, 200);
  const recusado = await mudarStatus(pedido, 'novo'); // de "Cancelado" só se volta para "Novo"
  assert.equal(recusado.status, 409);
  assert.match(recusado.dados.erro, /só restam 1/);
  assert.equal((await ver(p)).estoque, 1);
  assert.equal((await loja.get('/api/pedidos')).dados.itens.find((x) => x.id === pedido.id).status, 'cancelado');

  // A loja repõe o estoque e então consegue reabrir.
  await editar(p, { estoque: 5 });
  assert.equal((await mudarStatus(pedido, 'novo')).status, 200);
  assert.equal((await ver(p)).estoque, 3);
});

test('estoque: pedido feito sem controle de estoque não devolve nada ao ser cancelado', async () => {
  const p = produtos[5];
  assert.equal((await pedir([{ produtoId: p.id, quantidade: 4 }])).status, 200);
  const pedido = await ultimoPedido();
  await editar(p, { estoque: 7 }); // a loja passa a controlar depois do pedido
  await mudarStatus(pedido, 'cancelado');
  assert.equal((await ver(p)).estoque, 7);
  await mudarStatus(pedido, 'novo');
  assert.equal((await ver(p)).estoque, 7);
});

test('estoque por variação: cada opção tem o seu; o produto só esgota quando todas esgotam', async () => {
  const p = produtos[5];
  const r = await editar(p, { variacoes: [{ nome: 'P', preco: 1000, estoque: 1 }, { nome: 'G', preco: 2000 }, { nome: 'GG', preco: 3000, estoque: 0 }] });
  assert.deepEqual(r.dados.variacoes.map((v) => v.estoque), [1, null, 0]);
  assert.deepEqual([r.dados.estoque, r.dados.esgotado], [null, false]); // com variações, o estoque do produto não vale
  const [pq, g, gg] = r.dados.variacoes;

  assert.equal((await pedir([{ produtoId: p.id, quantidade: 1, variacaoId: gg.id }])).status, 409);
  assert.equal((await pedir([{ produtoId: p.id, quantidade: 2, variacaoId: pq.id }])).status, 409);
  assert.equal((await pedir([{ produtoId: p.id, quantidade: 1, variacaoId: pq.id }, { produtoId: p.id, quantidade: 30, variacaoId: g.id }])).status, 200);
  const pedido = await ultimoPedido();
  assert.deepEqual(pedido.itens.map((i) => i.estoqueSituacao), [1, 0]);
  const depois = await ver(p);
  assert.deepEqual(depois.variacoes.map((v) => v.estoque), [0, null, 0]);
  assert.equal(depois.esgotado, false); // "G" não tem limite

  const falta = await pedir([{ produtoId: p.id, quantidade: 1, variacaoId: pq.id }]);
  assert.match(falta.dados.erro, /\(P\)" esgotou/);

  await mudarStatus(pedido, 'cancelado');
  assert.deepEqual((await ver(p)).variacoes.map((v) => v.estoque), [1, null, 0]);

  assert.equal((await editar(p, { variacoes: [{ id: pq.id, nome: 'P', preco: 1000, estoque: 0 }, { id: gg.id, nome: 'GG', preco: 3000, estoque: 0 }] })).dados.esgotado, true);
  for (const estoque of [-1, 2.5, 'muito']) {
    assert.equal((await editar(p, { variacoes: [{ nome: 'P', preco: 1000, estoque }] })).status, 400, String(estoque));
  }
});

test('estoque desligado: os números ficam guardados, não valem nos pedidos e não aparecem', async () => {
  const p = produtos[5]; // variações P e GG, as duas com estoque 0
  const [pq, gg] = (await ver(p)).variacoes;
  await ligar({ variacoes: true, adicionais: true, estoque: false });

  const visto = await ver(p, loja);
  assert.deepEqual([visto.variacoes.map((v) => v.estoque), visto.esgotado], [[null, null], false]);
  assert.equal((await ver(produtos[4])).estoque, null);
  assert.equal((await pedir([{ produtoId: p.id, quantidade: 3, variacaoId: pq.id }])).status, 200);
  assert.equal((await ultimoPedido()).itens[0].estoqueSituacao, 0);

  // A tela de edição, sem o campo de estoque, salva as variações: o estoque guardado de cada uma continua lá.
  await editar(p, { variacoes: [{ id: pq.id, nome: 'Pequeno', preco: 1100 }, { id: gg.id, nome: 'GG', preco: 3000, estoque: 99 }, { nome: 'Nova', preco: 500, estoque: 99 }] });
  await ligar({ variacoes: true, adicionais: true, estoque: true });
  assert.deepEqual((await ver(p)).variacoes.map((v) => [v.nome, v.estoque]), [['Pequeno', 0], ['GG', 0], ['Nova', null]]);
});

test('excluir o produto leva junto as variações e os adicionais; os pedidos antigos ficam', async () => {
  const p = produtos[0];
  const quantos = await quantosPedidos();
  assert.equal((await loja.delete(`/api/produtos/${p.id}`)).status, 200);
  assert.equal((await visitante.get(`/api/produtos/${p.slug}`)).status, 404);
  assert.equal(await quantosPedidos(), quantos);
  // Cancelar um pedido de produto que não existe mais não quebra.
  const antigo = (await loja.get('/api/pedidos')).dados.itens.find((x) => x.itens.some((i) => i.produtoId === p.id));
  assert.equal((await mudarStatus(antigo, 'cancelado')).status, 200);
});
