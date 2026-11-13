'use strict';
// Rotas da equipe da loja: pessoas com acesso ao painel e perfis. Todas exigem "usuarios.gerenciar".
// As regras (ninguém concede o que não possui, sempre há um Administrador...) ficam em src/equipe.js.

const { lerJson } = require('../http');
const { usuarioLogado, derrubarSessoesDoUsuario } = require('../sessao');
const equipe = require('../equipe');

const GERENCIAR = 'usuarios.gerenciar';
const UUID = '([0-9a-f-]{36})';

module.exports = [
  // Tudo o que a tela de equipe precisa: pessoas, perfis, a lista de permissões e as de quem está logado.
  ['GET', /^\/api\/equipe$/, (req) => equipe.montarEquipe(usuarioLogado(req)), GERENCIAR],

  ['POST', /^\/api\/usuarios$/, async (req) => {
    const corpo = await lerJson(req);
    const ator = usuarioLogado(req);
    return equipe.usuarioPublico(equipe.criarUsuario(ator, corpo), ator);
  }, GERENCIAR],

  // Nome, perfil, ajustes individuais, ativo e (opcional) uma senha nova.
  ['PUT', new RegExp(`^/api/usuarios/${UUID}$`), async (req, [id]) => {
    const corpo = await lerJson(req);
    const ator = usuarioLogado(req);
    const { usuario, senhaTrocada, desativado } = equipe.alterarUsuario(ator, id, corpo);
    // Senha trocada por outra pessoa ou conta desativada: quem estava logado nela sai na hora.
    if (senhaTrocada || desativado) derrubarSessoesDoUsuario(usuario.id);
    return equipe.usuarioPublico(usuario, ator);
  }, GERENCIAR],

  ['POST', /^\/api\/perfis$/, async (req) => {
    const corpo = await lerJson(req);
    const ator = usuarioLogado(req);
    return equipe.perfilPublico(equipe.criarPerfil(ator, corpo), ator);
  }, GERENCIAR],

  ['PUT', new RegExp(`^/api/perfis/${UUID}$`), async (req, [id]) => {
    const corpo = await lerJson(req);
    const ator = usuarioLogado(req);
    return equipe.perfilPublico(equipe.alterarPerfil(ator, id, corpo), ator);
  }, GERENCIAR],

  ['DELETE', new RegExp(`^/api/perfis/${UUID}$`), (req, [id]) => {
    equipe.apagarPerfil(usuarioLogado(req), id);
    return { ok: true };
  }, GERENCIAR],
];
