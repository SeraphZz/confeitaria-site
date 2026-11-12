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

test('arquivos de migração fora de sequência são recusados', () => {
  const dir = path.join(pasta, 'm');
  fs.mkdirSync(dir);
  fs.writeFileSync(path.join(dir, '001-a.js'), 'exports.subir = () => {};');
  fs.writeFileSync(path.join(dir, '003-c.js'), 'exports.subir = () => {};');
  assert.throws(() => carregarMigracoes(dir), /fora de sequência/);
});
