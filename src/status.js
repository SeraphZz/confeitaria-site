'use strict';
// Status dos pedidos. A loja escolhe os nomes, a ordem e para quais status um pedido pode ir a partir de cada um
// (Painel > Configurações). O que o sistema precisa saber de um status é o tipo dele:
//   aberto    = ainda há o que fazer (entra em "Em aberto");
//   concluido = terminou bem;
//   cancelado = não vale: sai da receita e devolve o estoque.

const crypto = require('node:crypto');
const banco = require('../banco');
const { ErroHttp } = require('./http');
const { texto } = require('./validacao');

const TIPOS = ['aberto', 'concluido', 'cancelado'];
const MAXIMO = 15;

const listar = () => banco.listarStatus();
const porId = (id) => listar().find((s) => s.id === id) || null;
const inicial = () => listar().find((s) => s.inicial);
const idsDoTipo = (tipo) => listar().filter((s) => s.tipo === tipo).map((s) => s.id);

// Um pedido em `de` pode ir para `para`?
const podeIr = (de, para) => Boolean(porId(de)?.destinos.includes(para));

// Para a tela de configuração: cada status com a quantidade de pedidos que estão nele.
function comUso() {
  const uso = banco.pedidosPorStatus();
  return listar().map((s) => ({ ...s, pedidos: uso[s.id] || 0 }));
}

// Recebe a lista inteira, na ordem em que deve ficar: [{ id, nome, tipo, inicial, destinos: [ids] }].
// `id` de um status que já existe mantém esse status (e os pedidos que estão nele); qualquer outro `id` é só uma
// referência dentro do próprio envio, para os `destinos` apontarem para um status que está sendo criado agora.
function salvar(corpo) {
  if (!Array.isArray(corpo) || corpo.length < 2 || corpo.length > MAXIMO) {
    throw new ErroHttp(400, `A lista precisa ter de 2 a ${MAXIMO} status.`);
  }
  const atuais = new Map(comUso().map((s) => [s.id, s]));

  const referencias = new Map(); // id enviado -> id gravado
  const nomes = new Set();
  const lista = corpo.map((item) => {
    if (!item || typeof item !== 'object') throw new ErroHttp(400, 'Status inválido.');
    const nome = texto(item.nome, { max: 30, obrigatorio: true, campo: 'nome do status' });
    if (nomes.has(nome.toLowerCase())) throw new ErroHttp(400, `Há dois status chamados "${nome}".`);
    nomes.add(nome.toLowerCase());
    if (!TIPOS.includes(item.tipo)) throw new ErroHttp(400, `Escolha o tipo do status "${nome}".`);

    const enviado = typeof item.id === 'string' ? item.id : '';
    if (enviado && referencias.has(enviado)) throw new ErroHttp(400, 'Status repetido na lista.');
    const atual = atuais.get(enviado);
    // O tipo decide receita e estoque: trocá-lo com pedidos dentro deixaria esses pedidos contados errado.
    if (atual && atual.tipo !== item.tipo && atual.pedidos) {
      throw new ErroHttp(409, `Há ${atual.pedidos} pedido(s) em "${atual.nome}": o tipo deste status não pode mudar. Crie outro status e passe os pedidos para ele.`);
    }
    const id = atual ? atual.id : crypto.randomUUID();
    if (enviado) referencias.set(enviado, id);
    return { id, nome, tipo: item.tipo, inicial: item.inicial === true, destinos: Array.isArray(item.destinos) ? item.destinos : [] };
  });

  const iniciais = lista.filter((s) => s.inicial);
  if (iniciais.length !== 1) throw new ErroHttp(400, 'Marque um status (e só um) como o inicial: é com ele que todo pedido novo começa.');
  if (iniciais[0].tipo !== 'aberto') throw new ErroHttp(400, 'O status inicial precisa ser do tipo "em aberto".');

  for (const s of lista) {
    const destinos = new Set();
    for (const enviado of s.destinos) {
      const para = referencias.get(enviado);
      if (!para) throw new ErroHttp(400, `"${s.nome}" aponta para um status que não está na lista.`);
      if (para !== s.id) destinos.add(para);
    }
    s.destinos = [...destinos];
  }

  const mantidos = new Set(lista.map((s) => s.id));
  for (const atual of atuais.values()) {
    if (!mantidos.has(atual.id) && atual.pedidos) {
      throw new ErroHttp(409, `Há ${atual.pedidos} pedido(s) em "${atual.nome}". Passe-os para outro status antes de excluir este.`);
    }
  }
  // Pedido parado em um status sem saída ficaria preso: quem ainda está em aberto precisa poder ir a algum lugar.
  const semSaida = lista.find((s) => s.tipo === 'aberto' && !s.destinos.length);
  if (semSaida) throw new ErroHttp(400, `"${semSaida.nome}" é um status em aberto e não leva a nenhum outro. Marque ao menos um destino.`);

  banco.salvarStatus(lista);
  return comUso();
}

module.exports = { TIPOS, listar, porId, inicial, idsDoTipo, podeIr, comUso, salvar };
