'use strict';
// Rotas da equipe da loja: pessoas com acesso ao painel, perfis e o registro de atividades.
// As regras (ninguém concede o que não possui, sempre há um Administrador...) ficam em src/equipe.js.
// O 5º item de cada rota é o texto que vai para o registro de atividades (src/auditoria.js).

const banco = require('../../banco');
const { lerJson, lerPagina, pagina } = require('../http');
const { usuarioLogado, derrubarSessoesDoUsuario } = require('../sessao');
const { anotar } = require('../auditoria');
const equipe = require('../equipe');

const GERENCIAR = 'usuarios.gerenciar';
const UUID = '([0-9a-f-]{36})';
const ATIVIDADES_POR_PAGINA = 50;

const nomeDoPerfil = (id) => banco.perfilPorId(id)?.nome || '';

module.exports = [
  // Tudo o que a tela de equipe precisa: pessoas, perfis, a lista de permissões e as de quem está logado.
  ['GET', /^\/api\/equipe$/, (req) => equipe.montarEquipe(usuarioLogado(req)), GERENCIAR],

  ['POST', /^\/api\/usuarios$/, async (req) => {
    const corpo = await lerJson(req);
    const ator = usuarioLogado(req);
    const usuario = equipe.criarUsuario(ator, corpo);
    anotar(req, usuario.usuario, { nome: usuario.nome, perfil: nomeDoPerfil(usuario.perfilId), ...usuario.ajustes });
    return equipe.usuarioPublico(usuario, ator);
  }, GERENCIAR, 'Criou uma pessoa na equipe'],

  // Nome, perfil, ajustes individuais, ativo e (opcional) uma senha nova.
  ['PUT', new RegExp(`^/api/usuarios/${UUID}$`), async (req, [id]) => {
    const corpo = await lerJson(req);
    const ator = usuarioLogado(req);
    const { usuario, senhaTrocada, desativado } = equipe.alterarUsuario(ator, id, corpo);
    // Senha trocada por outra pessoa ou conta desativada: quem estava logado nela sai na hora.
    if (senhaTrocada || desativado) derrubarSessoesDoUsuario(usuario.id);
    // Fica registrado como a pessoa ficou; da senha, só que foi trocada.
    anotar(req, usuario.usuario, { nome: usuario.nome, perfil: nomeDoPerfil(usuario.perfilId), ativo: usuario.ativo, ...usuario.ajustes, senhaTrocada });
    return equipe.usuarioPublico(usuario, ator);
  }, GERENCIAR, 'Alterou uma pessoa da equipe'],

  ['POST', /^\/api\/perfis$/, async (req) => {
    const corpo = await lerJson(req);
    const ator = usuarioLogado(req);
    const perfil = equipe.criarPerfil(ator, corpo);
    anotar(req, perfil.nome, { permissoes: perfil.permissoes });
    return equipe.perfilPublico(perfil, ator);
  }, GERENCIAR, 'Criou um perfil'],

  ['PUT', new RegExp(`^/api/perfis/${UUID}$`), async (req, [id]) => {
    const corpo = await lerJson(req);
    const ator = usuarioLogado(req);
    const perfil = equipe.alterarPerfil(ator, id, corpo);
    anotar(req, perfil.nome, { permissoes: perfil.permissoes });
    return equipe.perfilPublico(perfil, ator);
  }, GERENCIAR, 'Alterou um perfil'],

  ['DELETE', new RegExp(`^/api/perfis/${UUID}$`), (req, [id]) => {
    anotar(req, equipe.apagarPerfil(usuarioLogado(req), id).nome);
    return { ok: true };
  }, GERENCIAR, 'Excluiu um perfil'],

  // Registro de atividades: do mais recente para o mais antigo (?pagina=2). Só leitura: não existe rota que altere.
  ['GET', /^\/api\/auditoria$/, (req, _p, _res, url) => {
    const numero = lerPagina(url);
    const { itens, total } = banco.paginarAuditoria({ pagina: numero, porPagina: ATIVIDADES_POR_PAGINA });
    return pagina(itens, total, numero, ATIVIDADES_POR_PAGINA);
  }, 'auditoria.ver'],
];
