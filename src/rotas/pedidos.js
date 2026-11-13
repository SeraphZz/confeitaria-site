'use strict';
// Rotas de pedidos: o cliente cria; a loja lista, muda o status e vê clientes e resumo.

const banco = require('../../banco');
const { ErroHttp, lerJson, ipDe, limitar, lerPagina, pagina } = require('../http');
const { exigirCliente, usuarioLogado } = require('../sessao');
const { anotar } = require('../auditoria');
const { STATUS, STATUS_ABERTOS, criarPedido, mudarStatus, montarClientes, montarDashboard } = require('../pedidos');

const POR_PAGINA = 30; // pedidos e clientes por página no painel

module.exports = [
  ['POST', /^\/api\/pedidos$/, async (req) => {
    limitar(`pedido:${ipDe(req)}`, 10, 10 * 60 * 1000);
    const cliente = exigirCliente(req); // só clientes logados fazem pedido
    const pedido = criarPedido(await lerJson(req), cliente);
    return { numero: pedido.numero, total: pedido.total };
  }],

  // Lista paginada, do mais novo para o mais antigo: ?pagina=2&status=abertos (ou "todos", ou um status).
  ['GET', /^\/api\/pedidos$/, (req, _p, _res, url) => {
    const filtro = url.searchParams.get('status') || 'todos';
    if (filtro !== 'todos' && filtro !== 'abertos' && !STATUS.includes(filtro)) throw new ErroHttp(400, 'Status inválido.');
    const status = filtro === 'todos' ? undefined : filtro === 'abertos' ? STATUS_ABERTOS : [filtro];
    const numero = lerPagina(url);
    const { pedidos, total } = banco.paginarPedidos({ status, pagina: numero, porPagina: POR_PAGINA });
    return pagina(pedidos, total, numero, POR_PAGINA);
  }, 'pedidos.ver'],

  // Pessoas e o que cada uma já pediu, de quem mais comprou para quem menos comprou: ?pagina=2&busca=ana.
  // A busca olha nome, telefone e e-mail.
  ['GET', /^\/api\/clientes$/, (req, _p, _res, url) => {
    const busca = (url.searchParams.get('busca') || '').trim().toLowerCase().slice(0, 80);
    const todos = montarClientes();
    const achados = busca ? todos.filter((c) => `${c.nome} ${c.telefone} ${c.email}`.toLowerCase().includes(busca)) : todos;
    const numero = lerPagina(url);
    return pagina(achados.slice((numero - 1) * POR_PAGINA, numero * POR_PAGINA), achados.length, numero, POR_PAGINA);
  }, 'clientes.ver'],

  ['PATCH', /^\/api\/pedidos\/([0-9a-f-]{36})$/, async (req, [id]) => {
    const { status } = await lerJson(req);
    if (!STATUS.includes(status)) throw new ErroHttp(400, 'Status inválido.');
    const pedido = banco.pedidoPorId(id);
    if (!pedido) throw new ErroHttp(404, 'Pedido não encontrado.');
    const atualizado = mudarStatus(pedido, status); // cancelar e reabrir acertam o estoque
    anotar(req, `Pedido nº ${pedido.numero}`, { de: pedido.status, para: status });
    return atualizado;
  }, 'pedidos.alterar', 'Alterou o status de um pedido'],

  ['GET', /^\/api\/dashboard$/, (req, _p, _res, url) => {
    const dias = Number(url.searchParams.get('dias'));
    return { ...montarDashboard([7, 30, 90].includes(dias) ? dias : 30), senhaInicial: usuarioLogado(req).senhaInicial };
  }, 'resumo.ver'],
];
