'use strict';
// Cópia de segurança completa: o banco e as fotos. Pode rodar com o site no ar (a cópia do banco sai consistente).
//
//   node scripts/backup.js                 -> grava em data/backups/loja-AAAA-MM-DD-HHMMSS/
//   node scripts/backup.js D:\copias       -> grava na pasta informada
//   node scripts/backup.js --manter 30     -> guarda as 30 cópias mais recentes (padrão: 14; 0 = nunca apagar)
//
// Cada cópia é uma pasta com `loja.db` e `uploads/`. Para restaurar: pare o servidor e copie os dois de volta
// para a pasta de dados.
//
// Rotação: depois de gravar a cópia nova, as mais antigas além do limite são apagadas. Só entra na conta (e só é
// apagado) o que este script criou, reconhecido pelo nome "loja-<data>-<hora>"; qualquer outro arquivo da pasta,
// como as cópias "antes-da-migracao-..." feitas pelo servidor, nunca é tocado.

const fs = require('node:fs');
const path = require('node:path');
const { DatabaseSync, backup } = require('node:sqlite');

const MANTER_PADRAO = 14;
// Pasta "loja-2026-11-13-030000" (formato atual) ou arquivo "loja-2026-11-13-0300.db" (formato antigo, só o banco).
const NOME_DE_COPIA = /^loja-\d{4}-\d{2}-\d{2}-\d{4}(\d{2})?(\.db)?$/;

function lerArgumentos(args) {
  let pasta = null;
  let manter = process.env.BACKUP_MANTER || String(MANTER_PADRAO); // variável vazia = padrão
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--manter') manter = args[++i];
    else if (args[i].startsWith('--')) throw new Error(`Opção desconhecida: ${args[i]}`);
    else if (pasta === null) pasta = args[i];
    else throw new Error('Informe uma pasta só.');
  }
  if (!/^\d{1,4}$/.test(String(manter))) throw new Error('Em --manter, informe quantas cópias guardar (um número; 0 = nunca apagar).');
  return { pasta, manter: Number(manter) };
}

// Apaga as cópias mais antigas, deixando as `manter` mais recentes. Devolve os nomes apagados.
function rotacionar(pasta, manter) {
  if (manter === 0) return [];
  // O nome traz a data e a hora com zeros à esquerda: a ordem alfabética é a ordem do tempo.
  const copias = fs.readdirSync(pasta).filter((nome) => NOME_DE_COPIA.test(nome)).sort();
  const sobrando = copias.slice(0, Math.max(0, copias.length - manter));
  for (const nome of sobrando) fs.rmSync(path.join(pasta, nome), { recursive: true, force: true });
  return sobrando;
}

async function principal() {
  const { pasta: pastaPedida, manter } = lerArgumentos(process.argv.slice(2));
  const DATA_DIR = process.env.DATA_DIR ? path.resolve(process.env.DATA_DIR) : path.join(__dirname, '..', 'data');
  const origem = path.join(DATA_DIR, 'loja.db');
  if (!fs.existsSync(origem)) throw new Error('Banco não encontrado em ' + origem);

  const pasta = path.resolve(pastaPedida || path.join(DATA_DIR, 'backups'));
  fs.mkdirSync(pasta, { recursive: true });
  const agora = new Date();
  const p = (n) => String(n).padStart(2, '0');
  const nome = `loja-${agora.getFullYear()}-${p(agora.getMonth() + 1)}-${p(agora.getDate())}-${p(agora.getHours())}${p(agora.getMinutes())}${p(agora.getSeconds())}`;
  const destino = path.join(pasta, nome);
  if (fs.existsSync(destino)) throw new Error(`Já existe uma cópia com este horário (${nome}). Tente de novo em um segundo.`);

  // Grava primeiro em uma pasta provisória: uma cópia interrompida no meio nunca fica com nome de cópia pronta.
  const provisoria = path.join(pasta, `.${nome}.incompleta`);
  fs.rmSync(provisoria, { recursive: true, force: true });
  fs.mkdirSync(provisoria);
  const db = new DatabaseSync(origem, { readOnly: true });
  try {
    await backup(db, path.join(provisoria, 'loja.db'));
  } finally {
    db.close();
  }
  const uploads = path.join(DATA_DIR, 'uploads');
  let fotos = 0;
  if (fs.existsSync(uploads)) {
    fs.cpSync(uploads, path.join(provisoria, 'uploads'), { recursive: true });
    fotos = fs.readdirSync(path.join(provisoria, 'uploads')).length;
  } else {
    fs.mkdirSync(path.join(provisoria, 'uploads'));
  }
  fs.renameSync(provisoria, destino);
  console.log(`Backup gravado em ${destino} (banco e ${fotos} foto(s)).`);

  // Só depois de a cópia nova estar pronta as antigas saem.
  const apagadas = rotacionar(pasta, manter);
  if (apagadas.length) console.log(`Cópias antigas apagadas (ficam as ${manter} mais recentes): ${apagadas.join(', ')}`);
}

principal().catch((erro) => {
  console.error('Falha no backup: ' + erro.message);
  process.exitCode = 1;
});
