'use strict';
// Equipe da loja: em vez de uma conta única de acesso ao painel, cada pessoa tem o próprio usuário, ligado a um
// perfil que define o que ela pode fazer (as regras estão em src/permissoes.js e src/equipe.js).
// As sessões de login saem da memória do servidor e passam para o banco: reiniciar o servidor não desloga mais.
//
// A conta de acesso que existia (config 'admin') vira o primeiro usuário, com o perfil Administrador, o mesmo
// nome de usuário e a mesma senha.

const crypto = require('node:crypto');

exports.descricao = 'usuários, perfis, permissões e sessões no banco';

exports.subir = (db) => {
  db.exec(`
    CREATE TABLE perfis (
      id TEXT PRIMARY KEY,
      nome TEXT NOT NULL UNIQUE,
      sistema INTEGER NOT NULL DEFAULT 0 -- 1 = Administrador: tem todas as permissões e não pode ser alterado nem apagado
    ) STRICT;

    CREATE TABLE perfil_permissoes (
      perfil_id TEXT NOT NULL REFERENCES perfis(id) ON DELETE CASCADE,
      permissao TEXT NOT NULL, -- um dos ids de src/permissoes.js
      PRIMARY KEY (perfil_id, permissao)
    ) STRICT;

    CREATE TABLE usuarios (
      id TEXT PRIMARY KEY,
      usuario TEXT NOT NULL UNIQUE,              -- o que a pessoa digita para entrar (nunca tem "@": isso é e-mail de cliente)
      nome TEXT NOT NULL,
      perfil_id TEXT NOT NULL REFERENCES perfis(id), -- perfil em uso não pode ser apagado
      salt TEXT NOT NULL,
      hash TEXT NOT NULL,
      ativo INTEGER NOT NULL DEFAULT 1,          -- 0 = não entra mais (a pessoa saiu da equipe); o registro fica
      senha_inicial INTEGER NOT NULL DEFAULT 0,  -- 1 = senha definida por outra pessoa: o painel lembra de trocar
      criado_em TEXT NOT NULL
    ) STRICT;

    -- Ajustes individuais sobre o perfil: liberar uma permissão que o perfil não tem, ou bloquear uma que ele tem.
    CREATE TABLE usuario_permissoes (
      usuario_id TEXT NOT NULL REFERENCES usuarios(id) ON DELETE CASCADE,
      permissao TEXT NOT NULL,
      efeito TEXT NOT NULL CHECK (efeito IN ('conceder', 'negar')),
      PRIMARY KEY (usuario_id, permissao)
    ) STRICT;

    -- O cookie do navegador guarda o token; aqui fica só o SHA-256 dele. Quem ler o banco (ou um backup) não
    -- consegue se passar por ninguém.
    CREATE TABLE sessoes (
      token_hash TEXT PRIMARY KEY,
      tipo TEXT NOT NULL CHECK (tipo IN ('usuario', 'cliente')),
      usuario_id TEXT REFERENCES usuarios(id) ON DELETE CASCADE,
      cliente_id TEXT REFERENCES clientes(id) ON DELETE CASCADE,
      criada_em TEXT NOT NULL,
      validade INTEGER NOT NULL, -- instante em que expira, em milissegundos
      CHECK ((tipo = 'usuario' AND usuario_id IS NOT NULL AND cliente_id IS NULL)
          OR (tipo = 'cliente' AND cliente_id IS NOT NULL AND usuario_id IS NULL))
    ) STRICT;
    CREATE INDEX sessoes_usuario ON sessoes (usuario_id);
    CREATE INDEX sessoes_cliente ON sessoes (cliente_id);
    CREATE INDEX sessoes_validade ON sessoes (validade);
  `);

  // Perfis de partida. O Administrador é fixo; os outros dois são sugestões que a loja pode alterar ou apagar.
  const criarPerfil = db.prepare('INSERT INTO perfis (id, nome, sistema) VALUES (?, ?, ?)');
  const darPermissao = db.prepare('INSERT INTO perfil_permissoes (perfil_id, permissao) VALUES (?, ?)');
  const administrador = crypto.randomUUID();
  criarPerfil.run(administrador, 'Administrador', 1);
  for (const [nome, permissoes] of [
    ['Atendimento', ['pedidos.ver', 'pedidos.alterar', 'clientes.ver']],
    ['Catálogo', ['produtos.editar', 'conteudo.editar']],
  ]) {
    const id = crypto.randomUUID();
    criarPerfil.run(id, nome, 0);
    for (const permissao of permissoes) darPermissao.run(id, permissao);
  }

  // Loja que já estava funcionando: a conta de acesso vira o primeiro Administrador.
  // (Instalação nova ainda não tem conta neste ponto; o primeiro usuário é criado em src/primeiro-uso.js.)
  const linha = db.prepare("SELECT valor FROM config WHERE chave = 'admin'").get();
  if (linha) {
    const admin = JSON.parse(linha.valor);
    db.prepare('INSERT INTO usuarios (id, usuario, nome, perfil_id, salt, hash, ativo, senha_inicial, criado_em) VALUES (?, ?, ?, ?, ?, ?, 1, ?, ?)')
      .run(crypto.randomUUID(), String(admin.usuario || 'confeiteira'), 'Administrador', administrador,
        String(admin.salt || ''), String(admin.hash || ''), admin.senhaInicial ? 1 : 0, new Date().toISOString());
    db.prepare("DELETE FROM config WHERE chave = 'admin'").run();
  }
};
