'use strict';
// Rotas de pedidos: o cliente cria; a loja lista, muda o status e vê clientes e resumo.

const banco = require('../../banco');
const { ErroHttp, lerJson, ipDe, limitar } = require('../http');
const { exigirCliente } = require('../sessao');
const { STATUS, criarPedido, montarClientes, montarDashboard } = require('../pedidos');
const configuracoes = require('../configuracoes');

module.exports = [
  ['POST', /^\/api\/pedidos$/, async (req) => {
    limitar(`pedido:${ipDe(req)}`, 10, 10 * 60 * 1000);
    const cliente = exigirCliente(req); // só clientes logados fazem pedido
    const pedido = criarPedido(await lerJson(req), cliente);
    return { numero: pedido.numero, total: pedido.total };
  }],

  ['GET', /^\/api\/pedidos$/, () => banco.listarPedidos().reverse(), true],

  ['GET', /^\/api\/clientes$/, () => montarClientes(), true],

  ['PATCH', /^\/api\/pedidos\/([0-9a-f-]{36})$/, async (req, [id]) => {
    const pedido = banco.pedidoPorId(id);
    if (!pedido) throw new ErroHttp(404, 'Pedido não encontrado.');
    const { status } = await lerJson(req);
    if (!STATUS.includes(status)) throw new ErroHttp(400, 'Status inválido.');
    banco.mudarStatusPedido(id, status);
    pedido.status = status;
    return pedido;
  }, true],

  ['GET', /^\/api\/dashboard$/, (req, _p, _res, url) => {
    const dias = Number(url.searchParams.get('dias'));
    return { ...montarDashboard([7, 30, 90].includes(dias) ? dias : 30), senhaInicial: configuracoes.ler('admin').senhaInicial };
  }, true],
];
