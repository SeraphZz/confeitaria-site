'use strict';
// Recursos opcionais do catálogo (a loja liga cada um em Painel > Configurações; as regras estão em src/catalogo.js):
//   variações   o mesmo produto em opções com preço próprio (Pequeno / Médio / Grande); o cliente escolhe uma.
//   adicionais  itens extras somados ao preço (calda, borda recheada); o cliente marca quantos quiser.
//   estoque     quantidade disponível; NULL = a loja não controla o estoque daquele item.
// Bancos que já existiam não mudam de comportamento: nenhum produto ganha variação, adicional ou estoque.

exports.descricao = 'variações, adicionais e estoque dos produtos';

exports.subir = (db) => {
  db.exec(`
    ALTER TABLE produtos ADD COLUMN estoque INTEGER CHECK (estoque IS NULL OR estoque >= 0);

    CREATE TABLE produto_variacoes (
      id TEXT PRIMARY KEY,
      produto_id TEXT NOT NULL REFERENCES produtos(id) ON DELETE CASCADE,
      nome TEXT NOT NULL,
      preco INTEGER NOT NULL CHECK (preco >= 0), -- em centavos; substitui o preço do produto
      estoque INTEGER CHECK (estoque IS NULL OR estoque >= 0), -- produto com variações controla o estoque em cada uma
      ordem INTEGER NOT NULL
    ) STRICT;
    CREATE INDEX variacoes_produto ON produto_variacoes (produto_id);

    CREATE TABLE produto_adicionais (
      id TEXT PRIMARY KEY,
      produto_id TEXT NOT NULL REFERENCES produtos(id) ON DELETE CASCADE,
      nome TEXT NOT NULL,
      preco INTEGER NOT NULL CHECK (preco >= 0), -- em centavos; somado ao preço do item
      ordem INTEGER NOT NULL
    ) STRICT;
    CREATE INDEX adicionais_produto ON produto_adicionais (produto_id);

    -- O que o cliente escolheu é copiado para o item, como o nome e o preço: mudar o produto depois não altera
    -- pedidos antigos. preco_unit já inclui a variação e os adicionais.
    ALTER TABLE pedido_itens ADD COLUMN variacao_id TEXT;
    ALTER TABLE pedido_itens ADD COLUMN variacao TEXT NOT NULL DEFAULT '';     -- nome da variação escolhida
    ALTER TABLE pedido_itens ADD COLUMN adicionais TEXT NOT NULL DEFAULT '[]'; -- JSON: [{ "nome": ..., "preco": ... }]
    -- 0 = o item não mexeu no estoque; 1 = saiu do estoque; 2 = voltou ao estoque (pedido cancelado).
    ALTER TABLE pedido_itens ADD COLUMN estoque_situacao INTEGER NOT NULL DEFAULT 0;
  `);
};
