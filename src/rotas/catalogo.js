'use strict';
// Rotas do cardápio: consulta pública e cadastro pela loja (o 4º item `true` marca rota só da loja).

const crypto = require('node:crypto');
const banco = require('../../banco');
const { ErroHttp, lerJson } = require('../http');
const { texto, inteiro } = require('../validacao');
const { ehAdmin } = require('../sessao');
const { salvarImagem, removerImagem, LIMITE_JSON_COM_FOTO } = require('../imagens');
const { criarSlug } = require('../primeiro-uso');

function acharDoce(id) {
  const doce = banco.docePorId(id);
  if (!doce) throw new ErroHttp(404, 'Doce não encontrado.');
  return doce;
}

function aplicarCamposDoce(doce, corpo) {
  if ('nome' in corpo) doce.nome = texto(corpo.nome, { max: 80, obrigatorio: true, campo: 'nome' });
  if ('descricao' in corpo) doce.descricao = texto(corpo.descricao, { max: 1000, campo: 'descrição' });
  if ('unidade' in corpo) doce.unidade = texto(corpo.unidade, { max: 40, campo: 'unidade' }) || 'unidade';
  if ('emoji' in corpo) doce.emoji = texto(corpo.emoji, { max: 8, campo: 'emoji' }) || '🧁';
  if ('preco' in corpo) doce.preco = inteiro(corpo.preco, { min: 0, max: 10_000_00, campo: 'preço' });
  if ('disponivel' in corpo) doce.disponivel = Boolean(corpo.disponivel);
}

module.exports = [
  ['GET', /^\/api\/doces$/, (req) => banco.listarDoces({ soDisponiveis: !ehAdmin(req) })],

  ['GET', /^\/api\/doces\/([a-z0-9-]+)$/, (req, [slug]) => {
    const doce = banco.docePorSlug(slug);
    if (!doce || (!doce.disponivel && !ehAdmin(req))) throw new ErroHttp(404, 'Doce não encontrado.');
    return doce;
  }],

  ['POST', /^\/api\/doces$/, async (req) => {
    const corpo = await lerJson(req);
    const doce = { id: crypto.randomUUID(), slug: '', nome: '', descricao: '', preco: 0, unidade: 'unidade', emoji: '🧁', imagem: '', disponivel: true };
    aplicarCamposDoce(doce, { nome: '', ...corpo });
    doce.slug = criarSlug(doce.nome, banco.listarDoces().map((d) => d.slug));
    banco.salvarDoce(doce);
    return doce;
  }, true],

  ['PUT', /^\/api\/doces\/([0-9a-f-]{36})$/, async (req, [id]) => {
    const doce = acharDoce(id);
    aplicarCamposDoce(doce, await lerJson(req));
    banco.salvarDoce(doce);
    return doce;
  }, true],

  ['DELETE', /^\/api\/doces\/([0-9a-f-]{36})$/, (req, [id]) => {
    const doce = acharDoce(id);
    removerImagem(doce);
    banco.apagarDoce(doce.id);
    return { ok: true };
  }, true],

  ['PUT', /^\/api\/doces\/([0-9a-f-]{36})\/imagem$/, async (req, [id]) => {
    const doce = acharDoce(id);
    const { imagem } = await lerJson(req, LIMITE_JSON_COM_FOTO);
    if (imagem) salvarImagem(doce, imagem); else removerImagem(doce);
    banco.salvarDoce(doce);
    return doce;
  }, true],
];
