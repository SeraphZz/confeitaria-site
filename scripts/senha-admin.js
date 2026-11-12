'use strict';
// Redefine a senha de acesso ao painel da loja. Pode rodar com o servidor ligado:
//   node scripts/senha-admin.js              -> sorteia uma senha nova e mostra na tela
//   node scripts/senha-admin.js "MinhaSenha" -> usa a senha informada (mínimo 8 caracteres)

const configuracoes = require('../src/configuracoes');
const { TAMANHO_MINIMO, gerarHash, sortearSenha } = require('../src/senhas');

const admin = configuracoes.ler('admin');
if (!admin) {
  console.error('Banco ainda vazio. Rode "node server.js" uma vez: a senha inicial aparece no terminal.');
  process.exit(1);
}

const senha = process.argv[2] || sortearSenha();
if (senha.length < TAMANHO_MINIMO) {
  console.error(`A senha precisa ter pelo menos ${TAMANHO_MINIMO} caracteres.`);
  process.exit(1);
}

configuracoes.substituir('admin', {
  ...admin, ...gerarHash(senha),
  senhaInicial: !process.argv[2], // senha sorteada: o painel lembra de trocar
});

console.log('\n==============================================');
console.log(' Acesso ao painel da loja');
console.log(` Usuário: ${admin.usuario}`);
console.log(` Senha:   ${senha}`);
console.log(' Entre em /login com esses dados.');
console.log('==============================================\n');
