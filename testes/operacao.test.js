'use strict';
// Operação dos pedidos: status da loja, transições permitidas, histórico (só de inserção) e busca com filtros.

const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { DatabaseSync } = require('node:sqlite');
const { subirServidor, dadosCliente, hojeLocal } = require('./apoio');

let servidor, dona, ana, joao, visitante, produtos;

const pedir = async (cliente, dados, extra = {}) => (await cliente.post('/api/pedidos', {
  cliente: { nome: dados.nome, telefone: dados.telefone },
  entrega: { tipo: 'retirada', data: hojeLocal(1) },
  itens: [{ produtoId: produtos[0].id, quantidade: 1 }], ...extra,
})).dados.numero;
const lista = async (consulta = '') => (await dona.get(`/api/pedidos${consulta}`)).dados;
const pedido = async (numero) => (await lista()).itens.find((p) => p.numero === numero);
const mudar = async (numero, status, observacao) => dona.patch(`/api/pedidos/${(await pedido(numero)).id}`, { status, observacao });
const status = async () => (await dona.get('/api/status-pedidos')).dados;
const gravar = (statusNovos, quem = dona) => quem.put('/api/status-pedidos', { status: statusNovos });
const numeros = (r) => r.itens.map((p) => p.numero);

let dadosAna, dadosJoao;
before(async () => {
  servidor = await subirServidor();
  dona = servidor.navegador();
  await dona.entrarComoAdmin();
  visitante = servidor.navegador();
  ana = servidor.navegador();
  dadosAna = dadosCliente({ nome: 'Ana Conceição', telefone: '(11) 91234-5678' });
  await ana.post('/api/cadastro', dadosAna);
  joao = servidor.navegador();
  dadosJoao = dadosCliente({ nome: 'João Guimarães', telefone: '(21) 99876-5432' });
  await joao.post('/api/cadastro', dadosJoao);
  produtos = (await dona.get('/api/produtos')).dados;
});
after(() => servidor.parar());

test('instalação nova: os seis status de sempre, com um inicial e as transições de partida', async () => {
  const s = await status();
  assert.deepEqual(s.map((x) => [x.id, x.nome, x.tipo, x.inicial]), [
    ['novo', 'Novo', 'aberto', true], ['confirmado', 'Confirmado', 'aberto', false], ['producao', 'Em produção', 'aberto', false],
    ['pronto', 'Pronto', 'aberto', false], ['entregue', 'Entregue', 'concluido', false], ['cancelado', 'Cancelado', 'cancelado', false],
  ]);
  assert.deepEqual(s.find((x) => x.id === 'novo').destinos, ['confirmado', 'producao', 'pronto', 'entregue', 'cancelado']);
  assert.deepEqual(s.find((x) => x.id === 'entregue').destinos, ['pronto']);
  assert.deepEqual(s.find((x) => x.id === 'cancelado').destinos, ['novo']);
  // A equipe recebe a lista completa em /api/site; o visitante, só id, nome e tipo.
  assert.deepEqual((await dona.get('/api/site')).dados.statusPedidos[0].destinos, s[0].destinos);
  assert.equal((await visitante.get('/api/site')).dados.statusPedidos[0].destinos, undefined);
});

test('transições: só as que a loja permite; o resto é recusado e nada muda', async () => {
  const n = await pedir(ana, dadosAna);
  assert.deepEqual([(await pedido(n)).status, (await pedido(n)).historico], ['novo', []]);

  assert.equal((await mudar(n, 'inventado')).status, 400);
  assert.equal((await mudar(n, 42)).status, 400);
  const igual = await mudar(n, 'novo');
  assert.equal(igual.status, 409);
  assert.match(igual.dados.erro, /já está como "Novo"/);

  assert.equal((await mudar(n, 'entregue')).status, 200);
  const recusado = await mudar(n, 'novo');
  assert.equal(recusado.status, 409);
  assert.match(recusado.dados.erro, /"Entregue" não pode ir para "Novo".*"Pronto"/);
  assert.equal((await mudar(n, 'cancelado')).status, 409);
  assert.equal((await pedido(n)).status, 'entregue');
  assert.equal((await pedido(n)).historico.length, 1, 'tentativa recusada não entra no histórico');

  // Desfazer um engano: de "Entregue" volta para "Pronto", e daí segue.
  assert.equal((await mudar(n, 'pronto')).status, 200);
  assert.equal((await mudar(n, 'cancelado', 'Cliente desistiu')).status, 200);
});

test('histórico: cada mudança guarda de onde, para onde, quem, quando e a observação', async () => {
  const [n] = numeros(await lista());
  const h = (await pedido(n)).historico;
  assert.deepEqual(h.map((x) => [x.de, x.deNome, x.para, x.paraNome, x.por, x.observacao]), [
    ['novo', 'Novo', 'entregue', 'Entregue', 'Administrador', ''],
    ['entregue', 'Entregue', 'pronto', 'Pronto', 'Administrador', ''],
    ['pronto', 'Pronto', 'cancelado', 'Cancelado', 'Administrador', 'Cliente desistiu'],
  ]);
  assert.ok(h.every((x) => !Number.isNaN(Date.parse(x.em))));
  assert.equal((await mudar(n, 'novo', 'x'.repeat(301))).status, 400);

  // O cliente vê por onde o pedido passou e quando; quem mudou e a observação são internos da loja.
  const meu = (await ana.get('/api/conta/pedidos')).dados.itens.find((p) => p.numero === n);
  assert.deepEqual(meu.historico.map((x) => Object.keys(x).sort()), Array(3).fill(['em', 'nome', 'status']));
  assert.deepEqual(meu.historico.map((x) => x.nome), ['Entregue', 'Pronto', 'Cancelado']);
  assert.doesNotMatch(JSON.stringify(meu), /Administrador|desistiu/);

  // O motivo também vai para o registro de atividades.
  const atividade = (await dona.get('/api/auditoria')).dados.itens[0];
  assert.deepEqual(atividade.detalhes, { de: 'Pronto', para: 'Cancelado', motivo: 'Cliente desistiu' });
});

test('o banco recusa alterar ou apagar o histórico de um pedido', async () => {
  const db = new DatabaseSync(path.join(servidor.pasta, 'loja.db'));
  try {
    db.exec('PRAGMA busy_timeout = 5000');
    const quantos = () => db.prepare('SELECT COUNT(*) AS n FROM pedido_historico').get().n;
    const antes = quantos();
    assert.throws(() => db.exec("UPDATE pedido_historico SET usuario_nome = 'Outra pessoa'"), /não pode ser alterado/);
    assert.throws(() => db.exec('DELETE FROM pedido_historico'), /não pode ser apagado/);
    assert.throws(() => db.exec("INSERT OR REPLACE INTO pedido_historico (id, pedido_numero, em, de, de_nome, para, para_nome) VALUES (1, 1, 'x', 'x', 'x', 'x', 'x')"), /não pode ser alterado/);
    assert.equal(quantos(), antes);
    // Status com pedido não é apagado nem direto no banco.
    assert.throws(() => db.exec("DELETE FROM status_pedido WHERE id = 'cancelado'"), /Há pedidos com este status/);
    // Só os pedidos de exemplo (npm run demo) levam o histórico junto quando são apagados.
    db.exec(`
      INSERT INTO pedidos (numero, id, criado_em, cliente_nome, cliente_telefone, entrega_tipo, entrega_data, total, status, demo)
        VALUES (900, 'demo-1', '2026-01-01T00:00:00.000Z', 'Cliente Exemplo', '11999990001', 'retirada', '2026-01-02', 100, 'novo', 1);
      INSERT INTO pedido_historico (pedido_numero, em, de, de_nome, para, para_nome) VALUES (900, 'x', 'novo', 'Novo', 'pronto', 'Pronto');
      DELETE FROM pedido_historico WHERE pedido_numero = 900;
      DELETE FROM pedidos WHERE numero = 900;
    `);
    assert.equal(quantos(), antes);
  } finally {
    db.close(); // arquivo aberto impede apagar a pasta do teste no Windows
  }
});

test('configurar os status: só quem pode mexer nas configurações', async () => {
  const atuais = await status();
  assert.equal((await gravar(atuais, visitante)).status, 401);
  assert.equal((await gravar(atuais, ana)).status, 401);
  assert.equal((await visitante.get('/api/status-pedidos')).status, 401);

  // Atendimento altera pedidos, mas não os status da loja.
  const perfis = (await dona.get('/api/equipe')).dados.perfis;
  await dona.post('/api/usuarios', { usuario: 'bia', nome: 'Bia', perfilId: perfis.find((p) => p.nome === 'Atendimento').id, senha: 'senha-da-bia-1' });
  const bia = servidor.navegador();
  await bia.post('/api/login', { usuario: 'bia', senha: 'senha-da-bia-1' });
  assert.equal((await gravar(atuais, bia)).status, 403);
  assert.equal((await bia.get('/api/status-pedidos')).status, 403);

  // E o nome de quem mudou o pedido é o de cada pessoa.
  const n = await pedir(joao, dadosJoao);
  const r = await bia.patch(`/api/pedidos/${(await pedido(n)).id}`, { status: 'confirmado' });
  assert.deepEqual([r.status, r.dados.historico.at(-1).por], [200, 'Bia']);
});

test('configurar os status: listas inválidas são recusadas por inteiro', async () => {
  const atuais = await status();
  const com = (mudanca) => atuais.map((s) => ({ ...s, ...mudanca(s) }));
  const casos = [
    [[], 400], ['texto', 400], [[atuais[0]], 400],
    [Array.from({ length: 16 }, (_, i) => ({ id: `s${i}`, nome: `Status ${i}`, tipo: 'aberto', inicial: i === 0, destinos: ['s0', 's1'] })), 400],
    [com((s) => (s.id === 'pronto' ? { nome: '' } : {})), 400],
    [com((s) => (s.id === 'pronto' ? { nome: 'x'.repeat(31) } : {})), 400],
    [com((s) => (s.id === 'pronto' ? { nome: 'NOVO' } : {})), 400],                    // nome repetido
    [com((s) => (s.id === 'pronto' ? { tipo: 'talvez' } : {})), 400],
    [com(() => ({ inicial: false })), 400],                                          // nenhum inicial
    [com((s) => ({ inicial: s.id === 'novo' || s.id === 'pronto' })), 400],          // dois iniciais
    [com((s) => ({ inicial: s.id === 'entregue' })), 400],                           // inicial que não é "em aberto"
    [com((s) => (s.id === 'pronto' ? { destinos: ['nao-existe'] } : {})), 400],
    [com((s) => (s.id === 'pronto' ? { destinos: [] } : {})), 400],                    // em aberto sem saída
    [[...atuais, { ...atuais[0], nome: 'Repetido' }], 400],                           // mesmo id duas vezes
  ];
  for (const [corpo, esperado] of casos) {
    assert.equal((await gravar(corpo)).status, esperado, JSON.stringify(corpo).slice(0, 120));
  }
  assert.deepEqual(await status(), atuais);
});

test('configurar os status: criar, renomear, reordenar e escolher as transições', async () => {
  const atuais = await status();
  // "Saiu para entrega" entra entre Pronto e Entregue; o id enviado é só uma referência dentro do envio.
  const nova = [
    ...atuais.slice(0, 3),
    { ...atuais[3], nome: 'Pronto para sair', destinos: ['rota', 'entregue', 'cancelado'] },
    { id: 'rota', nome: 'Saiu para entrega', tipo: 'aberto', inicial: false, destinos: ['entregue', 'pronto', 'rota'] },
    ...atuais.slice(4),
  ];
  const r = await gravar(nova);
  assert.equal(r.status, 200, r.dados.erro);
  assert.deepEqual(r.dados.map((s) => s.nome), ['Novo', 'Confirmado', 'Em produção', 'Pronto para sair', 'Saiu para entrega', 'Entregue', 'Cancelado']);
  const rota = r.dados.find((s) => s.nome === 'Saiu para entrega');
  assert.match(rota.id, /^[0-9a-f-]{36}$/);
  assert.deepEqual(rota.destinos, ['pronto', 'entregue'], 'na ordem da lista, sem apontar para si mesmo');
  assert.deepEqual(r.dados.find((s) => s.id === 'pronto').destinos, [rota.id, 'entregue', 'cancelado']);

  // O status novo vale para os pedidos, com as transições dele.
  const n = await pedir(ana, dadosAna, { entrega: { tipo: 'entrega', data: hojeLocal(3), endereco: { cep: '01001-000', rua: 'Praça da Sé', numero: '10', bairro: 'Sé', cidade: 'São Paulo', uf: 'SP' } } });
  assert.equal((await mudar(n, rota.id)).status, 409, 'status novo não ganha transição sozinho: "Novo" não foi ligado a ele');
  assert.equal((await mudar(n, 'pronto')).status, 200);
  assert.equal((await mudar(n, 'producao')).status, 409, 'a loja tirou a volta de Pronto para Em produção');
  assert.equal((await mudar(n, rota.id)).status, 200);
  assert.equal((await mudar(n, 'novo')).status, 409);
  assert.equal((await mudar(n, 'pronto')).status, 200);
  assert.equal((await mudar(n, rota.id)).status, 200);
  assert.deepEqual((await pedido(n)).historico.map((h) => h.paraNome), ['Pronto para sair', 'Saiu para entrega', 'Pronto para sair', 'Saiu para entrega']);
  assert.equal((await lista('?status=abertos')).itens.some((p) => p.numero === n), true);
  assert.equal((await ana.get('/api/site')).dados.statusPedidos.find((s) => s.id === rota.id).nome, 'Saiu para entrega');
});

test('configurar os status: o que tem pedido não é excluído nem muda de tipo; o histórico guarda o nome da época', async () => {
  let atuais = await status();
  const rota = atuais.find((s) => s.nome === 'Saiu para entrega');
  assert.equal(rota.pedidos, 1);

  const semRota = atuais.filter((s) => s.id !== rota.id).map((s) => ({ ...s, destinos: s.destinos.filter((d) => d !== rota.id) }));
  const excluir = await gravar(semRota);
  assert.equal(excluir.status, 409);
  assert.match(excluir.dados.erro, /Há 1 pedido\(s\) em "Saiu para entrega"/);
  const trocarTipo = await gravar(atuais.map((s) => (s.id === rota.id ? { ...s, tipo: 'cancelado' } : s)));
  assert.equal(trocarTipo.status, 409);
  assert.match(trocarTipo.dados.erro, /o tipo deste status não pode mudar/);

  // Renomear pode: o pedido continua no status, e o histórico guarda o nome que valia em cada mudança.
  assert.equal((await gravar(atuais.map((s) => (s.id === rota.id ? { ...s, nome: 'A caminho' } : s)))).status, 200);
  const [n] = numeros(await lista(`?status=${rota.id}`));
  assert.equal((await mudar(n, 'entregue')).status, 200);
  assert.deepEqual((await pedido(n)).historico.at(-1), { ...(await pedido(n)).historico.at(-1), deNome: 'A caminho', paraNome: 'Entregue' });
  assert.equal((await pedido(n)).historico[1].paraNome, 'Saiu para entrega');

  // Sem pedidos dentro, o status pode sair; o histórico continua legível.
  atuais = await status();
  assert.equal((await gravar(atuais.filter((s) => s.id !== rota.id).map((s) => ({ ...s, destinos: s.destinos.filter((d) => d !== rota.id) })))).status, 200);
  assert.equal((await status()).length, 6);
  assert.deepEqual((await pedido(n)).historico.map((h) => h.paraNome), ['Pronto para sair', 'Saiu para entrega', 'Pronto para sair', 'Saiu para entrega', 'Entregue']);
});

test('status inicial e tipos: pedido novo começa no inicial; cancelado de qualquer nome sai da receita', async () => {
  const atuais = await status();
  const r = await gravar([
    { id: 'recebido', nome: 'Recebido', tipo: 'aberto', inicial: true, destinos: ['novo', 'recusado'] },
    ...atuais.map((s) => ({ ...s, inicial: false })),
    { id: 'recusado', nome: 'Recusado pela loja', tipo: 'cancelado', inicial: false, destinos: [] },
  ]);
  assert.equal(r.status, 200, r.dados.erro);
  const recebido = r.dados.find((s) => s.nome === 'Recebido');
  const recusado = r.dados.find((s) => s.nome === 'Recusado pela loja');

  const antes = (await dona.get('/api/dashboard?dias=7')).dados.kpis;
  const n = await pedir(joao, dadosJoao);
  assert.equal((await pedido(n)).status, recebido.id);
  const meio = (await dona.get('/api/dashboard?dias=7')).dados.kpis;
  assert.deepEqual([meio.pedidos, meio.emAberto, meio.novos, meio.nomeInicial], [antes.pedidos + 1, antes.emAberto + 1, 1, 'Recebido']);

  assert.equal((await mudar(n, recusado.id)).status, 200);
  const depois = (await dona.get('/api/dashboard?dias=7')).dados;
  assert.deepEqual([depois.kpis.pedidos, depois.kpis.receita, depois.kpis.emAberto, depois.kpis.cancelados],
    [antes.pedidos, antes.receita, antes.emAberto, antes.cancelados + 1]);
  assert.equal(depois.status[recusado.id], 1);
  // Na aba Clientes, o pedido recusado também fica fora do total da pessoa.
  const pessoa = (await dona.get('/api/clientes')).dados.itens.find((c) => c.email === dadosJoao.email);
  assert.deepEqual([pessoa.pedidos.length, pessoa.quantidade], [2, 1]);
});

test('busca: nome sem acento, item, telefone e número do pedido, sempre no servidor', async () => {
  const todos = await lista();
  const daAna = todos.itens.filter((p) => p.cliente.nome === 'Ana Conceição').map((p) => p.numero);
  const doJoao = todos.itens.filter((p) => p.cliente.nome === 'João Guimarães').map((p) => p.numero);
  assert.ok(daAna.length >= 2 && doJoao.length >= 2);

  assert.deepEqual(numeros(await lista('?busca=conceicao')), daAna);
  assert.deepEqual(numeros(await lista('?busca=CONCEIÇÃO')), daAna);
  assert.deepEqual(numeros(await lista(`?busca=${encodeURIComponent('joão gui')}`)), doJoao);
  assert.deepEqual(numeros(await lista('?busca=99876')), doJoao, 'pedaço do telefone');
  assert.deepEqual(numeros(await lista(`?busca=${encodeURIComponent('(21) 99876-5432')}`)), doJoao, 'telefone como a pessoa digita');
  assert.deepEqual(numeros(await lista(`?busca=${daAna[0]}`)), [daAna[0]], 'número do pedido');
  assert.deepEqual(numeros(await lista(`?busca=${encodeURIComponent(`nº ${doJoao[0]}`)}`)), [doJoao[0]]);
  assert.deepEqual(numeros(await lista(`?busca=${encodeURIComponent(produtos[0].nome.toUpperCase())}`)), numeros(todos), 'nome de um item');
  assert.deepEqual(numeros(await lista('?busca=ninguem-com-esse-nome')), []);
  // % e _ valem como texto: não viram "qualquer coisa".
  assert.deepEqual(numeros(await lista('?busca=%25')), []);
  assert.deepEqual(numeros(await lista('?busca=_')), []);
  // Tentativa de injeção é só um texto que não casa com nada.
  assert.equal((await lista(`?busca=${encodeURIComponent("' OR 1=1 --")}`)).total, 0);
  assert.equal((await lista()).total, todos.total);
});

test('filtros: status, forma de receber e data marcada, combinados com a busca', async () => {
  const todos = (await lista()).itens;
  const entregas = todos.filter((p) => p.entrega.tipo === 'entrega').map((p) => p.numero);
  assert.equal(entregas.length, 1);
  assert.deepEqual(numeros(await lista('?entrega=entrega')), entregas);
  assert.deepEqual(numeros(await lista('?entrega=retirada')), todos.filter((p) => p.entrega.tipo === 'retirada').map((p) => p.numero));

  assert.deepEqual(numeros(await lista(`?de=${hojeLocal(2)}`)), entregas, 'só o pedido marcado para daqui a 3 dias');
  assert.deepEqual(numeros(await lista(`?ate=${hojeLocal(2)}`)), todos.filter((p) => !entregas.includes(p.numero)).map((p) => p.numero));
  assert.deepEqual(numeros(await lista(`?de=${hojeLocal(1)}&ate=${hojeLocal(1)}`)), todos.filter((p) => p.entrega.data === hojeLocal(1)).map((p) => p.numero));
  assert.deepEqual(numeros(await lista(`?de=${hojeLocal(10)}`)), []);

  assert.deepEqual(numeros(await lista('?status=cancelado')), todos.filter((p) => p.status === 'cancelado').map((p) => p.numero));
  assert.deepEqual(numeros(await lista('?status=abertos')), todos.filter((p) => ['novo', 'confirmado', 'producao', 'pronto'].includes(p.status)).map((p) => p.numero));
  assert.deepEqual(numeros(await lista('?status=entregue&busca=conceicao&entrega=entrega')), entregas);
  assert.deepEqual(numeros(await lista('?status=entregue&busca=guimaraes')), []);

  for (const consulta of ['?status=inventado', '?entrega=correio', '?de=ontem', '?ate=2026-13-45', '?de=2026-1-1']) {
    assert.equal((await dona.get(`/api/pedidos${consulta}`)).status, 400, consulta);
  }
  assert.equal((await visitante.get('/api/pedidos?busca=ana')).status, 401);
  // O total da resposta é o do filtro, não o de todos os pedidos.
  assert.equal((await lista('?entrega=entrega')).total, 1);
});
