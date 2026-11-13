'use strict';
// Regras de negócio dos pedidos: criação, visão por cliente e resumo do painel.

const crypto = require('node:crypto');
const banco = require('../banco');
const { ErroHttp } = require('./http');
const { texto, inteiro, lerTelefone, lerEndereco, formatarEndereco } = require('./validacao');
const configuracoes = require('./configuracoes');
const { modulos, paraVitrine, resolverEscolhas, descreverItem } = require('./catalogo');
const { diaNoFuso, somarDias, instanteAntesDoDia } = require('./datas');

const STATUS = ['novo', 'confirmado', 'producao', 'pronto', 'entregue', 'cancelado'];
const STATUS_ABERTOS = ['novo', 'confirmado', 'producao', 'pronto'];

function criarPedido(corpo, conta) {
  const cliente = corpo.cliente || {};
  const entrega = corpo.entrega || {};
  const nome = texto(cliente.nome, { max: 80, obrigatorio: true, campo: 'nome' });
  const telefone = lerTelefone(cliente.telefone);

  const tipo = entrega.tipo === 'entrega' ? 'entrega' : 'retirada';
  // A loja pode desligar uma das formas de receber (Painel > Configurações); a tela já esconde, o servidor confere.
  if (!configuracoes.ler('atendimento')[tipo].ativa) {
    throw new ErroHttp(400, tipo === 'entrega' ? 'No momento a loja não está fazendo entregas. Escolha retirada.' : 'No momento a loja não tem retirada. Escolha entrega.');
  }
  const endereco = tipo === 'entrega' ? lerEndereco(entrega.endereco, true) : null;
  const data = String(entrega.data || '');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(data) || Number.isNaN(Date.parse(data)) || data < diaNoFuso(new Date(), configuracoes.fusoHorario())) {
    throw new ErroHttp(400, 'Escolha uma data de hoje em diante.');
  }

  if (!Array.isArray(corpo.itens) || corpo.itens.length < 1 || corpo.itens.length > 50) {
    throw new ErroHttp(400, 'O carrinho está vazio.');
  }
  const ligados = modulos();
  // Preço e nome vêm sempre do banco — nunca do que o navegador enviou.
  const itens = corpo.itens.map((item) => {
    // `doceId` é o nome antigo do campo: ainda pode chegar de um carrinho guardado no navegador antes da atualização.
    const id = item && (item.produtoId ?? item.doceId);
    const gravado = typeof id === 'string' ? banco.produtoPorId(id) : null;
    if (!gravado || !gravado.disponivel) throw new ErroHttp(409, 'Um dos itens do carrinho não está mais disponível. Atualize a página.');
    const produto = paraVitrine(gravado, ligados);
    return {
      produtoId: produto.id, nome: produto.nome,
      // Variação e adicionais escolhidos, já conferidos; `precoUnit` inclui os dois.
      ...resolverEscolhas(produto, item),
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
    // Com o estoque ligado, cada item sai do estoque na hora do pedido. Se faltar para algum, o erro desfaz a
    // transação inteira: nada é baixado e o pedido não é gravado.
    if (ligados.estoque) {
      for (const item of itens) {
        const { baixou, restam } = banco.baixarEstoque(item);
        if (baixou) item.estoqueSituacao = 1;
        else if (restam !== null) {
          throw new ErroHttp(409, restam === 0
            ? `"${descreverItem(item)}" esgotou. Tire do carrinho para enviar o pedido.`
            : `Só restam ${restam} de "${descreverItem(item)}". Diminua a quantidade no carrinho.`);
        }
      }
    }
    pedido.numero = banco.inserirPedido(pedido);
    // Primeira entrega de quem ainda não tinha endereço no cadastro: guarda para os próximos pedidos.
    if (endereco && !conta.endereco.cep) banco.salvarCliente({ ...conta, endereco });
  });
  return pedido;
}

// Muda o status do pedido e acerta o estoque: cancelar devolve o que o pedido tinha tirado; reabrir um pedido
// cancelado tira de novo (e é recusado se não houver mais o bastante). Vale mesmo com o recurso de estoque desligado
// agora: o que conta é se o item mexeu no estoque quando o pedido foi feito.
function mudarStatus(pedido, status) {
  const cancelando = status === 'cancelado' && pedido.status !== 'cancelado';
  const reabrindo = status !== 'cancelado' && pedido.status === 'cancelado';
  banco.transacao(() => {
    if (cancelando) {
      for (const item of pedido.itens) if (item.estoqueSituacao === 1) banco.devolverEstoque(item);
      banco.trocarSituacaoEstoque(pedido.numero, 1, 2);
    } else if (reabrindo) {
      for (const item of pedido.itens) {
        if (item.estoqueSituacao !== 2) continue;
        const { baixou, restam } = banco.baixarEstoque(item);
        if (!baixou && restam !== null) {
          throw new ErroHttp(409, `Não dá para reabrir o pedido: ${restam === 0 ? 'não há mais' : `só restam ${restam} de`} "${descreverItem(item)}" no estoque.`);
        }
      }
      banco.trocarSituacaoEstoque(pedido.numero, 2, 1);
    }
    banco.mudarStatusPedido(pedido.id, status);
  });
  return banco.pedidoPorId(pedido.id);
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
      itens: p.itens.map((i) => `${i.quantidade}× ${descreverItem(i)}`).join(', '),
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

// Os dias são os do calendário da loja (fuso configurado), não os do servidor.
function montarDashboard(dias) {
  const fuso = configuracoes.fusoHorario();
  const hoje = diaNoFuso(new Date(), fuso);
  const inicio = somarDias(hoje, -(dias - 1));
  const inicioAnterior = somarDias(inicio, -dias);

  const serie = new Map();
  for (let d = inicio; d <= hoje; d = somarDias(d, 1)) serie.set(d, { data: d, receita: 0, pedidos: 0 });

  const porProduto = new Map();
  const status = Object.fromEntries(STATUS.map((s) => [s, 0]));
  let receita = 0, pedidos = 0, receitaAnterior = 0;
  const emAberto = banco.contarPedidosComStatus(STATUS_ABERTOS); // de qualquer data

  // Só os pedidos do período e do período anterior (para a comparação) saem do banco.
  for (const p of banco.listarPedidos({ desde: instanteAntesDoDia(inicioAnterior) })) {
    const criado = diaNoFuso(new Date(p.criadoEm), fuso);
    if (criado >= inicio) status[p.status]++;
    if (p.status === 'cancelado') continue; // cancelados não contam como receita
    if (criado >= inicio) {
      const dia = serie.get(criado);
      if (!dia) continue;
      dia.receita += p.total;
      dia.pedidos++;
      receita += p.total;
      pedidos++;
      for (const item of p.itens) {
        const reg = porProduto.get(item.nome) || { nome: item.nome, quantidade: 0, receita: 0 };
        reg.quantidade += item.quantidade;
        reg.receita += item.precoUnit * item.quantidade;
        porProduto.set(item.nome, reg);
      }
    } else if (criado >= inicioAnterior) {
      receitaAnterior += p.total;
    }
  }

  return {
    dias,
    kpis: { receita, pedidos, ticketMedio: pedidos ? Math.round(receita / pedidos) : 0, receitaAnterior, emAberto },
    serie: [...serie.values()],
    topProdutos: [...porProduto.values()].sort((a, b) => b.receita - a.receita).slice(0, 6),
    status,
  };
}

module.exports = { STATUS, criarPedido, mudarStatus, montarClientes, montarDashboard };
