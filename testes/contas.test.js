'use strict';
// Contas de clientes: cadastro, login, dados da conta, sair e "esqueci minha senha".

const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { subirServidor, dadosCliente, SENHA_ADMIN } = require('./apoio');

let servidor;
before(async () => { servidor = await subirServidor(); });
after(() => servidor.parar());

test('cadastro cria a conta, já entra logado e não devolve a senha', async () => {
  const nav = servidor.navegador();
  const dados = dadosCliente({ endereco: { cep: '01001-000', rua: 'Praça da Sé', numero: '1', cidade: 'São Paulo', uf: 'sp' } });
  const r = await nav.post('/api/cadastro', dados);
  assert.equal(r.status, 200);
  assert.equal(r.dados.email, dados.email);
  assert.equal(r.dados.telefone, '11987654321');
  assert.equal(r.dados.endereco.cep, '01001000');
  assert.equal(r.dados.endereco.uf, 'SP');
  assert.doesNotMatch(r.texto, /hash|salt/);
  assert.match(r.cabecalhos.getSetCookie()[0], /^sid=[0-9a-f]{64}; HttpOnly; SameSite=Lax; Path=\//);

  const site = await nav.get('/api/site');
  assert.equal(site.dados.cliente.email, dados.email);
  assert.equal(site.dados.admin, false);
});

test('cadastro recusa dados inválidos e e-mail repetido', async () => {
  const nav = servidor.navegador();
  assert.equal((await nav.post('/api/cadastro', dadosCliente({ email: 'sem-arroba' }))).status, 400);
  assert.equal((await nav.post('/api/cadastro', dadosCliente({ senha: 'curta' }))).status, 400);
  assert.equal((await nav.post('/api/cadastro', dadosCliente({ telefone: '123' }))).status, 400);
  const dados = dadosCliente();
  assert.equal((await nav.post('/api/cadastro', dados)).status, 200);
  assert.equal((await servidor.navegador().post('/api/cadastro', { ...dados, email: dados.email.toUpperCase() })).status, 409);
});

test('conta: login, edição de dados, troca de senha e sair', async (t) => {
  const dados = dadosCliente();
  await servidor.navegador().post('/api/cadastro', dados);
  const nav = servidor.navegador();

  await t.test('senha errada e conta inexistente dão a mesma resposta', async () => {
    const errada = await nav.post('/api/login', { usuario: dados.email, senha: 'senha-errada-1' });
    const inexistente = await nav.post('/api/login', { usuario: 'ninguem@exemplo.com', senha: 'senha-errada-1' });
    assert.equal(errada.status, 401);
    assert.equal(inexistente.status, 401);
    assert.deepEqual(errada.dados, inexistente.dados);
  });

  await t.test('login certo abre a sessão de cliente', async () => {
    const r = await nav.post('/api/login', { usuario: dados.email, senha: dados.senha });
    assert.equal(r.status, 200);
    assert.deepEqual(r.dados, { tipo: 'cliente' });
  });

  await t.test('cliente não acessa rotas da loja', async () => {
    assert.equal((await nav.get('/api/pedidos')).status, 401);
    assert.equal((await nav.get('/api/clientes')).status, 401);
    assert.equal((await nav.get('/api/dashboard')).status, 401);
    assert.equal((await nav.put('/api/loja', { nome: 'Invadida' })).status, 401);
    assert.equal((await nav.post('/api/doces', { nome: 'X', preco: 1 })).status, 401);
  });

  await t.test('edita os próprios dados', async () => {
    const r = await nav.put('/api/conta', { nome: 'Nome Novo', telefone: '(21) 3333-4444', endereco: {} });
    assert.equal(r.status, 200);
    assert.equal(r.dados.nome, 'Nome Novo');
    assert.equal(r.dados.telefone, '2133334444');
  });

  await t.test('troca de senha exige a senha atual', async () => {
    const base = { nome: 'Nome Novo', telefone: '2133334444', endereco: {} };
    assert.equal((await nav.put('/api/conta', { ...base, senhaAtual: 'nao-e-essa-1', novaSenha: 'outra-senha-9' })).status, 400);
    assert.equal((await nav.put('/api/conta', { ...base, senhaAtual: dados.senha, novaSenha: 'outra-senha-9' })).status, 200);
    assert.equal((await servidor.navegador().post('/api/login', { usuario: dados.email, senha: 'outra-senha-9' })).status, 200);
  });

  await t.test('sair encerra a sessão', async () => {
    assert.equal((await nav.post('/api/logout')).status, 200);
    assert.equal((await nav.get('/api/conta/pedidos')).status, 401);
    assert.equal((await nav.get('/api/site')).dados.cliente, null);
  });
});

test('rotas da conta exigem login', async () => {
  const nav = servidor.navegador();
  assert.equal((await nav.get('/api/conta/pedidos')).status, 401);
  assert.equal((await nav.put('/api/conta', { nome: 'A', telefone: '11999999999' })).status, 401);
});

test('esqueci minha senha: link de uso único, que derruba as sessões abertas', async () => {
  const dados = dadosCliente();
  const sessaoAntiga = servidor.navegador();
  await sessaoAntiga.post('/api/cadastro', dados);
  const nav = servidor.navegador();

  // Responde igual para e-mail que existe e que não existe.
  const existe = await nav.post('/api/senha/esqueci', { email: dados.email });
  const naoExiste = await nav.post('/api/senha/esqueci', { email: 'ninguem@exemplo.com' });
  assert.deepEqual(existe.dados, naoExiste.dados);

  // Sem SMTP e fora de produção, o link sai no terminal do servidor.
  const m = new RegExp(`${dados.email.replace(/[.+]/g, '\\$&')}:\\s+\\S+/redefinir-senha#([0-9a-f]{64})`).exec(servidor.saida());
  assert.ok(m, 'o link de redefinição deveria aparecer na saída do servidor');
  const token = m[1];

  assert.equal((await nav.post('/api/senha/redefinir', { token: 'f'.repeat(64), senha: 'nova-senha-123' })).status, 400);
  // Senha inválida não gasta o link.
  assert.equal((await nav.post('/api/senha/redefinir', { token, senha: 'curta' })).status, 400);
  assert.equal((await nav.post('/api/senha/redefinir', { token, senha: 'nova-senha-123' })).status, 200);
  assert.equal((await nav.post('/api/senha/redefinir', { token, senha: 'mais-uma-senha-1' })).status, 400);

  assert.equal((await sessaoAntiga.get('/api/conta/pedidos')).status, 401);
  assert.equal((await nav.post('/api/login', { usuario: dados.email, senha: dados.senha })).status, 401);
  assert.equal((await nav.post('/api/login', { usuario: dados.email, senha: 'nova-senha-123' })).status, 200);
});

test('login da loja usa o usuário "confeiteira"', async () => {
  const nav = servidor.navegador();
  assert.equal((await nav.post('/api/login', { usuario: 'confeiteira', senha: 'errada-errada' })).status, 401);
  const r = await nav.post('/api/login', { usuario: ' Confeiteira ', senha: SENHA_ADMIN });
  assert.deepEqual(r.dados, { tipo: 'admin' });
  assert.equal((await nav.get('/api/site')).dados.admin, true);
});
