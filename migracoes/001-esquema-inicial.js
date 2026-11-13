'use strict';
// Estrutura do banco como estava antes de existirem migrações.
// Os "IF NOT EXISTS" fazem esta migração não alterar nada em instalações que já tinham essas tabelas.

exports.descricao = 'estrutura inicial (config, doces, clientes, pedidos e itens)';

exports.subir = (db) => {
  db.exec(`
    -- Registros únicos guardados como JSON: 'loja', 'sobre' e 'admin'.
    CREATE TABLE IF NOT EXISTS config (
      chave TEXT PRIMARY KEY,
      valor TEXT NOT NULL
    ) STRICT;

    CREATE TABLE IF NOT EXISTS doces (
      id TEXT PRIMARY KEY,
      slug TEXT NOT NULL UNIQUE,
      nome TEXT NOT NULL,
      descricao TEXT NOT NULL DEFAULT '',
      preco INTEGER NOT NULL CHECK (preco >= 0), -- em centavos
      unidade TEXT NOT NULL,
      emoji TEXT NOT NULL,
      imagem TEXT NOT NULL DEFAULT '',
      disponivel INTEGER NOT NULL DEFAULT 1
    ) STRICT;

    CREATE TABLE IF NOT EXISTS clientes (
      id TEXT PRIMARY KEY,
      email TEXT NOT NULL UNIQUE,
      nome TEXT NOT NULL,
      telefone TEXT NOT NULL,
      cep TEXT NOT NULL DEFAULT '',
      rua TEXT NOT NULL DEFAULT '',
      numero TEXT NOT NULL DEFAULT '',
      complemento TEXT NOT NULL DEFAULT '',
      bairro TEXT NOT NULL DEFAULT '',
      cidade TEXT NOT NULL DEFAULT '',
      uf TEXT NOT NULL DEFAULT '',
      salt TEXT NOT NULL,
      hash TEXT NOT NULL,
      criado_em TEXT NOT NULL
    ) STRICT;

    -- Nome, telefone e endereço são copiados para o pedido: mudar o cadastro depois não altera pedidos antigos.
    CREATE TABLE IF NOT EXISTS pedidos (
      numero INTEGER PRIMARY KEY AUTOINCREMENT, -- AUTOINCREMENT nunca reaproveita um número
      id TEXT NOT NULL UNIQUE,
      criado_em TEXT NOT NULL,
      cliente_id TEXT REFERENCES clientes(id) ON DELETE SET NULL,
      cliente_nome TEXT NOT NULL,
      cliente_telefone TEXT NOT NULL,
      entrega_tipo TEXT NOT NULL,
      entrega_data TEXT NOT NULL,
      entrega_endereco TEXT NOT NULL DEFAULT '',
      observacoes TEXT NOT NULL DEFAULT '',
      total INTEGER NOT NULL,
      status TEXT NOT NULL,
      demo INTEGER NOT NULL DEFAULT 0
    ) STRICT;
    CREATE INDEX IF NOT EXISTS pedidos_criado_em ON pedidos (criado_em);
    CREATE INDEX IF NOT EXISTS pedidos_cliente ON pedidos (cliente_id);

    -- Nome e preço também são copiados: o doce pode mudar de preço ou ser apagado.
    CREATE TABLE IF NOT EXISTS pedido_itens (
      pedido_numero INTEGER NOT NULL REFERENCES pedidos(numero) ON DELETE CASCADE,
      doce_id TEXT,
      nome TEXT NOT NULL,
      preco_unit INTEGER NOT NULL,
      quantidade INTEGER NOT NULL,
      observacoes TEXT NOT NULL DEFAULT ''
    ) STRICT;
    CREATE INDEX IF NOT EXISTS itens_pedido ON pedido_itens (pedido_numero);
  `);
};
