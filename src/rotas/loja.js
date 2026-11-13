'use strict';
// Rotas de configuração, só da loja: dados de contato, página Sobre, operação e senha de acesso ao painel.
// As regras de cada configuração (campos, limites, o que é público) ficam em src/configuracoes.js.

const { ErroHttp, lerJson, ipDe, limitar, conferirBloqueio, registrarErro, zerarErros } = require('../http');
const { senhaConfere, novaSenha } = require('../senhas');
const { derrubarOutrasSessoesAdmin } = require('../sessao');
const { salvarImagem, removerImagem, LIMITE_JSON_COM_FOTO } = require('../imagens');
const configuracoes = require('../configuracoes');
const { FONTES, FONTE_PADRAO } = require('../tema');
const aparencia = require('../aparencia');

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
    if (imagem) salvarImagem(sobre, imagem, 'sobre'); else removerImagem(sobre);
    return configuracoes.substituir('sobre', sobre);
  }, true],

  // ---- Aparência: tudo o que se altera fica como rascunho até publicar (ver src/aparencia.js).
  // Todas respondem { publicado, rascunho }: o que os clientes veem e o que está pendente (null = nada pendente).

  // O que a tela de Aparência precisa para abrir (a lista de fontes fica só no servidor).
  ['GET', /^\/api\/tema$/, () => ({
    ...aparencia.estado(),
    fontes: Object.entries(FONTES).map(([id, f]) => ({ id, nome: f.nome })), fontePadrao: FONTE_PADRAO,
  }), true],

  // Cores e letra dos títulos.
  ['PUT', /^\/api\/tema\/rascunho$/, async (req) => aparencia.salvarRascunho(await lerJson(req)), true],

  // Imagens: cada envio substitui a anterior no rascunho; enviar vazio remove.
  ['PUT', /^\/api\/tema\/rascunho\/imagem\/(logo|favicon|banner)$/, async (req, [qual]) => {
    const { imagem } = await lerJson(req, LIMITE_JSON_COM_FOTO);
    return aparencia.trocarImagem(qual, imagem || '');
  }, true],

  ['POST', /^\/api\/tema\/publicar$/, () => aparencia.publicar(), true],
  ['DELETE', /^\/api\/tema\/rascunho$/, () => aparencia.descartar(), true],

  ['PUT', /^\/api\/senha$/, async (req) => {
    limitar(`senha:${ipDe(req)}`, 8, 15 * 60 * 1000);
    const { atual, nova } = await lerJson(req);
    const admin = configuracoes.ler('admin');
    conferirBloqueio('senha:admin');
    if (!senhaConfere(atual, admin)) { registrarErro('senha:admin'); throw new ErroHttp(400, 'A senha atual não confere.'); }
    zerarErros('senha:admin');
    configuracoes.substituir('admin', { ...admin, ...novaSenha(nova), senhaInicial: false });
    derrubarOutrasSessoesAdmin(req);
    return { ok: true };
  }, true],
];
