'use strict';
// Equipe da loja: pessoas, perfis, permissões por rota, ajustes individuais e sessões guardadas no banco.

const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
const path = require('node:path');
const { DatabaseSync } = require('node:sqlite');
const { subirServidor, SENHA_ADMIN, dadosCliente } = require('./apoio');

const RAIZ = path.join(__dirname, '..');
const TODAS = ['resumo.ver', 'pedidos.ver', 'pedidos.alterar', 'clientes.ver', 'produtos.editar', 'conteudo.editar',
  'aparencia.editar', 'configuracoes.editar', 'usuarios.gerenciar', 'auditoria.ver'];
const SENHA = 'senha-da-equipe-1';

let servidor, dona, visitante, perfis;

before(async () => {
  servidor = await subirServidor();
  dona = servidor.navegador();
  await dona.entrarComoAdmin();
  visitante = servidor.navegador();
});
after(() => servidor.parar());

const equipe = async (quem = dona) => (await quem.get('/api/equipe')).dados;
const perfil = async (nome) => (await equipe()).perfis.find((p) => p.nome === nome);
const pessoa = async (login) => (await equipe()).usuarios.find((u) => u.usuario === login);
async function criar(login, perfilNome, extra = {}) {
  const r = await dona.post('/api/usuarios', { usuario: login, nome: `Pessoa ${login}`, perfilId: (await perfil(perfilNome)).id, senha: SENHA, ...extra });
  assert.equal(r.status, 200, JSON.stringify(r.dados));
  return r.dados;
}
async function entrar(login, senha = SENHA) {
  const nav = servidor.navegador();
  const r = await nav.post('/api/login', { usuario: login, senha });
  return Object.assign(nav, { login: r });
}

test('a conta inicial é a primeira pessoa da equipe, com o perfil Administrador e todas as permissões', async () => {
  const site = (await dona.get('/api/site')).dados;
  assert.equal(site.admin, true);
  assert.deepEqual(site.usuario, { nome: 'Administrador', usuario: 'confeiteira', permissoes: TODAS, senhaInicial: true });

  const dados = await equipe();
  perfis = dados.perfis;
  assert.deepEqual(dados.perfis.map((p) => [p.nome, p.sistema, p.pessoas]), [['Administrador', true, 1], ['Atendimento', false, 0], ['Catálogo', false, 0]]);
  assert.deepEqual(dados.perfis[0].permissoes, TODAS);
  assert.deepEqual(dados.permissoes.map((p) => p.id), TODAS);
  assert.deepEqual(dados.minhas, TODAS);
  assert.equal(dados.usuarios.length, 1);
  assert.deepEqual([dados.usuarios[0].usuario, dados.usuarios[0].voce, dados.usuarios[0].gerenciavel], ['confeiteira', true, false]);
  assert.doesNotMatch(JSON.stringify(dados), /salt|hash/);
});

test('visitante e cliente não chegam à equipe', async () => {
  const cliente = servidor.navegador();
  await cliente.post('/api/cadastro', dadosCliente());
  for (const nav of [visitante, cliente]) {
    assert.equal((await nav.get('/api/equipe')).status, 401);
    assert.equal((await nav.post('/api/usuarios', { usuario: 'intruso', nome: 'X', perfilId: perfis[0].id, senha: SENHA })).status, 401);
    assert.equal((await nav.post('/api/perfis', { nome: 'X', permissoes: [] })).status, 401);
    assert.equal((await nav.put(`/api/perfis/${perfis[1].id}`, { permissoes: TODAS })).status, 401);
  }
});

test('criar pessoa: valida usuário, nome, senha e perfil', async () => {
  const base = { usuario: 'maria', nome: 'Maria', perfilId: perfis[1].id, senha: SENHA };
  for (const [campo, valor] of [
    ['usuario', ''], ['usuario', 'ab'], ['usuario', 'maria@loja.com'], ['usuario', 'com espaço'], ['usuario', 'ação'], ['usuario', 'x'.repeat(31)],
    ['usuario', 'confeiteira'], ['usuario', 'CONFEITEIRA'], ['nome', ''], ['senha', 'curta'], ['senha', undefined],
    ['perfilId', 'nao-existe'], ['perfilId', undefined], ['perfilId', 7],
  ]) {
    const r = await dona.post('/api/usuarios', { ...base, [campo]: valor });
    assert.ok([400, 404, 409].includes(r.status), `${campo}=${valor}: ${r.status}`);
  }
  assert.equal((await equipe()).usuarios.length, 1);

  const r = await dona.post('/api/usuarios', { ...base, usuario: ' Maria.Silva ' });
  assert.equal(r.status, 200);
  assert.deepEqual([r.dados.usuario, r.dados.nome, r.dados.ativo, r.dados.senhaInicial, r.dados.gerenciavel], ['maria.silva', 'Maria', true, true, true]);
  assert.deepEqual(r.dados.permissoes, ['pedidos.ver', 'pedidos.alterar', 'clientes.ver']);
  assert.doesNotMatch(JSON.stringify(r.dados), /salt|hash|senha-da-equipe/);
});

test('cada rota exige a sua permissão: 403 para quem é da equipe e não tem; 401 para quem não entrou', async () => {
  const maria = await entrar('maria.silva'); // Atendimento: pedidos e clientes
  assert.deepEqual(maria.login.dados, { tipo: 'admin' });
  const site = (await maria.get('/api/site')).dados;
  assert.deepEqual([site.admin, site.usuario.permissoes, site.usuario.senhaInicial], [true, ['pedidos.ver', 'pedidos.alterar', 'clientes.ver'], true]);

  const [produto] = (await dona.get('/api/produtos')).dados;
  const rotas = [
    ['resumo.ver', 'get', '/api/dashboard'],
    ['pedidos.ver', 'get', '/api/pedidos'],
    ['pedidos.alterar', 'patch', '/api/pedidos/00000000-0000-4000-8000-000000000000', { status: 'entregue' }],
    ['clientes.ver', 'get', '/api/clientes'],
    ['produtos.editar', 'post', '/api/produtos', { nome: 'Feito sem permissão', preco: 100 }],
    ['produtos.editar', 'put', `/api/produtos/${produto.id}`, { preco: 1 }],
    ['produtos.editar', 'delete', `/api/produtos/${produto.id}`],
    ['produtos.editar', 'put', `/api/produtos/${produto.id}/imagem`, { imagem: '' }],
    ['produtos.editar', 'post', '/api/categorias', { nome: 'Sem permissão' }],
    ['conteudo.editar', 'put', '/api/sobre', { titulo: 'Invadida', texto: '', trajetoria: [] }],
    ['conteudo.editar', 'put', '/api/configuracoes/sobre', { titulo: 'Invadida', texto: '', trajetoria: [] }],
    ['conteudo.editar', 'put', '/api/sobre/imagem', { imagem: '' }],
    ['aparencia.editar', 'get', '/api/tema'],
    ['aparencia.editar', 'put', '/api/tema/rascunho', { corPrincipal: '#000000' }],
    ['aparencia.editar', 'post', '/api/tema/publicar', {}],
    ['aparencia.editar', 'delete', '/api/tema/rascunho'],
    ['configuracoes.editar', 'get', '/api/configuracoes'],
    ['configuracoes.editar', 'put', '/api/loja', { nome: 'Invadida' }],
    ['configuracoes.editar', 'put', '/api/configuracoes/modulos', { estoque: true }],
    ['configuracoes.editar', 'put', '/api/configuracoes/operacao', { fusoHorario: 'America/Manaus' }],
    ['usuarios.gerenciar', 'get', '/api/equipe'],
    ['usuarios.gerenciar', 'post', '/api/usuarios', { usuario: 'comparsa', nome: 'X', perfilId: perfis[0].id, senha: SENHA }],
    ['usuarios.gerenciar', 'post', '/api/perfis', { nome: 'Meu perfil', permissoes: TODAS }],
    ['usuarios.gerenciar', 'put', `/api/perfis/${perfis[1].id}`, { permissoes: TODAS }],
    ['usuarios.gerenciar', 'delete', `/api/perfis/${perfis[2].id}`],
  ];
  const tem = new Set(site.usuario.permissoes);
  for (const [permissao, metodo, caminho, corpo] of rotas) {
    const chamar = (nav) => (corpo === undefined ? nav[metodo](caminho) : nav[metodo](caminho, corpo));
    assert.equal((await chamar(visitante)).status, 401, `visitante ${metodo} ${caminho}`);
    const r = await chamar(maria);
    if (tem.has(permissao)) assert.notEqual(r.status, 403, `${metodo} ${caminho}`);
    else assert.equal(r.status, 403, `${metodo} ${caminho} deveria exigir ${permissao}`);
  }
  // Nada do que foi recusado aconteceu.
  assert.equal((await visitante.get('/api/site')).dados.loja.nome === 'Invadida', false);
  assert.equal((await visitante.get('/api/site')).dados.modulos.estoque, false);
  assert.equal((await dona.get('/api/produtos')).dados.find((p) => p.id === produto.id).preco, produto.preco);
  assert.equal((await equipe()).perfis.length, 3);
});

test('quem é da equipe vê produtos ocultos; a prévia da aparência é só de quem cuida dela', async () => {
  const [produto] = (await dona.get('/api/produtos')).dados;
  await dona.put(`/api/produtos/${produto.id}`, { disponivel: false });
  await dona.put('/api/tema/rascunho', { corPrincipal: '#123456' });
  const maria = await entrar('maria.silva');
  assert.ok((await maria.get('/api/produtos')).dados.some((p) => p.id === produto.id));
  assert.ok(!(await visitante.get('/api/produtos')).dados.some((p) => p.id === produto.id));
  assert.equal((await maria.get('/api/site')).dados.previaTema, false);
  assert.doesNotMatch((await maria.get('/tema.css')).texto, /#123456/);
  assert.equal((await dona.get('/api/site')).dados.previaTema, true);
  assert.match((await dona.get('/tema.css')).texto, /#123456/);
  await dona.delete('/api/tema/rascunho');
  await dona.put(`/api/produtos/${produto.id}`, { disponivel: true });
});

test('ajustes individuais: liberar soma ao perfil, bloquear tira; valem na hora, sem novo login', async () => {
  const maria = await entrar('maria.silva');
  const { id } = await pessoa('maria.silva');
  assert.equal((await maria.get('/api/dashboard')).status, 403);
  assert.equal((await maria.get('/api/clientes')).status, 200);

  const r = await dona.put(`/api/usuarios/${id}`, { ajustes: { conceder: ['resumo.ver'], negar: ['clientes.ver'] } });
  assert.deepEqual(r.dados.permissoes, ['resumo.ver', 'pedidos.ver', 'pedidos.alterar']);
  assert.deepEqual(r.dados.ajustes, { conceder: ['resumo.ver'], negar: ['clientes.ver'] });
  assert.equal((await maria.get('/api/dashboard')).status, 200);
  assert.equal((await maria.get('/api/clientes')).status, 403);

  for (const ajustes of [{ conceder: ['inventada'] }, { conceder: 'resumo.ver' }, { conceder: ['resumo.ver'], negar: ['resumo.ver'] }, { negar: [7] }]) {
    assert.equal((await dona.put(`/api/usuarios/${id}`, { ajustes })).status, 400, JSON.stringify(ajustes));
  }
  // Mudar o perfil também vale na hora; os ajustes continuam.
  await dona.put(`/api/usuarios/${id}`, { perfilId: (await perfil('Catálogo')).id });
  assert.equal((await maria.get('/api/pedidos')).status, 403);
  assert.equal((await maria.post('/api/categorias', { nome: 'Da Maria' })).status, 200);
  assert.equal((await maria.get('/api/dashboard')).status, 200);
  await dona.put(`/api/usuarios/${id}`, { perfilId: (await perfil('Atendimento')).id, ajustes: {} });
  assert.deepEqual((await pessoa('maria.silva')).permissoes, ['pedidos.ver', 'pedidos.alterar', 'clientes.ver']);
});

test('perfis: criar, alterar, excluir; o Administrador é fixo; perfil em uso não é excluído', async () => {
  for (const corpo of [{ nome: '', permissoes: [] }, { nome: 'Atendimento', permissoes: [] }, { nome: 'ATENDIMENTO', permissoes: [] },
    { nome: 'Novo', permissoes: ['inventada'] }, { nome: 'Novo', permissoes: 'todas' }, { nome: 'Novo' }, { nome: 'x'.repeat(41), permissoes: [] }]) {
    assert.ok([400, 409].includes((await dona.post('/api/perfis', corpo)).status), JSON.stringify(corpo));
  }
  const r = await dona.post('/api/perfis', { nome: ' Gerência ', permissoes: ['usuarios.gerenciar', 'pedidos.ver', 'pedidos.ver', 'resumo.ver'] });
  assert.equal(r.status, 200);
  assert.deepEqual([r.dados.nome, r.dados.permissoes, r.dados.sistema, r.dados.pessoas], ['Gerência', ['resumo.ver', 'pedidos.ver', 'usuarios.gerenciar'], false, 0]);

  const alterado = await dona.put(`/api/perfis/${r.dados.id}`, { nome: 'Gerente', permissoes: ['usuarios.gerenciar', 'pedidos.ver', 'pedidos.alterar', 'clientes.ver'] });
  assert.deepEqual([alterado.dados.nome, alterado.dados.permissoes.length], ['Gerente', 4]);
  assert.equal((await dona.put(`/api/perfis/${r.dados.id}`, { nome: 'Catálogo' })).status, 409);

  const administrador = await perfil('Administrador');
  assert.equal((await dona.put(`/api/perfis/${administrador.id}`, { permissoes: [] })).status, 400);
  assert.equal((await dona.put(`/api/perfis/${administrador.id}`, { nome: 'Outro nome' })).status, 400);
  assert.equal((await dona.delete(`/api/perfis/${administrador.id}`)).status, 400);
  assert.deepEqual((await perfil('Administrador')).permissoes, TODAS);

  const atendimento = await perfil('Atendimento'); // a Maria está nele
  assert.equal((await dona.delete(`/api/perfis/${atendimento.id}`)).status, 409);
  const sobrando = (await dona.post('/api/perfis', { nome: 'Sobrando', permissoes: [] })).dados;
  assert.equal((await dona.delete(`/api/perfis/${sobrando.id}`)).status, 200);
  assert.equal((await dona.delete(`/api/perfis/${sobrando.id}`)).status, 404);
});

test('ninguém concede o que não possui, nem mexe em quem pode mais', async () => {
  await criar('gerente', 'Gerente'); // usuarios.gerenciar + pedidos + clientes; sem catálogo, sem resumo
  const gerente = await entrar('gerente');
  const dados = await equipe(gerente);
  const doGerente = ['pedidos.ver', 'pedidos.alterar', 'clientes.ver', 'usuarios.gerenciar'];
  assert.deepEqual(dados.minhas, doGerente);
  // A tela já recebe o que ele pode ou não tocar.
  assert.deepEqual(Object.fromEntries(dados.perfis.map((p) => [p.nome, [p.atribuivel, p.gerenciavel]])),
    { Administrador: [false, false], Atendimento: [true, true], Catálogo: [false, false], Gerente: [true, true] });
  assert.deepEqual(Object.fromEntries(dados.usuarios.map((u) => [u.usuario, u.gerenciavel])),
    { confeiteira: false, gerente: false, 'maria.silva': true });

  const id = (nome) => dados.perfis.find((p) => p.nome === nome).id;
  const novo = (extra) => gerente.post('/api/usuarios', { usuario: `novo${Math.random().toString(36).slice(2, 8)}`, nome: 'Novo', senha: SENHA, perfilId: id('Atendimento'), ...extra });

  // Dar um perfil com mais do que ele tem, ou liberar individualmente o que ele não tem.
  assert.equal((await novo({ perfilId: id('Administrador') })).status, 403);
  assert.equal((await novo({ perfilId: id('Catálogo') })).status, 403);
  assert.equal((await novo({ ajustes: { conceder: ['resumo.ver'] } })).status, 403);
  assert.equal((await novo({ ajustes: { conceder: ['resumo.ver'], negar: [] } })).status, 403);
  // Colocar em um perfil (novo ou existente) permissões que ele não tem.
  assert.equal((await gerente.post('/api/perfis', { nome: 'Atalho', permissoes: ['configuracoes.editar'] })).status, 403);
  assert.equal((await gerente.put(`/api/perfis/${id('Atendimento')}`, { permissoes: ['pedidos.ver', 'produtos.editar'] })).status, 403);
  assert.equal((await gerente.put(`/api/perfis/${id('Gerente')}`, { permissoes: TODAS })).status, 403);
  // Mexer (até para tirar) em perfil ou pessoa que pode mais do que ele.
  assert.equal((await gerente.put(`/api/perfis/${id('Catálogo')}`, { permissoes: [] })).status, 403);
  assert.equal((await gerente.delete(`/api/perfis/${id('Catálogo')}`)).status, 403);
  const dona1 = dados.usuarios.find((u) => u.usuario === 'confeiteira');
  for (const corpo of [{ senha: 'tomei-a-conta-1' }, { ativo: false }, { perfilId: id('Atendimento') }, { nome: 'Rebaixada' }]) {
    assert.equal((await gerente.put(`/api/usuarios/${dona1.id}`, corpo)).status, 403, JSON.stringify(corpo));
  }
  assert.equal((await servidor.navegador().post('/api/login', { usuario: 'confeiteira', senha: SENHA_ADMIN })).status, 200, 'a senha da dona não mudou');

  // Dentro do que possui, ele gerencia normalmente.
  const ok = await novo({ usuario: 'joao', ajustes: { negar: ['clientes.ver'] } });
  assert.equal(ok.status, 200);
  assert.deepEqual(ok.dados.permissoes, ['pedidos.ver', 'pedidos.alterar']);
  assert.equal((await gerente.put(`/api/perfis/${id('Atendimento')}`, { permissoes: ['pedidos.ver', 'clientes.ver'] })).status, 200);
  assert.equal((await gerente.post('/api/perfis', { nome: 'Só leitura', permissoes: ['pedidos.ver'] })).status, 200);
  await dona.put(`/api/perfis/${id('Atendimento')}`, { permissoes: ['pedidos.ver', 'pedidos.alterar', 'clientes.ver'] });

  // E as checagens valem para o estado final: nada acima ficou gravado.
  const depois = await equipe();
  assert.deepEqual((await perfil('Catálogo')).permissoes, ['produtos.editar', 'conteudo.editar']);
  assert.ok(!depois.perfis.some((p) => p.nome === 'Atalho'));
  assert.deepEqual(depois.usuarios.find((u) => u.usuario === 'confeiteira').permissoes, TODAS);
});

test('ninguém altera o próprio acesso; a loja nunca fica sem Administrador ativo', async () => {
  const eu = await pessoa('confeiteira');
  for (const corpo of [{ ativo: false }, { perfilId: (await perfil('Atendimento')).id }, { ajustes: { negar: ['usuarios.gerenciar'] } }, { senha: 'outra-senha-123' }]) {
    assert.equal((await dona.put(`/api/usuarios/${eu.id}`, corpo)).status, 400, JSON.stringify(corpo));
  }
  assert.equal((await dona.put(`/api/usuarios/${eu.id}`, { nome: 'Dona da Loja' })).status, 200); // o próprio nome pode

  // Com uma segunda Administradora, uma pode desativar a outra, mas não as duas.
  const socia = await criar('socia', 'Administrador', { ajustes: { negar: ['resumo.ver'] } });
  assert.deepEqual([socia.permissoes, socia.ajustes], [TODAS, { conceder: [], negar: [] }], 'Administrador não tem ajustes');
  const navSocia = await entrar('socia');
  assert.equal((await navSocia.put(`/api/usuarios/${eu.id}`, { ativo: false })).status, 200);
  assert.equal((await dona.get('/api/equipe')).status, 401, 'desativada, sai na hora');
  assert.equal((await servidor.navegador().post('/api/login', { usuario: 'confeiteira', senha: SENHA_ADMIN })).status, 401);
  // A última Administradora ativa não consegue sair do perfil nem por outra pessoa: não existe outra com poder para isso.
  const gerente = await entrar('gerente');
  assert.equal((await gerente.put(`/api/usuarios/${socia.id}`, { ativo: false })).status, 403);
  assert.equal((await navSocia.put(`/api/usuarios/${eu.id}`, { ativo: true })).status, 200);
  await dona.entrarComoAdmin();
  assert.equal((await dona.get('/api/equipe')).status, 200);
});

test('senha definida por outra pessoa: derruba as sessões, avisa para trocar; a própria troca limpa o aviso', async () => {
  const joao = await entrar('joao');
  assert.equal((await joao.get('/api/pedidos')).status, 200);
  const { id } = await pessoa('joao');
  assert.equal((await dona.put(`/api/usuarios/${id}`, { senha: 'curta' })).status, 400);
  assert.equal((await joao.get('/api/pedidos')).status, 200);

  assert.equal((await dona.put(`/api/usuarios/${id}`, { senha: 'senha-nova-do-joao' })).status, 200);
  assert.equal((await joao.get('/api/pedidos')).status, 401);
  assert.equal((await entrar('joao', SENHA)).login.status, 401);
  const denovo = await entrar('joao', 'senha-nova-do-joao');
  assert.equal((await denovo.get('/api/site')).dados.usuario.senhaInicial, true);

  // Qualquer pessoa da equipe troca a própria senha, mesmo sem nenhuma outra permissão de configuração.
  const outraAba = await entrar('joao', 'senha-nova-do-joao');
  assert.equal((await denovo.put('/api/senha', { atual: 'errada', nova: 'minha-senha-de-verdade' })).status, 400);
  assert.equal((await denovo.put('/api/senha', { atual: 'senha-nova-do-joao', nova: 'minha-senha-de-verdade' })).status, 200);
  assert.equal((await denovo.get('/api/site')).dados.usuario.senhaInicial, false);
  assert.equal((await outraAba.get('/api/pedidos')).status, 401, 'as outras sessões dele caem');
  assert.equal((await denovo.get('/api/pedidos')).status, 200);
  // A senha de um não mexe na de outro.
  assert.equal((await entrar('gerente')).login.status, 200);
});

test('desativar: a pessoa sai na hora e não entra mais; reativar devolve o acesso', async () => {
  const joao = await entrar('joao', 'minha-senha-de-verdade');
  const { id } = await pessoa('joao');
  const r = await dona.put(`/api/usuarios/${id}`, { ativo: false });
  assert.equal(r.dados.ativo, false);
  assert.equal((await joao.get('/api/pedidos')).status, 401);
  assert.equal((await joao.get('/api/site')).dados.admin, false);
  const tentativa = await entrar('joao', 'minha-senha-de-verdade');
  assert.equal(tentativa.login.status, 401);
  assert.equal(tentativa.login.dados.erro, 'E-mail/usuário ou senha incorretos.', 'mesma resposta de senha errada');
  await dona.put(`/api/usuarios/${id}`, { ativo: true });
  assert.equal((await entrar('joao', 'minha-senha-de-verdade')).login.status, 200);
});

test('sessões ficam no banco, só com o hash do token, e sobrevivem a reiniciar o servidor', async () => {
  const cookie = dona.cookie();
  assert.match(cookie, /^sid=[0-9a-f]{64}$/);
  const token = cookie.slice(4);
  const db = new DatabaseSync(path.join(servidor.pasta, 'loja.db'), { readOnly: true });
  const linhas = db.prepare('SELECT token_hash, tipo FROM sessoes').all();
  db.close();
  assert.ok(linhas.length >= 2);
  assert.ok(linhas.every((l) => l.token_hash !== token && /^[0-9a-f]{64}$/.test(l.token_hash)), 'o token do cookie não está no banco');

  // Outro servidor sobre a mesma pasta de dados (como depois de um reinício): o mesmo cookie continua valendo.
  const outro = await subirServidor({ DATA_DIR: servidor.pasta });
  try {
    const r = await fetch(`${outro.url}/api/equipe`, { headers: { Cookie: cookie } });
    assert.equal(r.status, 200);
    // Sair apaga a sessão do banco: o cookie antigo deixa de valer nos dois.
    assert.equal((await dona.post('/api/logout')).status, 200);
    assert.equal((await fetch(`${outro.url}/api/equipe`, { headers: { Cookie: cookie } })).status, 401);
  } finally {
    await outro.parar(); // apaga só a pasta temporária dele (que nem foi usada), não a do servidor principal
  }
  await dona.entrarComoAdmin();
});

test('cookie inventado ou de sessão vencida não vale', async () => {
  for (const sid of ['a'.repeat(64), 'x', '../../etc', "' OR 1=1 --"]) {
    assert.equal((await visitante.get('/api/equipe', { Cookie: `sid=${sid}` })).status, 401, sid);
  }
  const nav = await entrar('gerente');
  const db = new DatabaseSync(path.join(servidor.pasta, 'loja.db'));
  db.exec('PRAGMA busy_timeout = 5000');
  db.prepare('UPDATE sessoes SET validade = ? WHERE usuario_id = (SELECT id FROM usuarios WHERE usuario = ?)').run(Date.now() - 1000, 'gerente');
  db.close();
  assert.equal((await nav.get('/api/equipe')).status, 401);
});

test('script de senha: redefine a do Administrador (ou de quem for indicado), reativa e desloga', async () => {
  const rodar = (...args) => spawnSync(process.execPath, ['scripts/senha-admin.js', ...args], { cwd: RAIZ, encoding: 'utf8', env: { ...process.env, DATA_DIR: servidor.pasta } });
  const { id } = await pessoa('joao');
  await dona.put(`/api/usuarios/${id}`, { ativo: false });

  const r = rodar('senha-pelo-script-1', '--usuario', 'joao');
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /Usuário: joao/);
  const joao = await entrar('joao', 'senha-pelo-script-1');
  assert.equal(joao.login.status, 200);
  assert.equal((await joao.get('/api/site')).dados.usuario.senhaInicial, false);

  const sorteada = rodar();
  assert.equal(sorteada.status, 0, sorteada.stderr);
  const [, login, senha] = /Usuário: (\S+)\s+Senha:\s+(\S+)/.exec(sorteada.stdout);
  assert.ok(['confeiteira', 'socia'].includes(login));
  const nav = await entrar(login, senha);
  assert.equal(nav.login.status, 200);
  assert.equal((await nav.get('/api/site')).dados.usuario.senhaInicial, true);

  assert.equal(rodar('--usuario', 'ninguem').status, 1);
  assert.equal(rodar('curta').status, 1);
  assert.equal(rodar('--apagar').status, 1);
});
