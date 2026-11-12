'use strict';
// O sistema deixa de ser só para confeitarias: a tabela "doces" passa a se chamar "produtos".
// Os dados não mudam; só os nomes. Renomear tabela e coluna no SQLite preserva linhas, índices e referências.

exports.descricao = 'tabela "doces" vira "produtos"';

exports.subir = (db) => {
  db.exec(`
    ALTER TABLE doces RENAME TO produtos;
    ALTER TABLE pedido_itens RENAME COLUMN doce_id TO produto_id;
  `);

  // Loja que já estava funcionando continua chamando seus itens de "doces", com o mesmo ícone de antes.
  // (Instalação nova ainda não tem a conta de acesso neste ponto e recebe o vocabulário dos dados iniciais.)
  const jaInstalada = db.prepare("SELECT 1 AS sim FROM config WHERE chave = 'admin'").get();
  if (jaInstalada) {
    db.prepare("INSERT OR IGNORE INTO config (chave, valor) VALUES ('catalogo', ?)")
      .run(JSON.stringify({ nomeSingular: 'Doce', nomePlural: 'Doces', emojiPadrao: '🧁' }));
  }
};
