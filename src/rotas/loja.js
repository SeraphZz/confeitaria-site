'use strict';
// Rotas de configuração, só da loja: dados de contato, página Sobre, operação e senha de acesso ao painel.
// As regras de cada configuração (campos, limites, o que é público) ficam em src/configuracoes.js.

const { ErroHttp, lerJson, ipDe, limitar } = require('../http');
const { senhaConfere, novaSenha } = require('../senhas');
const { derrubarOutrasSessoesAdmin } = require('../sessao');
const { salvarImagem, removerImagem, LIMITE_JSON_COM_FOTO } = require('../imagens');
const configuracoes = require('../configuracoes');

module.exports = [
  // Tudo o que o painel pode editar, de uma vez. Nunca inclui a conta de acesso.
  ['GET', /^\/api\/configuracoes$/, () => configuracoes.editaveis(), true],

  // Grava uma seção inteira (ex.: /api/configuracoes/operacao). Seção desconhecida ou interna responde 404.
  ['PUT', /^\/api\/configuracoes\/([a-z]{1,30})$/, async (req, [secao]) => configuracoes.gravar(secao, await lerJson(req)), true],

  // Endereços usados pelas telas atuais; equivalem a PUT /api/configuracoes/loja e /sobre.
  ['PUT', /^\/api\/loja$/, async (req) => configuracoes.gravar('loja', await lerJson(req)), true],
  ['PUT', /^\/api\/sobre$/, async (req) => configuracoes.gravar('sobre', await lerJson(req)), true],

  ['PUT', /^\/api\/sobre\/imagem$/, async (req) => {
    const { imagem } = await lerJson(req, LIMITE_JSON_COM_FOTO);
    const sobre = configuracoes.ler('sobre');
    if (imagem) salvarImagem(sobre, imagem, 'confeiteira'); else removerImagem(sobre);
    return configuracoes.substituir('sobre', sobre);
  }, true],

  ['PUT', /^\/api\/senha$/, async (req) => {
    limitar(`senha:${ipDe(req)}`, 8, 15 * 60 * 1000);
    const { atual, nova } = await lerJson(req);
    const admin = configuracoes.ler('admin');
    if (!senhaConfere(atual, admin)) throw new ErroHttp(400, 'A senha atual não confere.');
    configuracoes.substituir('admin', { ...admin, ...novaSenha(nova), senhaInicial: false });
    derrubarOutrasSessoesAdmin(req);
    return { ok: true };
  }, true],
];
