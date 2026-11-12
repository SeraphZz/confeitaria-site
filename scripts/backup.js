'use strict';
// Cópia de segurança do banco. Pode rodar com o site no ar (a cópia sai consistente):
//   node scripts/backup.js            -> grava em data/backups/loja-AAAA-MM-DD-HHMM.db
//   node scripts/backup.js D:\copias  -> grava na pasta informada
// As fotos ficam em data/uploads/: copie essa pasta também.

const fs = require('node:fs');
const path = require('node:path');
const { DatabaseSync, backup } = require('node:sqlite');

const DATA_DIR = process.env.DATA_DIR ? path.resolve(process.env.DATA_DIR) : path.join(__dirname, '..', 'data');
const origem = path.join(DATA_DIR, 'loja.db');
if (!fs.existsSync(origem)) {
  console.error('Banco não encontrado em ' + origem);
  process.exit(1);
}

const pasta = path.resolve(process.argv[2] || path.join(DATA_DIR, 'backups'));
fs.mkdirSync(pasta, { recursive: true });
const agora = new Date();
const p = (n) => String(n).padStart(2, '0');
const destino = path.join(pasta, `loja-${agora.getFullYear()}-${p(agora.getMonth() + 1)}-${p(agora.getDate())}-${p(agora.getHours())}${p(agora.getMinutes())}.db`);

const db = new DatabaseSync(origem, { readOnly: true });
backup(db, destino)
  .then(() => console.log('Backup gravado em ' + destino))
  .catch((erro) => { console.error('Falha no backup:', erro.message); process.exitCode = 1; })
  .finally(() => db.close());
