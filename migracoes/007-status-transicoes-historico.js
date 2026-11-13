'use strict';
// Operação dos pedidos: os status passam a ser da loja (antes eram seis nomes fixos no código), cada status diz para
// quais outros o pedido pode ir, e toda mudança de status fica guardada em um histórico que não se altera.
//
// Os seis status que existiam continuam com o mesmo identificador: nenhum pedido precisa ser tocado.

exports.descricao = 'status de pedido configuráveis, transições permitidas e histórico dos pedidos';

// [id, nome, tipo, para onde pode ir]. De um status em aberto dá para ir a qualquer outro; de "Entregue" e de
// "Cancelado" só se volta um passo, para desfazer um engano.
const PADRAO = [
  ['novo', 'Novo', 'aberto', ['confirmado', 'producao', 'pronto', 'entregue', 'cancelado']],
  ['confirmado', 'Confirmado', 'aberto', ['novo', 'producao', 'pronto', 'entregue', 'cancelado']],
  ['producao', 'Em produção', 'aberto', ['novo', 'confirmado', 'pronto', 'entregue', 'cancelado']],
  ['pronto', 'Pronto', 'aberto', ['novo', 'confirmado', 'producao', 'entregue', 'cancelado']],
  ['entregue', 'Entregue', 'concluido', ['pronto']],
  ['cancelado', 'Cancelado', 'cancelado', ['novo']],
];

exports.subir = (db) => {
  db.exec(`
    -- O tipo é o que o sistema precisa saber sobre um status, seja qual for o nome que a loja der:
    --   aberto    = ainda há o que fazer (conta em "Em aberto");
    --   concluido = terminou bem;
    --   cancelado = não vale: sai da receita e devolve o estoque.
    CREATE TABLE status_pedido (
      id TEXT PRIMARY KEY,
      nome TEXT NOT NULL,
      tipo TEXT NOT NULL CHECK (tipo IN ('aberto', 'concluido', 'cancelado')),
      inicial INTEGER NOT NULL DEFAULT 0 CHECK (inicial IN (0, 1)), -- o status com que todo pedido novo começa
      ordem INTEGER NOT NULL
    ) STRICT;
    CREATE UNIQUE INDEX status_pedido_inicial ON status_pedido (inicial) WHERE inicial = 1; -- só um é o inicial

    -- Um par (de, para) = um pedido em "de" pode ir para "para". O que não está aqui é recusado.
    CREATE TABLE status_transicoes (
      de TEXT NOT NULL REFERENCES status_pedido(id) ON DELETE CASCADE,
      para TEXT NOT NULL REFERENCES status_pedido(id) ON DELETE CASCADE,
      PRIMARY KEY (de, para),
      CHECK (de <> para)
    ) STRICT;

    -- pedidos.status não tem REFERENCES (a coluna é anterior a esta tabela), então quem protege é este gatilho:
    -- status com pedido não é apagado.
    CREATE TRIGGER status_pedido_em_uso BEFORE DELETE ON status_pedido
    WHEN EXISTS (SELECT 1 FROM pedidos WHERE status = OLD.id)
    BEGIN SELECT RAISE(ABORT, 'Há pedidos com este status.'); END;

    -- Histórico: uma linha por mudança de status. Os nomes são copiados, para a linha continuar legível se o status
    -- for renomeado ou excluído, ou se a pessoa mudar de nome.
    CREATE TABLE pedido_historico (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      pedido_numero INTEGER NOT NULL,
      em TEXT NOT NULL,                     -- data e hora (ISO, UTC)
      de TEXT NOT NULL,
      de_nome TEXT NOT NULL,
      para TEXT NOT NULL,
      para_nome TEXT NOT NULL,
      usuario_id TEXT,                      -- quem mudou; sem REFERENCES, como no registro de atividades
      usuario_nome TEXT NOT NULL DEFAULT '',
      observacao TEXT NOT NULL DEFAULT ''   -- opcional (ex.: o motivo de um cancelamento)
    ) STRICT;
    CREATE INDEX pedido_historico_pedido ON pedido_historico (pedido_numero);

    -- Só de inserção, como o registro de atividades (migração 006).
    CREATE TRIGGER pedido_historico_sem_alteracao BEFORE UPDATE ON pedido_historico
    BEGIN SELECT RAISE(ABORT, 'O histórico do pedido não pode ser alterado.'); END;

    -- A única exceção são os pedidos de exemplo (npm run demo), que são apagados inteiros.
    CREATE TRIGGER pedido_historico_sem_exclusao BEFORE DELETE ON pedido_historico
    WHEN NOT EXISTS (SELECT 1 FROM pedidos WHERE numero = OLD.pedido_numero AND demo = 1)
    BEGIN SELECT RAISE(ABORT, 'O histórico do pedido não pode ser apagado.'); END;

    CREATE TRIGGER pedido_historico_sem_substituicao BEFORE INSERT ON pedido_historico
    WHEN EXISTS (SELECT 1 FROM pedido_historico WHERE id = NEW.id)
    BEGIN SELECT RAISE(ABORT, 'O histórico do pedido não pode ser alterado.'); END;
  `);

  const inserir = db.prepare('INSERT INTO status_pedido (id, nome, tipo, inicial, ordem) VALUES (?, ?, ?, ?, ?)');
  PADRAO.forEach(([id, nome, tipo], i) => inserir.run(id, nome, tipo, i === 0 ? 1 : 0, i));
  const ligar = db.prepare('INSERT INTO status_transicoes (de, para) VALUES (?, ?)');
  for (const [de, , , destinos] of PADRAO) for (const para of destinos) ligar.run(de, para);

  // Por garantia: se algum pedido tiver um status fora dos seis (banco mexido à mão), ele entra na lista como está,
  // em aberto, para o pedido não ficar com um status que o sistema desconhece.
  const estranhos = db.prepare('SELECT DISTINCT status FROM pedidos WHERE status NOT IN (SELECT id FROM status_pedido)').all();
  estranhos.forEach(({ status }, i) => inserir.run(status, status.slice(0, 30) || 'Sem nome', 'aberto', 0, PADRAO.length + i));
};
