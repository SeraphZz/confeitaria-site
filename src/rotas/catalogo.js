'use strict';
// Rotas do catálogo (produtos e categorias): consulta pública e cadastro pela loja (o 4º item `true` marca rota só da loja).

const crypto = require('node:crypto');
const banco = require('../../banco');
const { ErroHttp, lerJson } = require('../http');
const { texto, inteiro } = require('../validacao');
const { daEquipe } = require('../sessao');
const { salvarImagem, removerImagem, LIMITE_JSON_COM_FOTO } = require('../imagens');
const { criarSlug } = require('../primeiro-uso');
const configuracoes = require('../configuracoes');
const { modulos, paraVitrine, aplicarOpcionais } = require('../catalogo');
const { anotar } = require('../auditoria');

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
  if ('categoriaId' in corpo) {
    // Vazio = sem categoria.
    const id = corpo.categoriaId || null;
    if (id !== null && (typeof id !== 'string' || !banco.categoriaPorId(id))) throw new ErroHttp(400, 'Categoria não encontrada. Recarregue a página.');
    produto.categoriaId = id;
  }
  aplicarOpcionais(produto, corpo); // estoque, variações e adicionais (src/catalogo.js)
}

const MAX_CATEGORIAS = 50;

function acharCategoria(id) {
  const categoria = banco.categoriaPorId(id);
  if (!categoria) throw new ErroHttp(404, 'Categoria não encontrada.');
  return categoria;
}

// Duas categorias com o mesmo nome confundiriam a loja e o cliente ("Bolos" e "bolos" contam como iguais).
function lerNomeCategoria(valor, idAtual = null) {
  const nome = texto(valor, { max: 40, obrigatorio: true, campo: 'nome da categoria' });
  const igual = (a, b) => a.localeCompare(b, 'pt-BR', { sensitivity: 'base' }) === 0;
  if (banco.listarCategorias().some((c) => c.id !== idAtual && igual(c.nome, nome))) throw new ErroHttp(409, 'Já existe uma categoria com esse nome.');
  return nome;
}

module.exports = [
  // ---- categorias (a ordem da lista é a ordem em que aparecem na página inicial)
  ['GET', /^\/api\/categorias$/, () => banco.listarCategorias()],

  ['POST', /^\/api\/categorias$/, async (req) => {
    const corpo = await lerJson(req);
    if (banco.listarCategorias().length >= MAX_CATEGORIAS) throw new ErroHttp(400, `O limite é de ${MAX_CATEGORIAS} categorias.`);
    const categoria = { id: crypto.randomUUID(), nome: lerNomeCategoria(corpo.nome) };
    banco.salvarCategoria(categoria);
    anotar(req, categoria.nome);
    return categoria;
  }, 'produtos.editar', 'Criou uma categoria'],

  // Recebe os ids de todas as categorias, na nova ordem.
  ['PUT', /^\/api\/categorias\/ordem$/, async (req) => {
    const { ids } = await lerJson(req);
    const atuais = banco.listarCategorias().map((c) => c.id);
    const mesmaLista = Array.isArray(ids) && ids.length === atuais.length && new Set(ids).size === ids.length && ids.every((id) => atuais.includes(id));
    if (!mesmaLista) throw new ErroHttp(409, 'A lista de categorias mudou. Recarregue a página.');
    banco.ordenarCategorias(ids);
    return banco.listarCategorias();
  }, 'produtos.editar', 'Reordenou as categorias'],

  ['PUT', /^\/api\/categorias\/([0-9a-f-]{36})$/, async (req, [id]) => {
    const corpo = await lerJson(req);
    const categoria = acharCategoria(id);
    categoria.nome = lerNomeCategoria(corpo.nome, id);
    banco.salvarCategoria(categoria);
    anotar(req, categoria.nome);
    return categoria;
  }, 'produtos.editar', 'Renomeou uma categoria'],

  ['DELETE', /^\/api\/categorias\/([0-9a-f-]{36})$/, (req, [id]) => {
    const categoria = acharCategoria(id);
    banco.apagarCategoria(categoria.id);
    anotar(req, categoria.nome);
    return { ok: true };
  }, 'produtos.editar', 'Excluiu uma categoria'],

  // ---- produtos
  // Tudo o que sai daqui passa por `paraVitrine`: variações, adicionais e estoque só aparecem com o recurso ligado.
  ['GET', /^\/api\/produtos$/, (req) => {
    const ligados = modulos();
    return banco.listarProdutos({ soDisponiveis: !daEquipe(req) }).map((produto) => paraVitrine(produto, ligados));
  }],

  ['GET', /^\/api\/produtos\/([a-z0-9-]+)$/, (req, [slug]) => {
    const produto = banco.produtoPorSlug(slug);
    if (!produto || (!produto.disponivel && !daEquipe(req))) throw new ErroHttp(404, 'Produto não encontrado.');
    return paraVitrine(produto);
  }],

  ['POST', /^\/api\/produtos$/, async (req) => {
    const corpo = await lerJson(req);
    const produto = { id: crypto.randomUUID(), slug: '', nome: '', descricao: '', preco: 0, unidade: 'unidade', emoji: emojiPadrao(), imagem: '', disponivel: true, categoriaId: null,
      estoque: null, variacoes: [], adicionais: [] };
    aplicarCampos(produto, { nome: '', ...corpo });
    produto.slug = criarSlug(produto.nome, banco.listarProdutos().map((p) => p.slug));
    banco.salvarProduto(produto);
    anotar(req, produto.nome);
    return paraVitrine(produto);
  }, 'produtos.editar', 'Criou um produto'],

  ['PUT', /^\/api\/produtos\/([0-9a-f-]{36})$/, async (req, [id]) => {
    // O corpo é lido antes de buscar o produto: entre buscar e gravar não há espera, então nada muda no meio.
    const corpo = await lerJson(req);
    const produto = acharProduto(id);
    aplicarCampos(produto, corpo);
    banco.salvarProduto(produto);
    // No registro de atividades ficam os campos enviados e como ficaram preço, disponibilidade e estoque.
    anotar(req, produto.nome, { campos: Object.keys(corpo).slice(0, 20), preco: produto.preco, disponivel: produto.disponivel, estoque: produto.estoque });
    return paraVitrine(produto);
  }, 'produtos.editar', 'Alterou um produto'],

  ['DELETE', /^\/api\/produtos\/([0-9a-f-]{36})$/, (req, [id]) => {
    const produto = acharProduto(id);
    removerImagem(produto);
    banco.apagarProduto(produto.id);
    anotar(req, produto.nome);
    return { ok: true };
  }, 'produtos.editar', 'Excluiu um produto'],

  ['PUT', /^\/api\/produtos\/([0-9a-f-]{36})\/imagem$/, async (req, [id]) => {
    const { imagem } = await lerJson(req, LIMITE_JSON_COM_FOTO);
    const produto = acharProduto(id);
    if (imagem) salvarImagem(produto, imagem); else removerImagem(produto);
    banco.salvarProduto(produto);
    anotar(req, produto.nome);
    return paraVitrine(produto);
  }, 'produtos.editar', 'Trocou a foto de um produto'],
];
