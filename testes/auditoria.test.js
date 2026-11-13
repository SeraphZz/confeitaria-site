'use strict';
// Registro de atividades: tudo o que a equipe altera fica registrado, e o registro é só de inserção.

const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { DatabaseSync } = require('node:sqlite');
const { subirServidor, dadosCliente, hojeLocal, SENHA_ADMIN } = require('./apoio');

let servidor, dona, visitante;

before(async () => {
  servidor = await subirServidor();
  dona = servidor.navegador();
  await dona.entrarComoAdmin();
  visitante = servidor.navegador();
});
after(() => servidor.parar());

const registro = async (quem = dona, consulta = '') => (await quem.get(`/api/auditoria${consulta}`)).dados;
const ultimo = async () => (await registro()).itens[0];
const resumo = (a) => [a.usuario, a.acao, a.alvo];

test('entrar no painel fica registrado; clientes e visitantes não aparecem', async () => {
  const r = await registro();
  assert.deepEqual([r.total, r.pagina, r.paginas], [1, 1, 1]);
  assert.deepEqual(Object.keys(r.itens[0]).sort(), ['acao', 'alvo', 'detalhes', 'em', 'id', 'ip', 'nome', 'usuario']);
  assert.deepEqual(resumo(r.itens[0]), ['confeiteira', 'Entrou no painel', '']);
  assert.equal(r.itens[0].nome, 'Administrador');
  assert.match(r.itens[0].ip, /^10\./);
  assert.ok(Date.now() - Date.parse(r.itens[0].em) < 60_000);

  // Cliente se cadastrando, entrando e pedindo: nada disso é atividade da equipe.
  const dados = dadosCliente();
  const cliente = servidor.navegador();
  await cliente.post('/api/cadastro', dados);
  const [produto] = (await visitante.get('/api/produtos')).dados;
  await cliente.post('/api/pedidos', { cliente: { nome: dados.nome, telefone: dados.telefone }, entrega: { tipo: 'retirada', data: hojeLocal(1) }, itens: [{ produtoId: produto.id, quantidade: 1 }] });
  await cliente.put('/api/conta', { nome: 'Outro Nome', telefone: dados.telefone, endereco: {} });
  await cliente.post('/api/logout');
  await servidor.navegador().post('/api/login', { usuario: dados.email, senha: 'senha-errada-1' });
  assert.equal((await registro()).total, 1);
});

test('só quem tem a permissão lê o registro, e não existe rota para alterar ou apagar', async () => {
  assert.equal((await visitante.get('/api/auditoria')).status, 401);
  const atendimento = (await dona.get('/api/equipe')).dados.perfis.find((p) => p.nome === 'Atendimento');
  await dona.post('/api/usuarios', { usuario: 'maria', nome: 'Maria', perfilId: atendimento.id, senha: 'senha-da-maria-1' });
  const maria = servidor.navegador();
  await maria.post('/api/login', { usuario: 'maria', senha: 'senha-da-maria-1' });
  assert.equal((await maria.get('/api/auditoria')).status, 403);

  for (const metodo of ['post', 'put', 'patch', 'delete']) {
    assert.equal((await dona[metodo]('/api/auditoria')).status, 404, metodo);
    assert.equal((await dona[metodo]('/api/auditoria/1')).status, 404, metodo);
  }
});

test('cada alteração da equipe é registrada com quem fez, em quê e o que mudou', async () => {
  const antes = (await registro()).total;
  const [produto] = (await dona.get('/api/produtos')).dados;
  const [pedido] = (await dona.get('/api/pedidos')).dados.itens;

  await dona.patch(`/api/pedidos/${pedido.id}`, { status: 'confirmado' });
  assert.deepEqual([resumo(await ultimo()), (await ultimo()).detalhes], [['confeiteira', 'Alterou o status de um pedido', `Pedido nº ${pedido.numero}`], { de: 'Novo', para: 'Confirmado' }]);

  await dona.put(`/api/produtos/${produto.id}`, { preco: 990, disponivel: false });
  assert.deepEqual([resumo(await ultimo()), (await ultimo()).detalhes], [['confeiteira', 'Alterou um produto', produto.nome], { campos: ['preco', 'disponivel'], preco: 990, disponivel: false, estoque: null }]);

  const novo = (await dona.post('/api/produtos', { nome: 'Torta de limão', preco: 5000 })).dados;
  assert.deepEqual(resumo(await ultimo()), ['confeiteira', 'Criou um produto', 'Torta de limão']);
  await dona.delete(`/api/produtos/${novo.id}`);
  assert.deepEqual(resumo(await ultimo()), ['confeiteira', 'Excluiu um produto', 'Torta de limão']);

  const categoria = (await dona.post('/api/categorias', { nome: 'Tortas' })).dados;
  assert.deepEqual(resumo(await ultimo()), ['confeiteira', 'Criou uma categoria', 'Tortas']);
  await dona.delete(`/api/categorias/${categoria.id}`);
  assert.deepEqual(resumo(await ultimo()), ['confeiteira', 'Excluiu uma categoria', 'Tortas']);

  await dona.put('/api/configuracoes/modulos', { estoque: true });
  assert.deepEqual(resumo(await ultimo()), ['confeiteira', 'Alterou as configurações', 'modulos']);
  await dona.put('/api/loja', { nome: 'Loja Nova' });
  assert.deepEqual(resumo(await ultimo()), ['confeiteira', 'Alterou as configurações', 'loja']);
  await dona.put('/api/tema/rascunho', { corPrincipal: '#123456' });
  assert.equal((await ultimo()).acao, 'Alterou o rascunho da aparência');
  await dona.post('/api/tema/publicar', {});
  assert.equal((await ultimo()).acao, 'Publicou a aparência');

  assert.equal((await registro()).total, antes + 10);
});

test('o que foi recusado ou deu erro não entra como feito; leituras não são registradas', async () => {
  const antes = (await registro()).total;
  const [produto] = (await dona.get('/api/produtos')).dados;
  assert.equal((await dona.put(`/api/produtos/${produto.id}`, { preco: -5 })).status, 400);
  assert.equal((await dona.patch('/api/pedidos/00000000-0000-4000-8000-000000000000', { status: 'entregue' })).status, 404);
  assert.equal((await dona.put('/api/loja', { nome: '' })).status, 400);
  await dona.get('/api/pedidos');
  await dona.get('/api/equipe');
  await dona.get('/api/dashboard');
  assert.equal((await registro()).total, antes);
});

test('equipe: criar e alterar pessoas e perfis fica registrado, sem nenhuma senha', async () => {
  const equipe = (await dona.get('/api/equipe')).dados;
  const maria = equipe.usuarios.find((u) => u.usuario === 'maria');
  const catalogo = equipe.perfis.find((p) => p.nome === 'Catálogo');

  await dona.put(`/api/usuarios/${maria.id}`, { perfilId: catalogo.id, ajustes: { conceder: ['resumo.ver'], negar: [] }, senha: 'senha-secreta-987' });
  const alteracao = await ultimo();
  assert.deepEqual(resumo(alteracao), ['confeiteira', 'Alterou uma pessoa da equipe', 'maria']);
  assert.deepEqual(alteracao.detalhes, { nome: 'Maria', perfil: 'Catálogo', ativo: true, conceder: ['resumo.ver'], negar: [], senhaTrocada: true });

  const perfil = (await dona.post('/api/perfis', { nome: 'Vitrine', permissoes: ['aparencia.editar'] })).dados;
  assert.deepEqual([resumo(await ultimo()), (await ultimo()).detalhes], [['confeiteira', 'Criou um perfil', 'Vitrine'], { permissoes: ['aparencia.editar'] }]);
  await dona.put(`/api/perfis/${perfil.id}`, { permissoes: ['aparencia.editar', 'conteudo.editar'] });
  assert.deepEqual((await ultimo()).detalhes, { permissoes: ['conteudo.editar', 'aparencia.editar'] });
  await dona.delete(`/api/perfis/${perfil.id}`);
  assert.deepEqual(resumo(await ultimo()), ['confeiteira', 'Excluiu um perfil', 'Vitrine']);

  // Cada pessoa aparece com o próprio nome; trocar a própria senha, sair e entrar também ficam registrados.
  const nav = servidor.navegador();
  await nav.post('/api/login', { usuario: 'maria', senha: 'senha-secreta-987' });
  await nav.put('/api/senha', { atual: 'senha-secreta-987', nova: 'outra-senha-654' });
  await nav.post('/api/logout');
  assert.deepEqual((await registro()).itens.slice(0, 3).map(resumo), [
    ['maria', 'Saiu do painel', ''], ['maria', 'Trocou a própria senha', ''], ['maria', 'Entrou no painel', ''],
  ]);

  const tudo = JSON.stringify((await registro()).itens);
  assert.doesNotMatch(tudo, /senha-secreta|outra-senha|senha-da-maria|salt|hash/);
  assert.doesNotMatch(tudo, new RegExp(SENHA_ADMIN));
});

test('tentativa de entrar em conta da equipe com senha errada, ou desativada, fica registrada', async () => {
  const maria = (await dona.get('/api/equipe')).dados.usuarios.find((u) => u.usuario === 'maria');
  await servidor.navegador().post('/api/login', { usuario: 'maria', senha: 'chute-errado-1' });
  assert.deepEqual([resumo(await ultimo()), (await ultimo()).detalhes], [['maria', 'Tentativa de entrar no painel recusada', ''], { motivo: 'senha errada' }]);

  await dona.put(`/api/usuarios/${maria.id}`, { ativo: false });
  await servidor.navegador().post('/api/login', { usuario: 'maria', senha: 'outra-senha-654' });
  assert.deepEqual((await ultimo()).detalhes, { motivo: 'conta desativada' });
  // Usuário que não existe não gera registro (não há conta a que atribuir).
  const antes = (await registro()).total;
  await servidor.navegador().post('/api/login', { usuario: 'fantasma', senha: 'chute-errado-1' });
  assert.equal((await registro()).total, antes);
});

test('o banco recusa alterar ou apagar o registro, e o servidor continua registrando', async () => {
  const db = new DatabaseSync(path.join(servidor.pasta, 'loja.db'));
  try {
  db.exec('PRAGMA busy_timeout = 5000');
  const quantos = () => db.prepare('SELECT COUNT(*) AS n FROM auditoria').get().n;
  const antes = quantos();
  assert.throws(() => db.exec("UPDATE auditoria SET usuario_login = 'outra-pessoa'"), /não pode ser alterado/);
  assert.throws(() => db.exec("UPDATE auditoria SET acao = 'Nada' WHERE id = 1"), /não pode ser alterado/);
  assert.throws(() => db.exec('DELETE FROM auditoria'), /não pode ser apagado/);
  assert.throws(() => db.exec('DELETE FROM auditoria WHERE id = 1'), /não pode ser apagado/);
  assert.throws(() => db.exec("INSERT OR REPLACE INTO auditoria (id, em, usuario_login, usuario_nome, acao) VALUES (1, 'x', 'x', 'x', 'x')"), /não pode ser alterado/);
  assert.throws(() => db.exec("INSERT INTO auditoria (id, em, usuario_login, usuario_nome, acao) VALUES (1, 'x', 'x', 'x', 'x')"), /não pode ser alterado|UNIQUE/);
  assert.equal(quantos(), antes);
  assert.equal(db.prepare('SELECT usuario_login FROM auditoria WHERE id = 1').get().usuario_login, 'confeiteira');
  } finally {
    db.close(); // mesmo se uma conferência falhar: arquivo aberto impede apagar a pasta do teste no Windows
  }

  // Desativar ou mudar uma pessoa não mexe no que ela já fez: o registro guarda o nome da época.
  const total = (await registro()).total;
  const equipe = (await dona.get('/api/equipe')).dados;
  await dona.put(`/api/usuarios/${equipe.usuarios.find((u) => u.usuario === 'maria').id}`, { nome: 'Maria de Souza' });
  const r = await registro();
  assert.equal(r.total, total + 1);
  assert.ok(r.itens.some((a) => a.usuario === 'maria' && a.nome === 'Maria'));
});

test('paginação do registro: 50 por página, do mais recente para o mais antigo', async () => {
  const antes = (await registro()).total;
  for (let i = antes; i < 55; i++) await dona.put('/api/loja', { nome: `Loja ${i}` });
  const p1 = await registro();
  assert.deepEqual([p1.itens.length, p1.total, p1.paginas], [50, 55, 2]);
  assert.ok(p1.itens.every((a, i) => i === 0 || a.id < p1.itens[i - 1].id));
  const p2 = await registro(dona, '?pagina=2');
  assert.deepEqual([p2.itens.length, p2.itens.at(-1).acao], [5, 'Entrou no painel']);
});
