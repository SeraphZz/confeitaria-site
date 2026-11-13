'use strict';
// Registro de atividades da equipe: quem fez o quê no painel, e quando.
// A tabela é só de inserção: gatilhos do próprio banco recusam alterar ou apagar uma linha, venha o comando de onde
// vier (o sistema, um script, alguém com o arquivo aberto em um programa de SQLite). Quem tem acesso ao arquivo
// ainda pode remover os gatilhos de propósito; o que isto garante é que nada some por engano ou por uma rota do site.

exports.descricao = 'registro de atividades (auditoria), só de inserção';

exports.subir = (db) => {
  db.exec(`
    CREATE TABLE auditoria (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      em TEXT NOT NULL,                     -- data e hora (ISO, UTC)
      -- Quem fez. O nome e o usuário são copiados: o registro continua legível se a pessoa mudar de nome.
      usuario_id TEXT,                      -- sem REFERENCES de propósito: o registro não depende de a pessoa existir
      usuario_login TEXT NOT NULL,
      usuario_nome TEXT NOT NULL,
      acao TEXT NOT NULL,                   -- o que foi feito, em texto ("Alterou o status de um pedido")
      alvo TEXT NOT NULL DEFAULT '',        -- em quê ("Pedido nº 12", "Brigadeiro gourmet")
      detalhes TEXT NOT NULL DEFAULT '{}',  -- JSON pequeno com o que mudou; nunca senhas nem o conteúdo enviado
      ip TEXT NOT NULL DEFAULT ''
    ) STRICT;
    CREATE INDEX auditoria_em ON auditoria (em);

    CREATE TRIGGER auditoria_sem_alteracao BEFORE UPDATE ON auditoria
    BEGIN SELECT RAISE(ABORT, 'O registro de atividades não pode ser alterado.'); END;

    CREATE TRIGGER auditoria_sem_exclusao BEFORE DELETE ON auditoria
    BEGIN SELECT RAISE(ABORT, 'O registro de atividades não pode ser apagado.'); END;

    -- "INSERT OR REPLACE" com o id de uma linha que já existe apagaria essa linha sem passar pelo gatilho de
    -- exclusão. Inserir só vale para linha nova.
    CREATE TRIGGER auditoria_sem_substituicao BEFORE INSERT ON auditoria
    WHEN EXISTS (SELECT 1 FROM auditoria WHERE id = NEW.id)
    BEGIN SELECT RAISE(ABORT, 'O registro de atividades não pode ser alterado.'); END;
  `);
};
