'use strict';
// Senhas nunca são guardadas: só o resultado do scrypt com um salt sorteado para cada conta.
// Serve para a conta da loja (config 'admin') e para clientes: ambos guardam { salt, hash }.

const crypto = require('node:crypto');
const { ErroHttp } = require('./http');

const TAMANHO_MINIMO = 8;

function hashSenha(senha, salt) {
  return crypto.scryptSync(senha, salt, 64).toString('hex');
}

// Sem validação de tamanho: para os scripts de linha de comando e para a senha sorteada do primeiro acesso.
function gerarHash(senha) {
  const salt = crypto.randomBytes(16).toString('hex');
  return { salt, hash: hashSenha(senha, salt) };
}

function senhaConfere(senha, conta) {
  if (typeof senha !== 'string' || senha.length > 200) return false;
  const a = Buffer.from(hashSenha(senha, conta.salt), 'hex');
  const b = Buffer.from(conta.hash, 'hex');
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

// Valida a senha escolhida por alguém e devolve { salt, hash } para gravar.
function novaSenha(senha) {
  if (typeof senha !== 'string' || senha.length < TAMANHO_MINIMO || senha.length > 200) {
    throw new ErroHttp(400, 'A senha precisa ter pelo menos 8 caracteres.');
  }
  return gerarHash(senha);
}

const sortearSenha = () => crypto.randomBytes(9).toString('base64url');

module.exports = { TAMANHO_MINIMO, gerarHash, senhaConfere, novaSenha, sortearSenha };
