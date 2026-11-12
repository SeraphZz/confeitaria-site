'use strict';
// Rotas do catálogo de produtos: consulta pública e cadastro pela loja (o 4º item `true` marca rota só da loja).

const crypto = require('node:crypto');
const banco = require('../../banco');
const { ErroHttp, lerJson } = require('../http');
const { texto, inteiro } = require('../validacao');
const { ehAdmin } = require('../sessao');
const { salvarImagem, removerImagem, LIMITE_JSON_COM_FOTO } = require('../imagens');
const { criarSlug } = require('../primeiro-uso');
const configuracoes = require('../configuracoes');

function acharProduto(id) {
  const produto = banco.produtoPorId(id);
  if (!produto) throw new ErroHttp(404, 'Produto não encontrado.');
  return produto;
}

// Ícone mostrado no lugar da foto quando o produto não tem uma: o escolhido para ele ou o padrão da loja.
const emojiPadrao = () => configuracoes.ler('catalogo').emojiPadrao;

function aplicarCampos(produto, corpo) {
  if ('nome' in corpo) produto.nome = texto(corpo.nome, { max: 80, obrigatorio: true, campo: 'nome' });
  if ('descricao' in corpo) produto.descricao = texto(corpo.descricao, { max: 1000, campo: 'descrição' });
  if ('unidade' in corpo) produto.unidade = texto(corpo.unidade, { max: 40, campo: 'unidade' }) || 'unidade';
  if ('emoji' in corpo) produto.emoji = texto(corpo.emoji, { max: 8, campo: 'emoji' }) || emojiPadrao();
  if ('preco' in corpo) produto.preco = inteiro(corpo.preco, { min: 0, max: 10_000_00, campo: 'preço' });
  if ('disponivel' in corpo) produto.disponivel = Boolean(corpo.disponivel);
}

module.exports = [
  ['GET', /^\/api\/produtos$/, (req) => banco.listarProdutos({ soDisponiveis: !ehAdmin(req) })],

  ['GET', /^\/api\/produtos\/([a-z0-9-]+)$/, (req, [slug]) => {
    const produto = banco.produtoPorSlug(slug);
    if (!produto || (!produto.disponivel && !ehAdmin(req))) throw new ErroHttp(404, 'Produto não encontrado.');
    return produto;
  }],

  ['POST', /^\/api\/produtos$/, async (req) => {
    const corpo = await lerJson(req);
    const produto = { id: crypto.randomUUID(), slug: '', nome: '', descricao: '', preco: 0, unidade: 'unidade', emoji: emojiPadrao(), imagem: '', disponivel: true };
    aplicarCampos(produto, { nome: '', ...corpo });
    produto.slug = criarSlug(produto.nome, banco.listarProdutos().map((p) => p.slug));
    banco.salvarProduto(produto);
    return produto;
  }, true],

  ['PUT', /^\/api\/produtos\/([0-9a-f-]{36})$/, async (req, [id]) => {
    const produto = acharProduto(id);
    aplicarCampos(produto, await lerJson(req));
    banco.salvarProduto(produto);
    return produto;
  }, true],

  ['DELETE', /^\/api\/produtos\/([0-9a-f-]{36})$/, (req, [id]) => {
    const produto = acharProduto(id);
    removerImagem(produto);
    banco.apagarProduto(produto.id);
    return { ok: true };
  }, true],

  ['PUT', /^\/api\/produtos\/([0-9a-f-]{36})\/imagem$/, async (req, [id]) => {
    const produto = acharProduto(id);
    const { imagem } = await lerJson(req, LIMITE_JSON_COM_FOTO);
    if (imagem) salvarImagem(produto, imagem); else removerImagem(produto);
    banco.salvarProduto(produto);
    return produto;
  }, true],
];
