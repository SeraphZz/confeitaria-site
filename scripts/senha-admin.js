'use strict';
// Redefine a senha de uma pessoa da equipe, para quem perdeu o acesso ao painel. Pode rodar com o servidor ligado:
//   node scripts/senha-admin.js                        -> sorteia uma senha para o Administrador e mostra na tela
//   node scripts/senha-admin.js "MinhaSenha"           -> usa a senha informada (mínimo 8 caracteres)
//   node scripts/senha-admin.js --usuario maria        -> outra pessoa da equipe, pelo usuário dela
//
// Sem --usuario, vale o primeiro Administrador ativo (ou, se nenhum estiver ativo, o primeiro Administrador).
// A conta é reativada, se estava desativada, e quem estava logado nela é deslogado.

const banco = require('../banco');
const { TAMANHO_MINIMO, gerarHash, sortearSenha } = require('../src/senhas');

function sair(mensagem) {
  console.error(mensagem);
  process.exit(1);
}

const args = process.argv.slice(2);
let login = null;
let senhaInformada = null;
for (let i = 0; i < args.length; i++) {
  if (args[i] === '--usuario') login = String(args[++i] || '').trim().toLowerCase();
  else if (args[i].startsWith('--')) sair(`Opção desconhecida: ${args[i]}`);
  else if (senhaInformada === null) senhaInformada = args[i];
  else sair('Informe uma senha só (use aspas se ela tiver espaços).');
}

if (banco.contarUsuarios() === 0) sair('Banco ainda vazio. Rode "node server.js" uma vez: a senha inicial aparece no terminal.');

let usuario;
if (login !== null) {
  usuario = banco.usuarioPorLogin(login);
  if (!usuario) sair(`Não existe ninguém na equipe com o usuário "${login}". Usuários: ${banco.listarUsuarios().map((u) => u.usuario).join(', ')}`);
} else {
  const sistema = banco.perfilDeSistema();
  const administradores = banco.listarUsuarios().filter((u) => u.perfilId === sistema.id); // os ativos vêm primeiro
  usuario = administradores[0];
  if (!usuario) sair('Não há ninguém com o perfil Administrador. Informe a pessoa com --usuario.');
}

const senha = senhaInformada || sortearSenha();
if (senha.length < TAMANHO_MINIMO) sair(`A senha precisa ter pelo menos ${TAMANHO_MINIMO} caracteres.`);

banco.transacao(() => {
  banco.salvarUsuario({
    ...usuario, ...gerarHash(senha), ativo: true,
    senhaInicial: !senhaInformada, // senha sorteada: o painel lembra de trocar
  });
  banco.apagarSessoesDoUsuario(usuario.id);
});

console.log('\n==============================================');
console.log(' Acesso ao painel da loja');
console.log(` Usuário: ${usuario.usuario}`);
console.log(` Senha:   ${senha}`);
console.log(' Entre em /login com esses dados.');
console.log('==============================================\n');
