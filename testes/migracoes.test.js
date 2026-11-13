'use strict';
// Sistema de migrações: banco novo, banco de instalação antiga, falha no meio e banco mais novo que o programa.

const { test, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { DatabaseSync } = require('node:sqlite');
const { aplicar, carregarMigracoes, versaoDe } = require('../migracoes');

let pasta, db;
const backups = () => path.join(pasta, 'backups');
const tabelas = (banco = db) => banco.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' ORDER BY name").all().map((l) => l.name);
const silencio = () => {};

beforeEach(() => {
  pasta = fs.mkdtempSync(path.join(os.tmpdir(), 'loja-migracao-'));
  db = new DatabaseSync(path.join(pasta, 'loja.db'));
  db.exec('PRAGMA foreign_keys = ON');
});
afterEach(() => {
  db.close();
  fs.rmSync(pasta, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
});

test('as migrações do projeto estão numeradas em sequência', () => {
  const lista = carregarMigracoes();
  assert.ok(lista.length >= 1);
  lista.forEach((m, i) => assert.equal(m.versao, i + 1));
});

test('banco novo: aplica tudo, sem cópia de segurança', () => {
  const r = aplicar(db, { pastaBackups: backups(), log: silencio });
  assert.equal(r.de, 0);
  assert.equal(r.para, carregarMigracoes().length);
  assert.equal(r.backup, null);
  assert.equal(versaoDe(db), r.para);
  for (const t of ['config', 'clientes', 'pedidos', 'pedido_itens']) assert.ok(tabelas().includes(t), t);
  assert.equal(fs.existsSync(backups()), false);
});

test('rodar de novo não faz nada', () => {
  aplicar(db, { pastaBackups: backups(), log: silencio });
  const r = aplicar(db, { pastaBackups: backups(), log: silencio });
  assert.equal(r.de, r.para);
  assert.equal(r.backup, null);
});

test('instalação antiga (sem número de versão): mantém os dados e guarda uma cópia antes', () => {
  // Banco como o servidor criava antes das migrações: tabelas prontas, user_version 0.
  carregarMigracoes()[0].subir(db);
  db.prepare("INSERT INTO config (chave, valor) VALUES ('loja', ?)").run(JSON.stringify({ nome: 'Loja Antiga' }));
  db.prepare("INSERT INTO doces (id, slug, nome, preco, unidade, emoji) VALUES ('d1', 'bolo', 'Bolo', 5000, 'unidade', '🎂')").run();
  assert.equal(versaoDe(db), 0);

  const r = aplicar(db, { pastaBackups: backups(), log: silencio });
  assert.equal(r.de, 0);
  assert.equal(versaoDe(db), carregarMigracoes().length);
  assert.equal(JSON.parse(db.prepare("SELECT valor FROM config WHERE chave = 'loja'").get().valor).nome, 'Loja Antiga');

  assert.ok(r.backup && fs.existsSync(r.backup));
  const copia = new DatabaseSync(r.backup, { readOnly: true });
  assert.equal(versaoDe(copia), 0);
  assert.equal(JSON.parse(copia.prepare("SELECT valor FROM config WHERE chave = 'loja'").get().valor).nome, 'Loja Antiga');
  copia.close();
});

test('migração que falha é desfeita por inteiro e o banco fica na versão anterior', () => {
  const migracoes = [
    { versao: 1, nome: '001-a.js', descricao: 'a', subir: (b) => b.exec('CREATE TABLE a (x TEXT) STRICT; INSERT INTO a VALUES (\'antes\')') },
    { versao: 2, nome: '002-b.js', descricao: 'b', subir: (b) => { b.exec("CREATE TABLE b (y TEXT) STRICT; UPDATE a SET x = 'depois'"); throw new Error('quebrou no meio'); } },
    { versao: 3, nome: '003-c.js', descricao: 'c', subir: (b) => b.exec('CREATE TABLE c (z TEXT) STRICT') },
  ];
  assert.throws(() => aplicar(db, { migracoes, log: silencio }), /002-b\.js falhou e foi desfeita.*versão 1.*quebrou no meio/s);
  assert.equal(versaoDe(db), 1);
  assert.deepEqual(tabelas(), ['a']);
  assert.equal(db.prepare('SELECT x FROM a').get().x, 'antes');
  assert.equal(db.prepare('PRAGMA foreign_keys').get().foreign_keys, 1, 'as chaves estrangeiras voltam a ficar ligadas');

  // Corrigida a migração, a próxima subida continua de onde parou.
  migracoes[1].subir = (b) => b.exec('CREATE TABLE b (y TEXT) STRICT');
  assert.equal(aplicar(db, { migracoes, log: silencio }).para, 3);
  assert.deepEqual(tabelas(), ['a', 'b', 'c']);
});

test('migração que deixa referência quebrada é desfeita', () => {
  const migracoes = [
    { versao: 1, nome: '001-a.js', subir: (b) => b.exec("CREATE TABLE pai (id TEXT PRIMARY KEY) STRICT; CREATE TABLE filho (pai_id TEXT REFERENCES pai(id)) STRICT; INSERT INTO pai VALUES ('p'); INSERT INTO filho VALUES ('p')") },
    { versao: 2, nome: '002-b.js', subir: (b) => b.exec('DELETE FROM pai') },
  ];
  assert.throws(() => aplicar(db, { migracoes, log: silencio }), /referência\(s\) quebrada\(s\)/);
  assert.equal(versaoDe(db), 1);
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM pai').get().n, 1);
});

test('banco mais novo que o programa: recusa subir em vez de arriscar os dados', () => {
  db.exec('PRAGMA user_version = 999');
  assert.throws(() => aplicar(db, { log: silencio }), /versão antiga do sistema com um banco mais novo/);
  assert.equal(versaoDe(db), 999);
});

test('migração 002: "doces" vira "produtos" sem perder nada, e a loja antiga mantém o vocabulário', () => {
  // Loja em funcionamento na estrutura antiga: um doce, um cliente e um pedido com dois itens (um de doce já apagado).
  carregarMigracoes()[0].subir(db);
  db.exec(`
    INSERT INTO config (chave, valor) VALUES ('admin', '{"usuario":"confeiteira"}');
    INSERT INTO doces (id, slug, nome, descricao, preco, unidade, emoji, imagem, disponivel)
      VALUES ('d1', 'bolo-de-fuba', 'Bolo de fubá', 'Fofinho', 4500, 'unidade', '🌽', '/uploads/d1-1.jpg', 0);
    INSERT INTO clientes (id, email, nome, telefone, salt, hash, criado_em) VALUES ('c1', 'a@b.com', 'Ana', '11999999999', 's', 'h', '2026-01-01T00:00:00.000Z');
    INSERT INTO pedidos (id, criado_em, cliente_id, cliente_nome, cliente_telefone, entrega_tipo, entrega_data, total, status)
      VALUES ('p1', '2026-01-02T10:00:00.000Z', 'c1', 'Ana', '11999999999', 'retirada', '2026-01-05', 9500, 'entregue');
    INSERT INTO pedido_itens (pedido_numero, doce_id, nome, preco_unit, quantidade) VALUES (1, 'd1', 'Bolo de fubá', 4500, 2), (1, 'apagado', 'Torta antiga', 500, 1);
  `);

  aplicar(db, { pastaBackups: backups(), log: silencio });

  assert.ok(!tabelas().includes('doces'));
  assert.deepEqual({ ...db.prepare('SELECT id, slug, nome, descricao, preco, unidade, emoji, imagem, disponivel FROM produtos').get() }, {
    id: 'd1', slug: 'bolo-de-fuba', nome: 'Bolo de fubá', descricao: 'Fofinho', preco: 4500, unidade: 'unidade', emoji: '🌽', imagem: '/uploads/d1-1.jpg', disponivel: 0,
  });
  assert.deepEqual(db.prepare('SELECT produto_id, nome, quantidade FROM pedido_itens ORDER BY rowid').all().map((l) => ({ ...l })), [
    { produto_id: 'd1', nome: 'Bolo de fubá', quantidade: 2 }, { produto_id: 'apagado', nome: 'Torta antiga', quantidade: 1 },
  ]);
  assert.equal(db.prepare('SELECT total FROM pedidos WHERE numero = 1').get().total, 9500);
  assert.throws(() => db.prepare("INSERT INTO produtos (id, slug, nome, preco, unidade, emoji) VALUES ('d2', 'bolo-de-fuba', 'X', 1, 'u', 'x')").run(), /UNIQUE/, 'o slug continua único');
  assert.deepEqual(JSON.parse(db.prepare("SELECT valor FROM config WHERE chave = 'catalogo'").get().valor), { nomeSingular: 'Doce', nomePlural: 'Doces', emojiPadrao: '🧁' });
});

test('migração 002: banco novo não recebe vocabulário de confeitaria', () => {
  aplicar(db, { log: silencio });
  assert.ok(tabelas().includes('produtos'));
  assert.equal(db.prepare("SELECT COUNT(*) AS n FROM config WHERE chave = 'catalogo'").get().n, 0);
});

test('migração 003: produtos que já existiam ficam sem categoria; apagar a categoria não apaga o produto', () => {
  const migracoes = carregarMigracoes();
  aplicar(db, { migracoes: migracoes.slice(0, 2), log: silencio });
  db.exec("INSERT INTO produtos (id, slug, nome, preco, unidade, emoji) VALUES ('p1', 'bolo', 'Bolo', 5000, 'unidade', '🎂')");

  aplicar(db, { migracoes, log: silencio });
  assert.equal(db.prepare("SELECT categoria_id FROM produtos WHERE id = 'p1'").get().categoria_id, null);

  db.exec("INSERT INTO categorias (id, nome, ordem) VALUES ('c1', 'Bolos', 1); UPDATE produtos SET categoria_id = 'c1'");
  assert.throws(() => db.exec("UPDATE produtos SET categoria_id = 'nao-existe'"), /FOREIGN KEY/);
  db.exec("DELETE FROM categorias WHERE id = 'c1'");
  assert.deepEqual({ ...db.prepare('SELECT nome, categoria_id FROM produtos').get() }, { nome: 'Bolo', categoria_id: null });
});

test('migração 004: produtos e pedidos antigos ficam sem estoque, variação e adicionais', () => {
  const migracoes = carregarMigracoes();
  aplicar(db, { migracoes: migracoes.slice(0, 3), log: silencio });
  db.exec(`
    INSERT INTO produtos (id, slug, nome, preco, unidade, emoji) VALUES ('p1', 'bolo', 'Bolo', 5000, 'unidade', '🎂');
    INSERT INTO pedidos (id, criado_em, cliente_nome, cliente_telefone, entrega_tipo, entrega_data, total, status)
      VALUES ('x1', '2026-01-02T10:00:00.000Z', 'Ana', '11999999999', 'retirada', '2026-01-05', 10000, 'novo');
    INSERT INTO pedido_itens (pedido_numero, produto_id, nome, preco_unit, quantidade) VALUES (1, 'p1', 'Bolo', 5000, 2);
  `);

  aplicar(db, { migracoes, log: silencio });
  assert.equal(db.prepare("SELECT estoque FROM produtos WHERE id = 'p1'").get().estoque, null);
  assert.deepEqual({ ...db.prepare('SELECT nome, preco_unit, quantidade, variacao_id, variacao, adicionais, estoque_situacao FROM pedido_itens').get() },
    { nome: 'Bolo', preco_unit: 5000, quantidade: 2, variacao_id: null, variacao: '', adicionais: '[]', estoque_situacao: 0 });

  // O banco não aceita estoque negativo, e apagar o produto leva as opções dele.
  db.exec("INSERT INTO produto_variacoes (id, produto_id, nome, preco, estoque, ordem) VALUES ('v1', 'p1', 'Grande', 8000, 2, 0)");
  db.exec("INSERT INTO produto_adicionais (id, produto_id, nome, preco, ordem) VALUES ('a1', 'p1', 'Calda', 300, 0)");
  assert.throws(() => db.exec("UPDATE produtos SET estoque = -1 WHERE id = 'p1'"), /CHECK/);
  assert.throws(() => db.exec("UPDATE produto_variacoes SET estoque = estoque - 3 WHERE id = 'v1'"), /CHECK/);
  db.exec("DELETE FROM produtos WHERE id = 'p1'");
  assert.equal(db.prepare('SELECT (SELECT COUNT(*) FROM produto_variacoes) + (SELECT COUNT(*) FROM produto_adicionais) AS n').get().n, 0);
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM pedido_itens').get().n, 1);
});

test('migração 005: a conta de acesso vira o primeiro Administrador, com o mesmo usuário e a mesma senha', () => {
  const migracoes = carregarMigracoes();
  aplicar(db, { migracoes: migracoes.slice(0, 4), log: silencio });
  db.prepare("INSERT INTO config (chave, valor) VALUES ('admin', ?)").run(JSON.stringify({ usuario: 'dona', salt: 'sal-antigo', hash: 'hash-antigo', senhaInicial: false }));
  db.prepare("INSERT INTO config (chave, valor) VALUES ('loja', ?)").run(JSON.stringify({ nome: 'Loja Antiga' }));

  aplicar(db, { migracoes: migracoes.slice(0, 5), log: silencio });
  const usuarios = db.prepare('SELECT u.usuario, u.salt, u.hash, u.ativo, u.senha_inicial, p.nome AS perfil, p.sistema FROM usuarios u JOIN perfis p ON p.id = u.perfil_id').all().map((l) => ({ ...l }));
  assert.deepEqual(usuarios, [{ usuario: 'dona', salt: 'sal-antigo', hash: 'hash-antigo', ativo: 1, senha_inicial: 0, perfil: 'Administrador', sistema: 1 }]);
  assert.equal(db.prepare("SELECT COUNT(*) AS n FROM config WHERE chave = 'admin'").get().n, 0, 'a senha não fica em dois lugares');
  assert.equal(JSON.parse(db.prepare("SELECT valor FROM config WHERE chave = 'loja'").get().valor).nome, 'Loja Antiga');
  assert.deepEqual(db.prepare('SELECT nome FROM perfis ORDER BY sistema DESC, nome').all().map((l) => l.nome), ['Administrador', 'Atendimento', 'Catálogo']);

  // O banco recusa o que não faz sentido: perfil em uso não é apagado; sessão tem um dono só.
  assert.throws(() => db.exec('DELETE FROM perfis WHERE sistema = 1'), /FOREIGN KEY/);
  assert.throws(() => db.exec("INSERT INTO sessoes (token_hash, tipo, criada_em, validade) VALUES ('h', 'usuario', 'agora', 1)"), /CHECK/);
  assert.throws(() => db.exec("INSERT INTO usuario_permissoes (usuario_id, permissao, efeito) SELECT id, 'x', 'talvez' FROM usuarios"), /CHECK/);
  // Apagar a pessoa leva as sessões e os ajustes dela.
  db.exec("INSERT INTO sessoes (token_hash, tipo, usuario_id, criada_em, validade) SELECT 'h', 'usuario', id, 'agora', 1 FROM usuarios");
  db.exec('DELETE FROM usuarios');
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM sessoes').get().n, 0);
});

test('migração 005: banco novo recebe os perfis de partida e nenhuma pessoa', () => {
  aplicar(db, { log: silencio });
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM perfis').get().n, 3);
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM usuarios').get().n, 0);
});

test('arquivos de migração fora de sequência são recusados', () => {
  const dir = path.join(pasta, 'm');
  fs.mkdirSync(dir);
  fs.writeFileSync(path.join(dir, '001-a.js'), 'exports.subir = () => {};');
  fs.writeFileSync(path.join(dir, '003-c.js'), 'exports.subir = () => {};');
  assert.throws(() => carregarMigracoes(dir), /fora de sequência/);
});
