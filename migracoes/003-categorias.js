'use strict';
// Categorias de produtos: a loja agrupa o que vende (Bolos, Bebidas...) e a página inicial mostra em seções.
// Produto sem categoria continua valendo; apagar uma categoria só deixa os produtos dela sem categoria.

exports.descricao = 'categorias de produtos';

exports.subir = (db) => {
  db.exec(`
    CREATE TABLE categorias (
      id TEXT PRIMARY KEY,
      nome TEXT NOT NULL,
      ordem INTEGER NOT NULL -- posição na página inicial e nas listas
    ) STRICT;

    ALTER TABLE produtos ADD COLUMN categoria_id TEXT REFERENCES categorias(id) ON DELETE SET NULL;
    CREATE INDEX produtos_categoria ON produtos (categoria_id);
  `);
};
