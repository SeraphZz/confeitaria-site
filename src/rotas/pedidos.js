'use strict';
// Rotas de pedidos: o cliente cria; a loja lista (com busca e filtros), muda o status, configura os status e vê
// clientes e resumo.

const banco = require('../../banco');
const { ErroHttp, lerJson, ipDe, limitar, lerPagina, pagina } = require('../http');
const { exigirCliente, usuarioLogado } = require('../sessao');
const { anotar } = require('../auditoria');
const { texto } = require('../validacao');
const { criarPedido, mudarStatus, montarClientes, montarDashboard } = require('../pedidos');
const statusPedido = require('../status');

const POR_PAGINA = 30; // pedidos e clientes por página no painel

// Data de um filtro (?de=2026-11-01): vazia = sem filtro.
function lerData(url, nome) {
  const valor = url.searchParams.get(nome) || '';
  if (valor && (!/^\d{4}-\d{2}-\d{2}$/.test(valor) || Number.isNaN(Date.parse(valor)))) throw new ErroHttp(400, 'Data inválida.');
  return valor;
}

module.exports = [
  ['POST', /^\/api\/pedidos$/, async (req) => {
    limitar(`pedido:${ipDe(req)}`, 10, 10 * 60 * 1000);
    const cliente = exigirCliente(req); // só clientes logados fazem pedido
    const pedido = criarPedido(await lerJson(req), cliente);
    return { numero: pedido.numero, total: pedido.total };
  }],

  // Lista paginada, do mais novo para o mais antigo. Os filtros são opcionais e somam:
  //   ?status=abertos (ou "todos", ou o id de um status)
  //   &busca=ana          nome do cliente, nome de um item, telefone ou número do pedido
  //   &entrega=retirada   ou "entrega"
  //   &de=2026-11-01&ate=2026-11-30   data marcada para a entrega ou retirada
  ['GET', /^\/api\/pedidos$/, (req, _p, _res, url) => {
    const filtro = url.searchParams.get('status') || 'todos';
    let status;
    if (filtro === 'abertos') status = statusPedido.idsDoTipo('aberto');
    else if (filtro !== 'todos') {
      if (!statusPedido.porId(filtro)) throw new ErroHttp(400, 'Status inválido.');
      status = [filtro];
    }
    const entregaTipo = url.searchParams.get('entrega') || '';
    if (entregaTipo && entregaTipo !== 'retirada' && entregaTipo !== 'entrega') throw new ErroHttp(400, 'Forma de receber inválida.');
    const numero = lerPagina(url);
    const { pedidos, total } = banco.paginarPedidos({
      status, entregaTipo, de: lerData(url, 'de'), ate: lerData(url, 'ate'),
      busca: (url.searchParams.get('busca') || '').trim().slice(0, 80),
      pagina: numero, porPagina: POR_PAGINA,
    });
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

  // Muda o status: { status, observacao (opcional) }. Só vale se a loja permite ir do status atual para o novo; a
  // mudança entra no histórico do pedido com o nome de quem fez. Cancelar e reabrir acertam o estoque.
  ['PATCH', /^\/api\/pedidos\/([0-9a-f-]{36})$/, async (req, [id]) => {
    const { status, observacao } = await lerJson(req);
    if (typeof status !== 'string') throw new ErroHttp(400, 'Status inválido.');
    const nota = texto(observacao, { max: 300, campo: 'observação' });
    const pedido = banco.pedidoPorId(id);
    if (!pedido) throw new ErroHttp(404, 'Pedido não encontrado.');
    const atualizado = mudarStatus(pedido, status, { quem: usuarioLogado(req), observacao: nota });
    const ultima = atualizado.historico.at(-1);
    anotar(req, `Pedido nº ${pedido.numero}`, { de: ultima.deNome, para: ultima.paraNome, ...(nota ? { motivo: nota } : {}) });
    return atualizado;
  }, 'pedidos.alterar', 'Alterou o status de um pedido'],

  // Os status com as transições e quantos pedidos há em cada um, para a tela de configuração.
  ['GET', /^\/api\/status-pedidos$/, () => statusPedido.comUso(), 'configuracoes.editar'],

  // Grava a lista inteira de status, na ordem enviada: { status: [...] } (as regras ficam em src/status.js).
  ['PUT', /^\/api\/status-pedidos$/, async (req) => {
    const lista = statusPedido.salvar((await lerJson(req)).status);
    anotar(req, 'status dos pedidos', { nomes: lista.map((s) => s.nome) });
    return lista;
  }, 'configuracoes.editar', 'Alterou os status dos pedidos'],

  ['GET', /^\/api\/dashboard$/, (req, _p, _res, url) => {
    const dias = Number(url.searchParams.get('dias'));
    return { ...montarDashboard([7, 30, 90].includes(dias) ? dias : 30), senhaInicial: usuarioLogado(req).senhaInicial };
  }, 'resumo.ver'],
];
