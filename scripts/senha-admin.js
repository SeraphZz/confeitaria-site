'use strict';
// Redefine a senha da confeiteira (acesso de admin). Pode rodar com o servidor ligado:
//   node scripts/senha-admin.js              -> sorteia uma senha nova e mostra na tela
//   node scripts/senha-admin.js "MinhaSenha" -> usa a senha informada (mínimo 8 caracteres)

const crypto = require('node:crypto');
const banco = require('../banco');

const admin = banco.lerConfig('admin');
if (!admin) {
  console.error('Banco ainda vazio. Rode "node server.js" uma vez: a senha inicial aparece no terminal.');
  process.exit(1);
}

const senha = process.argv[2] || crypto.randomBytes(9).toString('base64url');
if (senha.length < 8) {
  console.error('A senha precisa ter pelo menos 8 caracteres.');
  process.exit(1);
}

const salt = crypto.randomBytes(16).toString('hex');
banco.gravarConfig('admin', {
  ...admin, salt,
  hash: crypto.scryptSync(senha, salt, 64).toString('hex'), // mesmo cálculo de hashSenha() no server.js
  senhaInicial: !process.argv[2], // senha sorteada: o painel lembra de trocar
});

console.log('\n==============================================');
console.log(' Acesso de admin (confeiteira)');
console.log(` Usuário: ${admin.usuario}`);
console.log(` Senha:   ${senha}`);
console.log(' Entre em /login com esses dados.');
console.log('==============================================\n');
