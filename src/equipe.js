'use strict';
// Regras para gerenciar a equipe (pessoas e perfis). Quem tem a permissão "usuarios.gerenciar" passa por aqui.
//
// A regra central: ninguém concede o que não possui, nem mexe em quem pode mais do que ele.
//   - Só dá para criar ou alterar uma pessoa ou um perfil se tudo o que ela/ele pode fazer, antes e depois da
//     alteração, estiver dentro das permissões de quem está alterando.
//   - Ninguém altera o próprio perfil, os próprios ajustes ou se desativa: isso é feito por outra pessoa.
//   - O perfil Administrador é fixo, e a loja nunca fica sem ao menos um Administrador ativo.

const crypto = require('node:crypto');
const banco = require('../banco');
const { ErroHttp } = require('./http');
const { texto } = require('./validacao');
const { novaSenha } = require('./senhas');
const permissoes = require('./permissoes');

const MAX_PERFIS = 30;
const MAX_USUARIOS = 200;

// `ator` é a pessoa logada (com `permissoes`, um Set). Lança 403 se `lista` tiver algo que ela não possui.
function exigirQueCubra(ator, lista, mensagem) {
  if (!lista.every((p) => ator.permissoes.has(p))) throw new ErroHttp(403, mensagem);
}
const cobre = (ator, lista) => lista.every((p) => ator.permissoes.has(p));

function semAdministrador() {
  if (banco.contarAdministradoresAtivos() === 0) throw new ErroHttp(409, 'A loja precisa de ao menos uma pessoa ativa com o perfil Administrador.');
}

const mesmoTexto = (a, b) => a.localeCompare(b, 'pt-BR', { sensitivity: 'base' }) === 0;

// Lista de permissões enviada pelo painel: só ids conhecidos, sem repetir.
function lerPermissoes(lista, campo) {
  if (!Array.isArray(lista) || lista.some((p) => typeof p !== 'string' || !permissoes.existe(p))) throw new ErroHttp(400, `Lista de permissões inválida: ${campo}.`);
  return permissoes.TODAS.filter((p) => lista.includes(p));
}

// ---------------------------------------------------------------- perfis

function acharPerfil(id) {
  const perfil = typeof id === 'string' ? banco.perfilPorId(id) : null;
  if (!perfil) throw new ErroHttp(404, 'Perfil não encontrado.');
  return perfil;
}

function lerNomePerfil(valor, idAtual = null) {
  const nome = texto(valor, { max: 40, obrigatorio: true, campo: 'nome do perfil' });
  if (banco.listarPerfis().some((p) => p.id !== idAtual && mesmoTexto(p.nome, nome))) throw new ErroHttp(409, 'Já existe um perfil com esse nome.');
  return nome;
}

function criarPerfil(ator, corpo) {
  if (banco.listarPerfis().length >= MAX_PERFIS) throw new ErroHttp(400, `O limite é de ${MAX_PERFIS} perfis.`);
  const perfil = { id: crypto.randomUUID(), nome: lerNomePerfil(corpo.nome), permissoes: lerPermissoes(corpo.permissoes, 'perfil'), sistema: false };
  exigirQueCubra(ator, perfil.permissoes, 'Você só pode colocar em um perfil as permissões que você mesmo tem.');
  banco.salvarPerfil(perfil);
  return perfil;
}

function alterarPerfil(ator, id, corpo) {
  const perfil = acharPerfil(id);
  if (perfil.sistema) throw new ErroHttp(400, 'O perfil Administrador é fixo: tem sempre todas as permissões.');
  exigirQueCubra(ator, permissoes.doPerfil(perfil), 'Este perfil tem permissões que você não tem; só quem as tem pode alterá-lo.');
  if ('nome' in corpo) perfil.nome = lerNomePerfil(corpo.nome, perfil.id);
  if ('permissoes' in corpo) perfil.permissoes = lerPermissoes(corpo.permissoes, 'perfil');
  exigirQueCubra(ator, perfil.permissoes, 'Você só pode colocar em um perfil as permissões que você mesmo tem.');
  banco.salvarPerfil(perfil);
  return perfil;
}

function apagarPerfil(ator, id) {
  const perfil = acharPerfil(id);
  if (perfil.sistema) throw new ErroHttp(400, 'O perfil Administrador não pode ser excluído.');
  exigirQueCubra(ator, permissoes.doPerfil(perfil), 'Este perfil tem permissões que você não tem; só quem as tem pode excluí-lo.');
  if (banco.usuariosNoPerfil(perfil.id)) throw new ErroHttp(409, 'Há pessoas com este perfil. Troque o perfil delas antes de excluir.');
  banco.apagarPerfil(perfil.id);
  return perfil;
}

// ---------------------------------------------------------------- pessoas

function acharUsuario(id) {
  const usuario = banco.usuarioPorId(id);
  if (!usuario) throw new ErroHttp(404, 'Pessoa não encontrada.');
  return usuario;
}

// O que a pessoa digita para entrar: minúsculas, números, ponto, hífen e sublinhado. Sem "@", que é de e-mail de cliente.
function lerLogin(valor) {
  const login = texto(valor, { max: 30, obrigatorio: true, campo: 'usuário' }).toLowerCase();
  if (!/^[a-z0-9][a-z0-9._-]{2,29}$/.test(login)) throw new ErroHttp(400, 'O usuário deve ter de 3 a 30 caracteres: letras sem acento, números, ponto, hífen ou sublinhado.');
  if (banco.usuarioPorLogin(login)) throw new ErroHttp(409, 'Já existe uma pessoa com esse usuário.');
  return login;
}

function lerAjustes(valor) {
  const ajustes = valor && typeof valor === 'object' ? valor : {};
  const conceder = lerPermissoes(ajustes.conceder ?? [], 'liberar');
  const negar = lerPermissoes(ajustes.negar ?? [], 'bloquear');
  if (conceder.some((p) => negar.includes(p))) throw new ErroHttp(400, 'A mesma permissão não pode ser liberada e bloqueada.');
  return { conceder, negar };
}

// Aplica perfil e ajustes vindos do painel, conferindo que o resultado cabe no que o ator possui.
function aplicarAcesso(ator, usuario, corpo) {
  if ('perfilId' in corpo) usuario.perfilId = acharPerfil(corpo.perfilId).id;
  if ('ajustes' in corpo) usuario.ajustes = lerAjustes(corpo.ajustes);
  const perfil = banco.perfilPorId(usuario.perfilId);
  if (perfil.sistema) usuario.ajustes = { conceder: [], negar: [] }; // Administrador não tem ajustes
  exigirQueCubra(ator, permissoes.doUsuario(usuario, perfil), 'Você só pode dar a outra pessoa as permissões que você mesmo tem.');
  // Liberar individualmente também é conceder, mesmo que um bloqueio no mesmo cadastro anule o efeito.
  exigirQueCubra(ator, usuario.ajustes.conceder, 'Você só pode dar a outra pessoa as permissões que você mesmo tem.');
}

function criarUsuario(ator, corpo) {
  if (banco.contarUsuarios() >= MAX_USUARIOS) throw new ErroHttp(400, `O limite é de ${MAX_USUARIOS} pessoas.`);
  const usuario = {
    id: crypto.randomUUID(), usuario: lerLogin(corpo.usuario),
    nome: texto(corpo.nome, { max: 80, obrigatorio: true, campo: 'nome' }),
    perfilId: null, ajustes: { conceder: [], negar: [] },
    ...novaSenha(corpo.senha), ativo: true,
    senhaInicial: true, // a senha foi escolhida por outra pessoa: o painel lembra de trocar
    criadoEm: new Date().toISOString(),
  };
  aplicarAcesso(ator, usuario, { ajustes: {}, ...corpo, perfilId: corpo.perfilId });
  banco.salvarUsuario(usuario);
  return usuario;
}

// Devolve { usuario, senhaTrocada, desativado } para a rota derrubar as sessões quando for o caso.
function alterarUsuario(ator, id, corpo) {
  const usuario = acharUsuario(id);
  const antes = { ativo: usuario.ativo };
  exigirQueCubra(ator, permissoes.doUsuario(usuario), 'Esta pessoa tem permissões que você não tem; só quem as tem pode alterá-la.');

  const mexeNoAcesso = 'perfilId' in corpo || 'ajustes' in corpo || 'ativo' in corpo;
  if (usuario.id === ator.id && (mexeNoAcesso || 'senha' in corpo)) {
    throw new ErroHttp(400, 'Você não pode alterar o próprio acesso. Peça a outra pessoa com permissão; a sua senha você troca em Configurações.');
  }
  if ('nome' in corpo) usuario.nome = texto(corpo.nome, { max: 80, obrigatorio: true, campo: 'nome' });
  if ('ativo' in corpo) usuario.ativo = corpo.ativo === true;
  if ('perfilId' in corpo || 'ajustes' in corpo) aplicarAcesso(ator, usuario, corpo);
  const senhaTrocada = 'senha' in corpo && corpo.senha !== '';
  if (senhaTrocada) Object.assign(usuario, novaSenha(corpo.senha), { senhaInicial: true });

  return banco.transacao(() => {
    banco.salvarUsuario(usuario);
    semAdministrador(); // se a mudança deixou a loja sem Administrador ativo, o erro desfaz a gravação
    return { usuario, senhaTrocada, desativado: antes.ativo && !usuario.ativo };
  });
}

// ---------------------------------------------------------------- o que a tela de equipe recebe

// Nunca inclui salt nem hash. `gerenciavel`: se o ator pode alterar esta pessoa.
function usuarioPublico(usuario, ator) {
  const efetivas = permissoes.doUsuario(usuario);
  return {
    id: usuario.id, usuario: usuario.usuario, nome: usuario.nome, perfilId: usuario.perfilId, ativo: usuario.ativo,
    senhaInicial: usuario.senhaInicial, ajustes: usuario.ajustes, permissoes: efetivas,
    gerenciavel: usuario.id !== ator.id && cobre(ator, efetivas), voce: usuario.id === ator.id,
  };
}

function perfilPublico(perfil, ator) {
  const lista = permissoes.doPerfil(perfil);
  return {
    id: perfil.id, nome: perfil.nome, sistema: perfil.sistema, permissoes: lista, pessoas: banco.usuariosNoPerfil(perfil.id),
    // `atribuivel`: o ator pode dar este perfil a alguém; `gerenciavel`: pode alterar ou excluir o perfil.
    atribuivel: cobre(ator, lista), gerenciavel: !perfil.sistema && cobre(ator, lista),
  };
}

function montarEquipe(ator) {
  return {
    usuarios: banco.listarUsuarios().map((u) => usuarioPublico(u, ator)),
    perfis: banco.listarPerfis().map((p) => perfilPublico(p, ator)),
    permissoes: permissoes.PERMISSOES,
    minhas: [...ator.permissoes],
  };
}

module.exports = { criarPerfil, alterarPerfil, apagarPerfil, criarUsuario, alterarUsuario, usuarioPublico, perfilPublico, montarEquipe };
