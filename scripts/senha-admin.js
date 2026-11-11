'use strict';
// Redefine a senha da confeiteira (acesso de admin). Rode com o servidor PARADO:
//   node scripts/senha-admin.js              -> sorteia uma senha nova e mostra na tela
//   node scripts/senha-admin.js "MinhaSenha" -> usa a senha informada (mínimo 8 caracteres)

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

const DATA_DIR = process.env.DATA_DIR ? path.resolve(process.env.DATA_DIR) : path.join(__dirname, '..', 'data');
const DB_FILE = path.join(DATA_DIR, 'db.json');
if (!fs.existsSync(DB_FILE)) {
  console.error('Banco não encontrado. Rode "node server.js" uma vez: a senha inicial aparece no terminal.');
  process.exit(1);
}

const senha = process.argv[2] || crypto.randomBytes(9).toString('base64url');
if (senha.length < 8) {
  console.error('A senha precisa ter pelo menos 8 caracteres.');
  process.exit(1);
}

const db = JSON.parse(fs.readFileSync(DB_FILE, 'utf8'));
const salt = crypto.randomBytes(16).toString('hex');
db.admin.salt = salt;
db.admin.hash = crypto.scryptSync(senha, salt, 64).toString('hex'); // mesmo cálculo de hashSenha() no server.js
db.admin.senhaInicial = !process.argv[2]; // senha sorteada: o painel lembra de trocar

const tmp = DB_FILE + '.tmp';
fs.writeFileSync(tmp, JSON.stringify(db, null, 2));
fs.renameSync(tmp, DB_FILE);

console.log('\n==============================================');
console.log(' Acesso de admin (confeiteira)');
console.log(` Usuário: ${db.admin.usuario}`);
console.log(` Senha:   ${senha}`);
console.log(' Entre em /login. Agora suba o servidor: node server.js');
console.log('==============================================\n');
