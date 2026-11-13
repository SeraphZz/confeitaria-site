'use strict';
// Regras dos recursos opcionais do catálogo. A loja liga cada um em Painel > Configurações (seção `modulos`):
//
//   variações   o mesmo produto em opções com preço próprio (Pequeno / Médio / Grande). Produto com variações exige
//               que o cliente escolha uma, e o preço dela substitui o preço do produto.
//   adicionais  extras somados ao preço (calda, borda recheada). O cliente marca quantos quiser, um de cada.
//   estoque     quantidade disponível. Vazio (null) = sem controle. Produto com variações tem o estoque em cada uma.
//
// Recurso desligado some das telas e deixa de valer nos pedidos, mas o que foi cadastrado continua no banco e volta
// quando o recurso é religado. Por isso existem duas visões do produto: a gravada (banco.js) e a que as telas e os
// pedidos enxergam (`paraVitrine`).

const crypto = require('node:crypto');
const { ErroHttp } = require('./http');
const { texto, inteiro } = require('./validacao');
const configuracoes = require('./configuracoes');

const MAX_VARIACOES = 20;
const MAX_ADICIONAIS = 30;
const MAX_ESTOQUE = 999_999;
const MAX_PRECO = 10_000_00; // em centavos

const modulos = () => configuracoes.ler('modulos');

function exigirModulo(nome, rotulo) {
  if (!modulos()[nome]) throw new ErroHttp(400, `O recurso "${rotulo}" está desligado. Ligue em Painel > Configurações.`);
}

// O produto como as telas e os pedidos devem enxergar, conforme os recursos ligados.
function paraVitrine(produto, m = modulos()) {
  const variacoes = m.variacoes ? produto.variacoes.map((v) => ({ ...v, estoque: m.estoque ? v.estoque : null })) : [];
  const estoque = m.estoque && !variacoes.length ? produto.estoque : null;
  return {
    ...produto, variacoes, adicionais: m.adicionais ? produto.adicionais : [], estoque,
    // Com variações, o produto só está esgotado quando todas estão.
    esgotado: variacoes.length ? variacoes.every((v) => v.estoque === 0) : estoque === 0,
  };
}

// Vazio = a loja não controla o estoque.
function lerEstoque(valor) {
  if (valor == null || valor === '') return null;
  return inteiro(valor, { min: 0, max: MAX_ESTOQUE, campo: 'estoque' });
}

// Lista de variações ou de adicionais enviada pelo painel. `atuais` é a lista gravada: uma opção que chega com o id
// de uma delas é a mesma opção alterada (carrinhos e pedidos continuam apontando para ela); as demais são novas.
function lerOpcoes(lista, atuais, { max, tipo, comEstoque = false }) {
  if (!Array.isArray(lista) || lista.length > max) throw new ErroHttp(400, `Lista de ${tipo} inválida (o limite é ${max}).`);
  const gravadas = new Map(atuais.map((o) => [o.id, o]));
  const estoqueLigado = comEstoque && modulos().estoque;
  const ids = new Set();
  const nomes = [];
  return lista.map((o) => {
    if (!o || typeof o !== 'object') throw new ErroHttp(400, `Lista de ${tipo} inválida.`);
    const nome = texto(o.nome, { max: 60, obrigatorio: true, campo: `nome (${tipo})` });
    if (nomes.some((n) => n.localeCompare(nome, 'pt-BR', { sensitivity: 'base' }) === 0)) throw new ErroHttp(400, `"${nome}" aparece duas vezes em ${tipo}.`);
    nomes.push(nome);
    const id = typeof o.id === 'string' && gravadas.has(o.id) && !ids.has(o.id) ? o.id : crypto.randomUUID();
    ids.add(id);
    const opcao = { id, nome, preco: inteiro(o.preco, { min: 0, max: MAX_PRECO, campo: `preço (${tipo})` }) };
    // Com o estoque desligado, a tela não envia o campo: fica o que estava gravado.
    if (comEstoque) opcao.estoque = estoqueLigado ? lerEstoque(o.estoque) : gravadas.get(id)?.estoque ?? null;
    return opcao;
  });
}

// Aplica ao produto gravado o que o painel enviou sobre os recursos opcionais.
function aplicarOpcionais(produto, corpo) {
  if ('estoque' in corpo) {
    exigirModulo('estoque', 'estoque');
    produto.estoque = lerEstoque(corpo.estoque);
  }
  if ('variacoes' in corpo) {
    exigirModulo('variacoes', 'variações');
    produto.variacoes = lerOpcoes(corpo.variacoes, produto.variacoes, { max: MAX_VARIACOES, tipo: 'variações', comEstoque: true });
  }
  if ('adicionais' in corpo) {
    exigirModulo('adicionais', 'adicionais');
    produto.adicionais = lerOpcoes(corpo.adicionais, produto.adicionais, { max: MAX_ADICIONAIS, tipo: 'adicionais' });
  }
}

// Confere o que o cliente escolheu em um item do carrinho contra o produto (já na visão da vitrine) e devolve o que
// vai para o pedido. Nomes e preços saem sempre do produto, nunca do que o navegador enviou.
function resolverEscolhas(produto, item) {
  const mudou = () => new ErroHttp(409, `As opções de "${produto.nome}" mudaram. Atualize a página e adicione ao carrinho de novo.`);

  let variacao = null;
  if (produto.variacoes.length) {
    variacao = produto.variacoes.find((v) => v.id === item.variacaoId);
    if (!variacao) throw item.variacaoId ? mudou() : new ErroHttp(400, `Escolha uma opção de "${produto.nome}".`);
  } else if (item.variacaoId) {
    throw mudou(); // o cliente tinha escolhido uma opção (com outro preço) que não existe mais
  }

  const pedidos = item.adicionaisIds ?? [];
  if (!Array.isArray(pedidos) || pedidos.length > MAX_ADICIONAIS) throw new ErroHttp(400, 'Adicionais inválidos.');
  const adicionais = produto.adicionais.filter((a) => pedidos.includes(a.id)); // na ordem do cadastro, sem repetir
  if (adicionais.length !== new Set(pedidos).size) throw mudou();

  return {
    variacaoId: variacao ? variacao.id : null,
    variacao: variacao ? variacao.nome : '',
    adicionais: adicionais.map((a) => ({ nome: a.nome, preco: a.preco })),
    precoUnit: (variacao ? variacao.preco : produto.preco) + adicionais.reduce((s, a) => s + a.preco, 0),
  };
}

// "Bolo (Grande) + Calda, Granulado": como um item de pedido é descrito em textos corridos.
function descreverItem(item) {
  return item.nome + (item.variacao ? ` (${item.variacao})` : '') + (item.adicionais?.length ? ` + ${item.adicionais.map((a) => a.nome).join(', ')}` : '');
}

module.exports = { modulos, paraVitrine, aplicarOpcionais, resolverEscolhas, descreverItem };
