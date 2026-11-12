'use strict';
// Sessões de login (loja e clientes), identificadas pelo cookie "sid".

const crypto = require('node:crypto');
const banco = require('../banco');
const { PRODUCAO } = require('./ambiente');
const { ErroHttp, lerCookie, limparVencidos } = require('./http');

const SESSAO_MS = 12 * 60 * 60 * 1000;

// token -> { validade, tipo: 'admin' | 'cliente', clienteId }. Em memória: reiniciar o servidor desloga.
const sessoes = new Map();
limparVencidos(sessoes, 'validade');

function cookieSessao(token, maxAgeSeg) {
  return `sid=${token}; HttpOnly; SameSite=Lax; Path=/; Max-Age=${maxAgeSeg}${PRODUCAO ? '; Secure' : ''}`;
}

function sessaoDe(req) {
  const sessao = sessoes.get(lerCookie(req, 'sid'));
  return sessao && sessao.validade > Date.now() ? sessao : null;
}

function ehAdmin(req) {
  return sessaoDe(req)?.tipo === 'admin';
}

function clienteLogado(req) {
  const sessao = sessaoDe(req);
  return (sessao?.tipo === 'cliente' && banco.clientePorId(sessao.clienteId)) || null;
}

function exigirCliente(req) {
  const cliente = clienteLogado(req);
  if (!cliente) throw new ErroHttp(401, 'Faça login para continuar.');
  return cliente;
}

function abrirSessao(res, dados) {
  const token = crypto.randomBytes(32).toString('hex');
  sessoes.set(token, { ...dados, validade: Date.now() + SESSAO_MS });
  res.setHeader('Set-Cookie', cookieSessao(token, SESSAO_MS / 1000));
}

function encerrarSessao(req, res) {
  sessoes.delete(lerCookie(req, 'sid'));
  res.setHeader('Set-Cookie', cookieSessao('', 0));
}

// Depois de redefinir a senha: quem estava logado nessa conta (talvez um invasor) é deslogado.
function derrubarSessoesDoCliente(clienteId) {
  for (const [t, sessao] of sessoes) if (sessao.clienteId === clienteId) sessoes.delete(t);
}

// Depois de trocar a senha da loja: derruba as outras sessões de admin e mantém só a de quem trocou.
function derrubarOutrasSessoesAdmin(req) {
  const atual = lerCookie(req, 'sid');
  for (const [t, sessao] of sessoes) if (sessao.tipo === 'admin' && t !== atual) sessoes.delete(t);
}

module.exports = {
  ehAdmin, clienteLogado, exigirCliente, abrirSessao, encerrarSessao, derrubarSessoesDoCliente, derrubarOutrasSessoesAdmin,
};
