'use strict';
// Sessões de login (equipe da loja e clientes), identificadas pelo cookie "sid".
//
// As sessões ficam no banco (tabela `sessoes`), então reiniciar o servidor não desloga ninguém. O cookie leva um
// token sorteado; o banco guarda só o SHA-256 dele: quem ler o banco ou um backup não consegue entrar como ninguém.
//
// Quem é da equipe é conferido a cada pedido: o usuário precisa existir e estar ativo, e as permissões são
// recalculadas na hora. Desativar alguém ou mudar o perfil vale imediatamente, sem esperar a sessão acabar.

const crypto = require('node:crypto');
const banco = require('../banco');
const { PRODUCAO } = require('./ambiente');
const { ErroHttp, lerCookie } = require('./http');
const permissoes = require('./permissoes');

const SESSAO_MS = 12 * 60 * 60 * 1000;

const hashDoToken = (token) => crypto.createHash('sha256').update(token).digest('hex');

// Faxina das sessões vencidas: ao subir e de tempos em tempos.
banco.apagarSessoesVencidas();
setInterval(() => banco.apagarSessoesVencidas(), 10 * 60 * 1000).unref();

function cookieSessao(token, maxAgeSeg) {
  return `sid=${token}; HttpOnly; SameSite=Lax; Path=/; Max-Age=${maxAgeSeg}${PRODUCAO ? '; Secure' : ''}`;
}

// O hash do token que veio no cookie, ou '' se não veio um token no formato esperado.
function hashDoCookie(req) {
  const token = lerCookie(req, 'sid');
  return /^[0-9a-f]{64}$/.test(token) ? hashDoToken(token) : '';
}

// Quem está fazendo o pedido: { usuario, cliente }, cada um preenchido ou null. Consultado uma vez por pedido.
const identificados = new WeakMap();
function identificar(req) {
  if (identificados.has(req)) return identificados.get(req);
  const quem = { usuario: null, cliente: null };
  const hash = hashDoCookie(req);
  const sessao = hash ? banco.sessaoPorHash(hash) : null;
  if (sessao && sessao.validade > Date.now()) {
    if (sessao.tipo === 'usuario') {
      const usuario = banco.usuarioPorId(sessao.usuarioId);
      if (usuario && usuario.ativo) quem.usuario = { ...usuario, permissoes: new Set(permissoes.doUsuario(usuario)) };
    } else {
      quem.cliente = banco.clientePorId(sessao.clienteId) || null;
    }
  }
  identificados.set(req, quem);
  return quem;
}

// Pessoa da equipe logada, com `permissoes` (um Set com as permissões efetivas), ou null.
const usuarioLogado = (req) => identificar(req).usuario;
const daEquipe = (req) => Boolean(usuarioLogado(req));
const pode = (req, permissao) => Boolean(usuarioLogado(req)?.permissoes.has(permissao));
const clienteLogado = (req) => identificar(req).cliente;

// Usada pelo servidor antes de cada rota do painel. `permissao` true = basta ser da equipe.
// 401 = não está logado (a tela manda para o login); 403 = está, mas não pode fazer isso.
function exigirPermissao(req, permissao) {
  const usuario = usuarioLogado(req);
  if (!usuario) throw new ErroHttp(401, 'Faça login para continuar.');
  if (permissao !== true && !usuario.permissoes.has(permissao)) throw new ErroHttp(403, 'Você não tem permissão para fazer isso.');
  return usuario;
}

function exigirCliente(req) {
  const cliente = clienteLogado(req);
  if (!cliente) throw new ErroHttp(401, 'Faça login para continuar.');
  return cliente;
}

// `dono`: { usuarioId } ou { clienteId }.
function abrirSessao(res, dono) {
  const token = crypto.randomBytes(32).toString('hex');
  banco.criarSessao({ ...dono, tokenHash: hashDoToken(token), validade: Date.now() + SESSAO_MS });
  res.setHeader('Set-Cookie', cookieSessao(token, SESSAO_MS / 1000));
}

function encerrarSessao(req, res) {
  const hash = hashDoCookie(req);
  if (hash) banco.apagarSessao(hash);
  res.setHeader('Set-Cookie', cookieSessao('', 0));
}

// Depois de redefinir a senha: quem estava logado nessa conta (talvez um invasor) é deslogado.
const derrubarSessoesDoCliente = (clienteId) => banco.apagarSessoesDoCliente(clienteId);

// Senha redefinida por outra pessoa, ou usuário desativado: todas as sessões dele caem.
const derrubarSessoesDoUsuario = (usuarioId) => banco.apagarSessoesDoUsuario(usuarioId);

// A própria pessoa trocou a senha: caem as outras sessões dela e fica só a de quem trocou.
const derrubarOutrasSessoesDoUsuario = (req, usuarioId) => banco.apagarSessoesDoUsuario(usuarioId, hashDoCookie(req));

module.exports = {
  usuarioLogado, daEquipe, pode, exigirPermissao, clienteLogado, exigirCliente, abrirSessao, encerrarSessao,
  derrubarSessoesDoCliente, derrubarSessoesDoUsuario, derrubarOutrasSessoesDoUsuario,
};
