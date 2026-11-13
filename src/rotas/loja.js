'use strict';
// Rotas de configuração, só da equipe da loja: dados de contato, página Sobre, operação, aparência e a própria senha.
// O 4º item de cada rota é a permissão exigida (src/permissoes.js); `true` = basta ser da equipe.
// As regras de cada configuração (campos, limites, o que é público) ficam em src/configuracoes.js.

const { ErroHttp, lerJson, ipDe, limitar, conferirBloqueio, registrarErro, zerarErros } = require('../http');
const { senhaConfere, novaSenha } = require('../senhas');
const banco = require('../../banco');
const { usuarioLogado, exigirPermissao, derrubarOutrasSessoesDoUsuario } = require('../sessao');
const { salvarImagem, removerImagem, LIMITE_JSON_COM_FOTO } = require('../imagens');
const configuracoes = require('../configuracoes');
const { FONTES, FONTE_PADRAO } = require('../tema');
const aparencia = require('../aparencia');

module.exports = [
  // Tudo o que o painel pode editar, de uma vez. Nunca inclui a conta de acesso.
  ['GET', /^\/api\/configuracoes$/, () => configuracoes.editaveis(), 'configuracoes.editar'],

  // Grava uma seção inteira (ex.: /api/configuracoes/operacao). Seção desconhecida ou interna responde 404.
  // A página Sobre é conteúdo, com permissão própria; as demais seções são configurações da loja.
  ['PUT', /^\/api\/configuracoes\/([a-z]{1,30})$/, async (req, [secao]) => {
    exigirPermissao(req, secao === 'sobre' ? 'conteudo.editar' : 'configuracoes.editar');
    return configuracoes.gravar(secao, await lerJson(req));
  }, true],

  // Endereços usados pelas telas atuais; equivalem a PUT /api/configuracoes/loja e /sobre.
  ['PUT', /^\/api\/loja$/, async (req) => configuracoes.gravar('loja', await lerJson(req)), 'configuracoes.editar'],
  ['PUT', /^\/api\/sobre$/, async (req) => configuracoes.gravar('sobre', await lerJson(req)), 'conteudo.editar'],

  ['PUT', /^\/api\/sobre\/imagem$/, async (req) => {
    const { imagem } = await lerJson(req, LIMITE_JSON_COM_FOTO);
    const sobre = configuracoes.ler('sobre');
    if (imagem) salvarImagem(sobre, imagem, 'sobre'); else removerImagem(sobre);
    return configuracoes.substituir('sobre', sobre);
  }, 'conteudo.editar'],

  // ---- Aparência: tudo o que se altera fica como rascunho até publicar (ver src/aparencia.js).
  // Todas respondem { publicado, rascunho }: o que os clientes veem e o que está pendente (null = nada pendente).

  // O que a tela de Aparência precisa para abrir (a lista de fontes fica só no servidor).
  ['GET', /^\/api\/tema$/, () => ({
    ...aparencia.estado(),
    fontes: Object.entries(FONTES).map(([id, f]) => ({ id, nome: f.nome })), fontePadrao: FONTE_PADRAO,
  }), 'aparencia.editar'],

  // Cores e letra dos títulos.
  ['PUT', /^\/api\/tema\/rascunho$/, async (req) => aparencia.salvarRascunho(await lerJson(req)), 'aparencia.editar'],

  // Imagens: cada envio substitui a anterior no rascunho; enviar vazio remove.
  ['PUT', /^\/api\/tema\/rascunho\/imagem\/(logo|favicon|banner)$/, async (req, [qual]) => {
    const { imagem } = await lerJson(req, LIMITE_JSON_COM_FOTO);
    return aparencia.trocarImagem(qual, imagem || '');
  }, 'aparencia.editar'],

  ['POST', /^\/api\/tema\/publicar$/, () => aparencia.publicar(), 'aparencia.editar'],
  ['DELETE', /^\/api\/tema\/rascunho$/, () => aparencia.descartar(), 'aparencia.editar'],

  ['PUT', /^\/api\/senha$/, async (req) => {
    limitar(`senha:${ipDe(req)}`, 8, 15 * 60 * 1000);
    const { atual, nova } = await lerJson(req);
    // Cada pessoa da equipe troca a própria senha (qualquer perfil).
    const { permissoes: _fora, ...usuario } = usuarioLogado(req);
    const conta = `senha:${usuario.id}`;
    conferirBloqueio(conta);
    if (!senhaConfere(atual, usuario)) { registrarErro(conta); throw new ErroHttp(400, 'A senha atual não confere.'); }
    zerarErros(conta);
    banco.salvarUsuario({ ...usuario, ...novaSenha(nova), senhaInicial: false });
    derrubarOutrasSessoesDoUsuario(req, usuario.id);
    return { ok: true };
  }, true],
];
