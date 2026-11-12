'use strict';
// Migrações do banco: cada mudança de estrutura é um arquivo numerado nesta pasta (001-..., 002-...).
// O banco guarda o número da última aplicada (PRAGMA user_version). Ao subir, o servidor aplica as que faltam,
// em ordem, cada uma dentro de uma transação: ou a migração inteira vale, ou nada muda.
//
// Para criar uma migração: copie o formato de 001-esquema-inicial.js com o próximo número.
// Nunca edite uma migração que já foi publicada: instalações que já a aplicaram não rodam de novo. Crie outra.

const fs = require('node:fs');
const path = require('node:path');

function carregarMigracoes(pasta = __dirname) {
  const arquivos = fs.readdirSync(pasta).filter((nome) => /^\d{3}-[a-z0-9-]+\.js$/.test(nome)).sort();
  return arquivos.map((nome, indice) => {
    const versao = Number(nome.slice(0, 3));
    if (versao !== indice + 1) throw new Error(`Migrações fora de sequência: esperava ${String(indice + 1).padStart(3, '0')}, encontrei ${nome}.`);
    const { descricao, subir } = require(path.join(pasta, nome));
    if (typeof subir !== 'function') throw new Error(`A migração ${nome} não exporta a função "subir".`);
    return { versao, nome, descricao: descricao || nome, subir };
  });
}

const versaoDe = (db) => db.prepare('PRAGMA user_version').get().user_version;

// Cópia de segurança feita pelo próprio SQLite (sai consistente mesmo com o banco em uso).
function copiarBanco(db, pastaBackups, versao) {
  fs.mkdirSync(pastaBackups, { recursive: true });
  const carimbo = new Date().toISOString().replace(/[-:]/g, '').replace('T', '-').slice(0, 15);
  const destino = path.join(pastaBackups, `antes-da-migracao-v${versao}-${carimbo}.db`);
  fs.rmSync(destino, { force: true }); // VACUUM INTO não sobrescreve
  db.exec(`VACUUM INTO '${destino.replace(/'/g, "''")}'`);
  return destino;
}

// Aplica as migrações pendentes. Devolve { de, para, backup }.
// `pastaBackups`: onde guardar a cópia feita antes de mexer em um banco que já tem dados (omitir = sem cópia).
function aplicar(db, { pastaBackups, migracoes = carregarMigracoes(), log = console.log } = {}) {
  const de = versaoDe(db);
  const ultima = migracoes.length;
  if (de > ultima) {
    throw new Error(`O banco está na versão ${de}, mas este programa só conhece até a ${ultima}. ` +
      'Você está rodando uma versão antiga do sistema com um banco mais novo: atualize o sistema ou restaure um backup.');
  }
  if (de === ultima) return { de, para: de, backup: null };

  // Banco que já existia (tem tabelas): guarda uma cópia antes de alterar a estrutura.
  const temDados = db.prepare("SELECT COUNT(*) AS n FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%'").get().n > 0;
  const backup = temDados && pastaBackups ? copiarBanco(db, pastaBackups, de) : null;
  if (backup) log(`Cópia de segurança antes de atualizar o banco: ${backup}`);

  for (const m of migracoes.slice(de)) {
    // Recriar tabelas exige as chaves estrangeiras desligadas, e isso só pode ser feito fora da transação.
    // Antes de confirmar, foreign_key_check garante que nenhuma referência ficou quebrada.
    db.exec('PRAGMA foreign_keys = OFF');
    db.exec('BEGIN IMMEDIATE');
    try {
      // Outro processo (um script rodando junto com o servidor) pode ter aplicado esta migração enquanto esperávamos.
      if (versaoDe(db) >= m.versao) { db.exec('COMMIT'); continue; }
      m.subir(db);
      const quebradas = db.prepare('PRAGMA foreign_key_check').all();
      if (quebradas.length) throw new Error(`deixou ${quebradas.length} referência(s) quebrada(s) na tabela "${quebradas[0].table}"`);
      db.exec(`PRAGMA user_version = ${m.versao}`);
      db.exec('COMMIT');
    } catch (erro) {
      db.exec('ROLLBACK');
      throw new Error(`A migração ${m.nome} falhou e foi desfeita; o banco continua na versão ${m.versao - 1}. Motivo: ${erro.message}`, { cause: erro });
    } finally {
      db.exec('PRAGMA foreign_keys = ON');
    }
    if (temDados) log(`Banco atualizado para a versão ${m.versao}: ${m.descricao}`);
  }
  return { de, para: ultima, backup };
}

module.exports = { aplicar, carregarMigracoes, versaoDe };
