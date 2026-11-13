'use strict';
// scripts/backup.js: a cópia leva o banco e as fotos, e a rotação só apaga cópias antigas feitas pelo próprio script.

const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');
const { DatabaseSync } = require('node:sqlite');
const { subirServidor, PNG_1X1 } = require('./apoio');

const RAIZ = path.join(__dirname, '..');
let servidor, backups;

function rodar(args = [], env = {}) {
  const r = spawnSync(process.execPath, ['scripts/backup.js', ...args], {
    cwd: RAIZ, encoding: 'utf8', env: { ...process.env, DATA_DIR: servidor.pasta, BACKUP_MANTER: '', ...env },
  });
  return { codigo: r.status, saida: r.stdout + r.stderr };
}
const copias = (pasta = backups) => fs.readdirSync(pasta).filter((nome) => /^loja-/.test(nome)).sort();
const NOVA = /^loja-\d{4}-\d{2}-\d{2}-\d{6}$/;

before(async () => {
  servidor = await subirServidor();
  backups = path.join(servidor.pasta, 'backups');
  // Uma foto de produto, para existir o que copiar em uploads/.
  const loja = servidor.navegador();
  await loja.entrarComoAdmin();
  const [produto] = (await loja.get('/api/produtos')).dados;
  assert.equal((await loja.put(`/api/produtos/${produto.id}/imagem`, { imagem: PNG_1X1 })).status, 200);
});
after(() => servidor.parar());

test('a cópia é uma pasta com o banco (íntegro, com o site no ar) e as fotos', () => {
  const r = rodar(['--manter', '0']);
  assert.equal(r.codigo, 0, r.saida);
  const [nome] = copias();
  assert.match(nome, NOVA);
  assert.match(r.saida, /banco e 1 foto/);

  const copia = new DatabaseSync(path.join(backups, nome, 'loja.db'), { readOnly: true });
  assert.equal(copia.prepare('PRAGMA integrity_check').get().integrity_check, 'ok');
  assert.equal(copia.prepare('SELECT COUNT(*) AS n FROM produtos').get().n, 6);
  copia.close();

  const originais = fs.readdirSync(path.join(servidor.pasta, 'uploads'));
  assert.equal(originais.length, 1);
  assert.deepEqual(fs.readdirSync(path.join(backups, nome, 'uploads')), originais);
  assert.deepEqual(
    fs.readFileSync(path.join(backups, nome, 'uploads', originais[0])),
    fs.readFileSync(path.join(servidor.pasta, 'uploads', originais[0])),
  );
  assert.ok(!fs.readdirSync(backups).some((n) => n.includes('incompleta')), 'a pasta provisória não fica para trás');
});

test('rotação: ficam as mais recentes; o que não é cópia deste script nunca é apagado', () => {
  fs.rmSync(backups, { recursive: true, force: true });
  fs.mkdirSync(backups);
  for (const antiga of ['loja-2020-01-01-030000', 'loja-2020-01-02-030000', 'loja-2020-01-03-030000']) {
    fs.mkdirSync(path.join(backups, antiga));
    fs.writeFileSync(path.join(backups, antiga, 'loja.db'), 'x');
  }
  fs.writeFileSync(path.join(backups, 'loja-2019-12-31-0300.db'), 'formato antigo, só o banco');
  const intocaveis = ['antes-da-migracao-v2-20200101-030000.db', 'loja-anotacoes.txt', 'loja-2020-01-01', 'minhas-fotos'];
  for (const nome of intocaveis.slice(0, 2)) fs.writeFileSync(path.join(backups, nome), 'não é cópia do script');
  for (const nome of intocaveis.slice(2)) fs.mkdirSync(path.join(backups, nome));

  const r = rodar(['--manter', '2']);
  assert.equal(r.codigo, 0, r.saida);
  const restantes = fs.readdirSync(backups).sort();
  const novas = restantes.filter((n) => NOVA.test(n) && !n.startsWith('loja-2020'));
  assert.equal(novas.length, 1);
  assert.deepEqual(restantes, [...intocaveis, 'loja-2020-01-03-030000', novas[0]].sort());
  assert.match(r.saida, /Cópias antigas apagadas/);
});

test('sem --manter valem 14 cópias; BACKUP_MANTER e --manter mudam o limite', async () => {
  fs.rmSync(backups, { recursive: true, force: true });
  fs.mkdirSync(backups);
  for (let dia = 1; dia <= 20; dia++) fs.mkdirSync(path.join(backups, `loja-2021-03-${String(dia).padStart(2, '0')}-030000`));

  assert.equal(rodar().codigo, 0);
  assert.equal(copias().length, 14);
  assert.equal(copias()[0], 'loja-2021-03-08-030000'); // saíram as mais antigas

  await new Promise((resolve) => setTimeout(resolve, 1100)); // o nome da cópia vai até o segundo
  assert.equal(rodar([], { BACKUP_MANTER: '5' }).codigo, 0);
  assert.equal(copias().length, 5);

  await new Promise((resolve) => setTimeout(resolve, 1100));
  assert.equal(rodar(['--manter', '0']).codigo, 0); // 0 = nunca apagar
  assert.equal(copias().length, 6);
});

test('outra pasta de destino; argumentos inválidos não gravam nem apagam nada', () => {
  const outra = path.join(servidor.pasta, 'copias-fora');
  assert.equal(rodar([outra, '--manter', '3']).codigo, 0);
  assert.equal(copias(outra).length, 1);

  const antes = fs.readdirSync(backups).sort();
  for (const args of [['--manter'], ['--manter', 'muitas'], ['--manter', '-1'], ['--apagar-tudo'], ['a', 'b']]) {
    const r = rodar(args);
    assert.equal(r.codigo, 1, args.join(' '));
    assert.match(r.saida, /Falha no backup/);
  }
  assert.deepEqual(fs.readdirSync(backups).sort(), antes);
  assert.equal(fs.existsSync(path.join(RAIZ, 'a')), false);
});

test('sem banco na pasta de dados: avisa e sai com erro', () => {
  const r = rodar([], { DATA_DIR: path.join(servidor.pasta, 'pasta-vazia') });
  assert.equal(r.codigo, 1);
  assert.match(r.saida, /Banco não encontrado/);
});
