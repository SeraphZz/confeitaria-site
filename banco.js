'use strict';
// Camada de dados: SQLite embutido no Node (node:sqlite), sem dependências.
// O banco é um arquivo só, data/loja.db. O resto do sistema fala com ele apenas pelas funções deste módulo.

const fs = require('node:fs');
const path = require('node:path');
const { DatabaseSync } = require('node:sqlite');

const DATA_DIR = process.env.DATA_DIR ? path.resolve(process.env.DATA_DIR) : path.join(__dirname, 'data');
const ARQUIVO = path.join(DATA_DIR, 'loja.db');
const JSON_ANTIGO = path.join(DATA_DIR, 'db.json'); // formato usado antes do SQLite

fs.mkdirSync(DATA_DIR, { recursive: true });
const db = new DatabaseSync(ARQUIVO);

// busy_timeout: os scripts (senha, demo, backup) podem rodar com o servidor ligado; quem chegar depois espera.
db.exec(`
  PRAGMA foreign_keys = ON;
  PRAGMA busy_timeout = 5000;
`);

// A estrutura das tabelas fica em migracoes/: aqui só são aplicadas as que ainda faltam neste banco.
require('./migracoes').aplicar(db, { pastaBackups: path.join(DATA_DIR, 'backups') });

// Toda consulta passa por aqui: o SQL é sempre texto fixo e os valores vão separados, como parâmetros (?).
const preparadas = new Map();
function sql(textoSql) {
  let consulta = preparadas.get(textoSql);
  if (!consulta) preparadas.set(textoSql, consulta = db.prepare(textoSql));
  return consulta;
}

// Tudo o que `fn` gravar vale junto ou não vale: se der erro no meio, nada fica salvo.
let emTransacao = false;
function transacao(fn) {
  if (emTransacao) return fn();
  db.exec('BEGIN IMMEDIATE');
  emTransacao = true;
  try {
    const resultado = fn();
    db.exec('COMMIT');
    return resultado;
  } catch (erro) {
    db.exec('ROLLBACK');
    throw erro;
  } finally {
    emTransacao = false;
  }
}

// ---------------------------------------------------------------- config (loja, sobre, admin)

function lerConfig(chave) {
  const linha = sql('SELECT valor FROM config WHERE chave = ?').get(chave);
  return linha ? JSON.parse(linha.valor) : null;
}

function gravarConfig(chave, valor) {
  sql('INSERT INTO config (chave, valor) VALUES (?, ?) ON CONFLICT (chave) DO UPDATE SET valor = excluded.valor')
    .run(chave, JSON.stringify(valor));
}

function apagarConfig(chave) {
  sql('DELETE FROM config WHERE chave = ?').run(chave);
}

// ---------------------------------------------------------------- produtos

const paraProduto = (l) => l && {
  id: l.id, slug: l.slug, nome: l.nome, descricao: l.descricao, preco: l.preco,
  unidade: l.unidade, emoji: l.emoji, imagem: l.imagem, disponivel: Boolean(l.disponivel),
};

function listarProdutos({ soDisponiveis = false } = {}) {
  return sql(`SELECT * FROM produtos ${soDisponiveis ? 'WHERE disponivel = 1' : ''} ORDER BY rowid`).all().map(paraProduto);
}
const produtoPorId = (id) => paraProduto(sql('SELECT * FROM produtos WHERE id = ?').get(String(id)));
const produtoPorSlug = (slug) => paraProduto(sql('SELECT * FROM produtos WHERE slug = ?').get(String(slug)));

// Cria ou atualiza (pelo id).
function salvarProduto(d) {
  sql(`INSERT INTO produtos (id, slug, nome, descricao, preco, unidade, emoji, imagem, disponivel)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT (id) DO UPDATE SET slug = excluded.slug, nome = excluded.nome, descricao = excluded.descricao,
         preco = excluded.preco, unidade = excluded.unidade, emoji = excluded.emoji, imagem = excluded.imagem,
         disponivel = excluded.disponivel`)
    .run(d.id, d.slug, d.nome, d.descricao, d.preco, d.unidade, d.emoji, d.imagem, d.disponivel ? 1 : 0);
}

function apagarProduto(id) {
  sql('DELETE FROM produtos WHERE id = ?').run(id);
}

// ---------------------------------------------------------------- clientes

const CAMPOS_ENDERECO = ['cep', 'rua', 'numero', 'complemento', 'bairro', 'cidade', 'uf'];

const paraCliente = (l) => l && {
  id: l.id, email: l.email, nome: l.nome, telefone: l.telefone,
  endereco: Object.fromEntries(CAMPOS_ENDERECO.map((c) => [c, l[c]])),
  salt: l.salt, hash: l.hash, criadoEm: l.criado_em,
};

const listarClientes = () => sql('SELECT * FROM clientes ORDER BY rowid').all().map(paraCliente);
const clientePorId = (id) => paraCliente(sql('SELECT * FROM clientes WHERE id = ?').get(String(id)));
const clientePorEmail = (email) => paraCliente(sql('SELECT * FROM clientes WHERE email = ?').get(String(email)));

// Cria ou atualiza (pelo id).
function salvarCliente(c) {
  const e = c.endereco || {};
  sql(`INSERT INTO clientes (id, email, nome, telefone, cep, rua, numero, complemento, bairro, cidade, uf, salt, hash, criado_em)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT (id) DO UPDATE SET email = excluded.email, nome = excluded.nome, telefone = excluded.telefone,
         cep = excluded.cep, rua = excluded.rua, numero = excluded.numero, complemento = excluded.complemento,
         bairro = excluded.bairro, cidade = excluded.cidade, uf = excluded.uf, salt = excluded.salt, hash = excluded.hash`)
    .run(c.id, c.email, c.nome, c.telefone, ...CAMPOS_ENDERECO.map((campo) => String(e[campo] || '')), c.salt, c.hash, c.criadoEm);
}

// ---------------------------------------------------------------- pedidos

// Grava o pedido e os itens e devolve o número dele. Sem `p.numero`, o banco usa o próximo da sequência.
function inserirPedido(p) {
  return transacao(() => {
    const { lastInsertRowid } = sql(`
      INSERT INTO pedidos (numero, id, criado_em, cliente_id, cliente_nome, cliente_telefone,
        entrega_tipo, entrega_data, entrega_endereco, observacoes, total, status, demo)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
      .run(p.numero ?? null, p.id, p.criadoEm, p.clienteId || null, p.cliente.nome, p.cliente.telefone,
        p.entrega.tipo, p.entrega.data, p.entrega.endereco || '', p.observacoes || '', p.total, p.status, p.demo ? 1 : 0);
    const numero = Number(lastInsertRowid);
    for (const i of p.itens) {
      sql('INSERT INTO pedido_itens (pedido_numero, produto_id, nome, preco_unit, quantidade, observacoes) VALUES (?, ?, ?, ?, ?, ?)')
        .run(numero, i.produtoId || null, i.nome, i.precoUnit, i.quantidade, i.observacoes || '');
    }
    return numero;
  });
}

// Devolve pedidos já com os itens, do mais antigo para o mais novo. `filtro` é SQL fixo deste arquivo, nunca texto de fora.
function buscarPedidos(filtro = '', parametros = []) {
  const itens = new Map();
  const linhasItens = sql(`SELECT i.* FROM pedido_itens i JOIN pedidos p ON p.numero = i.pedido_numero ${filtro} ORDER BY i.rowid`).all(...parametros);
  for (const i of linhasItens) {
    if (!itens.has(i.pedido_numero)) itens.set(i.pedido_numero, []);
    itens.get(i.pedido_numero).push({ produtoId: i.produto_id, nome: i.nome, precoUnit: i.preco_unit, quantidade: i.quantidade, observacoes: i.observacoes });
  }
  return sql(`SELECT p.* FROM pedidos p ${filtro} ORDER BY p.criado_em, p.numero`).all(...parametros).map((p) => ({
    id: p.id, numero: p.numero, criadoEm: p.criado_em, clienteId: p.cliente_id,
    cliente: { nome: p.cliente_nome, telefone: p.cliente_telefone },
    entrega: { tipo: p.entrega_tipo, data: p.entrega_data, endereco: p.entrega_endereco },
    itens: itens.get(p.numero) || [], observacoes: p.observacoes, total: p.total, status: p.status,
  }));
}

// `desde` é uma data ISO (criadoEm >= desde).
function listarPedidos({ clienteId, desde } = {}) {
  if (clienteId) return buscarPedidos('WHERE p.cliente_id = ?', [clienteId]);
  if (desde) return buscarPedidos('WHERE p.criado_em >= ?', [desde]);
  return buscarPedidos();
}

const pedidoPorId = (id) => buscarPedidos('WHERE p.id = ?', [String(id)])[0] || null;

function mudarStatusPedido(id, status) {
  sql('UPDATE pedidos SET status = ? WHERE id = ?').run(status, id);
}

function contarPedidosComStatus(lista) {
  return sql(`SELECT COUNT(*) AS n FROM pedidos WHERE status IN (${lista.map(() => '?').join(', ')})`).get(...lista).n;
}

function apagarPedidosDemo() {
  sql('DELETE FROM pedidos WHERE demo = 1').run(); // os itens vão junto (ON DELETE CASCADE)
}

// ---------------------------------------------------------------- migração do db.json antigo
// Acontece sozinha, uma única vez: se existe data/db.json e o banco novo está vazio, copia tudo
// e renomeia o arquivo antigo para db.json.migrado (fica guardado como cópia de segurança).

function importarJsonAntigo() {
  if (lerConfig('admin') || !fs.existsSync(JSON_ANTIGO)) return;
  const antigo = JSON.parse(fs.readFileSync(JSON_ANTIGO, 'utf8'));
  const clientes = antigo.clientes || [];
  const pedidos = antigo.pedidos || [];

  transacao(() => {
    for (const chave of ['loja', 'sobre', 'admin']) gravarConfig(chave, antigo[chave]);
    for (const d of antigo.doces || []) salvarProduto(d); // no arquivo antigo a lista se chama "doces"
    for (const c of clientes) {
      // Nos primeiros bancos o endereço era um texto só: ele vai para o campo "rua".
      const endereco = c.endereco && typeof c.endereco === 'object' ? c.endereco : { rua: String(c.endereco || '') };
      salvarCliente({ ...c, endereco, criadoEm: c.criadoEm || new Date().toISOString() });
    }
    const idsClientes = new Set(clientes.map((c) => c.id));
    for (const p of pedidos) {
      const itens = (p.itens || []).map((i) => ({ ...i, produtoId: i.produtoId || i.doceId })); // idem: "doceId"
      inserirPedido({ ...p, itens, clienteId: idsClientes.has(p.clienteId) ? p.clienteId : null });
    }

    // A numeração continua de onde parou, mesmo que os últimos pedidos tenham sido apagados.
    const ultimo = Math.max((antigo.proximoNumero || 1) - 1, ...pedidos.map((p) => p.numero));
    sql("DELETE FROM sqlite_sequence WHERE name = 'pedidos'").run();
    sql("INSERT INTO sqlite_sequence (name, seq) VALUES ('pedidos', ?)").run(ultimo);
  });

  fs.renameSync(JSON_ANTIGO, JSON_ANTIGO + '.migrado');
  console.log(`Dados migrados de db.json para loja.db: ${(antigo.doces || []).length} produtos, ${clientes.length} clientes, ${pedidos.length} pedidos.`);
  console.log('O arquivo antigo ficou guardado como data/db.json.migrado.');
}
importarJsonAntigo();

module.exports = {
  DATA_DIR, ARQUIVO, transacao, lerConfig, gravarConfig, apagarConfig,
  listarProdutos, produtoPorId, produtoPorSlug, salvarProduto, apagarProduto,
  listarClientes, clientePorId, clientePorEmail, salvarCliente,
  inserirPedido, listarPedidos, pedidoPorId, mudarStatusPedido, contarPedidosComStatus, apagarPedidosDemo,
};
