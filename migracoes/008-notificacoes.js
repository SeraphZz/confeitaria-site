'use strict';
// Fila de notificações (e-mail, WhatsApp, SMS). Cada linha é uma mensagem para uma pessoa por um canal.
// A linha é gravada na mesma transação do que a causou (o pedido criado, o status alterado): ou as duas coisas
// ficam gravadas, ou nenhuma. Quem envia é um trabalhador dentro do próprio servidor (src/notificacoes/fila.js),
// que tenta de novo quando o envio falha. A mesma tabela serve de histórico do que foi enviado.

exports.descricao = 'fila e histórico de notificações';

exports.subir = (db) => {
  db.exec(`
    CREATE TABLE notificacoes (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      -- Identifica "esta mensagem, deste acontecimento, para esta pessoa, por este canal". É única: o mesmo
      -- acontecimento nunca gera a mesma mensagem duas vezes, mesmo que o código seja chamado de novo.
      chave TEXT NOT NULL UNIQUE,
      evento TEXT NOT NULL,                 -- pedido_recebido, pedido_status, pedido_novo_loja, teste
      canal TEXT NOT NULL CHECK (canal IN ('email', 'whatsapp', 'sms')),
      para TEXT NOT NULL CHECK (para IN ('cliente', 'loja', 'teste')),
      destinatario TEXT NOT NULL,           -- e-mail ou telefone, copiado na hora
      pedido_numero INTEGER,                -- sem REFERENCES: o histórico não depende de o pedido existir
      conteudo TEXT NOT NULL,               -- JSON já pronto para enviar (o texto com as variáveis preenchidas)
      estado TEXT NOT NULL DEFAULT 'pendente' CHECK (estado IN ('pendente', 'enviada', 'falhou')),
      tentativas INTEGER NOT NULL DEFAULT 0,
      proxima_em TEXT,                      -- quando tentar (ISO, UTC); só importa enquanto está pendente
      criada_em TEXT NOT NULL,
      enviada_em TEXT,
      ultimo_erro TEXT NOT NULL DEFAULT '',
      id_externo TEXT NOT NULL DEFAULT ''   -- o identificador que o serviço de envio devolveu, quando há
    ) STRICT;
    CREATE INDEX notificacoes_fila ON notificacoes (estado, proxima_em);
    CREATE INDEX notificacoes_criada ON notificacoes (criada_em);
  `);
};
