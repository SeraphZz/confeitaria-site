'use strict';
// Regras de negócio dos pedidos: criação, visão por cliente e resumo do painel.

const crypto = require('node:crypto');
const banco = require('../banco');
const { ErroHttp } = require('./http');
const { texto, inteiro, dataLocal, lerTelefone, lerEndereco, formatarEndereco } = require('./validacao');

const STATUS = ['novo', 'confirmado', 'producao', 'pronto', 'entregue', 'cancelado'];
const STATUS_ABERTOS = ['novo', 'confirmado', 'producao', 'pronto'];

function criarPedido(corpo, conta) {
  const cliente = corpo.cliente || {};
  const entrega = corpo.entrega || {};
  const nome = texto(cliente.nome, { max: 80, obrigatorio: true, campo: 'nome' });
  const telefone = lerTelefone(cliente.telefone);

  const tipo = entrega.tipo === 'entrega' ? 'entrega' : 'retirada';
  const endereco = tipo === 'entrega' ? lerEndereco(entrega.endereco, true) : null;
  const data = String(entrega.data || '');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(data) || Number.isNaN(Date.parse(data)) || data < dataLocal(new Date())) {
    throw new ErroHttp(400, 'Escolha uma data de hoje em diante.');
  }

  if (!Array.isArray(corpo.itens) || corpo.itens.length < 1 || corpo.itens.length > 50) {
    throw new ErroHttp(400, 'O carrinho está vazio.');
  }
  // Preço e nome vêm sempre do banco — nunca do que o navegador enviou.
  const itens = corpo.itens.map((item) => {
    const doce = item && typeof item.doceId === 'string' ? banco.docePorId(item.doceId) : null;
    if (!doce || !doce.disponivel) throw new ErroHttp(409, 'Um dos doces do carrinho não está mais disponível. Atualize a página.');
    return {
      doceId: doce.id, nome: doce.nome, precoUnit: doce.preco,
      quantidade: inteiro(item.quantidade, { min: 1, max: 999, campo: 'quantidade' }),
      observacoes: texto(item.observacoes, { max: 300, campo: 'alterações' }),
    };
  });

  const pedido = {
    id: crypto.randomUUID(), criadoEm: new Date().toISOString(),
    clienteId: conta.id, cliente: { nome, telefone }, entrega: { tipo, data, endereco: endereco ? formatarEndereco(endereco) : '' },
    itens, observacoes: texto(corpo.observacoes, { max: 500, campo: 'observações' }),
    total: itens.reduce((s, i) => s + i.precoUnit * i.quantidade, 0), status: 'novo',
  };
  banco.transacao(() => {
    pedido.numero = banco.inserirPedido(pedido);
    // Primeira entrega de quem ainda não tinha endereço no cadastro: guarda para os próximos pedidos.
    if (endereco && !conta.endereco.cep) banco.salvarCliente({ ...conta, endereco });
  });
  return pedido;
}

// Agrupa os pedidos por pessoa: pela conta, quando o cliente estava logado; senão pelo telefone.
function montarClientes() {
  const pessoas = new Map();
  for (const c of banco.listarClientes()) {
    pessoas.set(c.id, { nome: c.nome, telefone: c.telefone, email: c.email, cadastrado: true, pedidos: [] });
  }
  for (const p of banco.listarPedidos()) {
    const chave = p.clienteId && pessoas.has(p.clienteId) ? p.clienteId : `tel:${p.cliente.telefone}`;
    if (!pessoas.has(chave)) {
      pessoas.set(chave, { nome: p.cliente.nome, telefone: p.cliente.telefone, email: '', cadastrado: false, pedidos: [] });
    }
    pessoas.get(chave).pedidos.push({
      numero: p.numero, criadoEm: p.criadoEm, total: p.total, status: p.status,
      itens: p.itens.map((i) => `${i.quantidade}× ${i.nome}`).join(', '),
    });
  }
  return [...pessoas.values()].map((pessoa) => {
    const validos = pessoa.pedidos.filter((p) => p.status !== 'cancelado');
    pessoa.pedidos.reverse(); // mais recentes primeiro
    return {
      ...pessoa, quantidade: validos.length, total: validos.reduce((s, p) => s + p.total, 0),
      ultimoPedido: pessoa.pedidos[0]?.criadoEm || '',
    };
  }).sort((a, b) => b.total - a.total || a.nome.localeCompare(b.nome));
}

function montarDashboard(dias) {
  const hoje = new Date();
  hoje.setHours(0, 0, 0, 0);
  const inicio = new Date(hoje);
  inicio.setDate(inicio.getDate() - (dias - 1));
  const inicioAnterior = new Date(inicio);
  inicioAnterior.setDate(inicioAnterior.getDate() - dias);

  const serie = new Map();
  for (let d = new Date(inicio); d <= hoje; d.setDate(d.getDate() + 1)) {
    serie.set(dataLocal(d), { data: dataLocal(d), receita: 0, pedidos: 0 });
  }

  const porDoce = new Map();
  const status = Object.fromEntries(STATUS.map((s) => [s, 0]));
  let receita = 0, pedidos = 0, receitaAnterior = 0;
  const emAberto = banco.contarPedidosComStatus(STATUS_ABERTOS); // de qualquer data

  // Só os pedidos do período e do período anterior (para a comparação) saem do banco.
  for (const p of banco.listarPedidos({ desde: inicioAnterior.toISOString() })) {
    const criado = new Date(p.criadoEm);
    if (criado >= inicio) status[p.status]++;
    if (p.status === 'cancelado') continue; // cancelados não contam como receita
    if (criado >= inicio) {
      const dia = serie.get(dataLocal(criado));
      if (!dia) continue;
      dia.receita += p.total;
      dia.pedidos++;
      receita += p.total;
      pedidos++;
      for (const item of p.itens) {
        const reg = porDoce.get(item.nome) || { nome: item.nome, quantidade: 0, receita: 0 };
        reg.quantidade += item.quantidade;
        reg.receita += item.precoUnit * item.quantidade;
        porDoce.set(item.nome, reg);
      }
    } else if (criado >= inicioAnterior) {
      receitaAnterior += p.total;
    }
  }

  return {
    dias,
    kpis: { receita, pedidos, ticketMedio: pedidos ? Math.round(receita / pedidos) : 0, receitaAnterior, emAberto },
    serie: [...serie.values()],
    topDoces: [...porDoce.values()].sort((a, b) => b.receita - a.receita).slice(0, 6),
    status,
  };
}

module.exports = { STATUS, criarPedido, montarClientes, montarDashboard };
