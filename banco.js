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

// ---------------------------------------------------------------- categorias

const paraCategoria = (l) => l && { id: l.id, nome: l.nome };

const listarCategorias = () => sql('SELECT * FROM categorias ORDER BY ordem, rowid').all().map(paraCategoria);
const categoriaPorId = (id) => paraCategoria(sql('SELECT * FROM categorias WHERE id = ?').get(String(id)));

// Cria (no fim da lista) ou troca o nome (pelo id).
function salvarCategoria(c) {
  sql(`INSERT INTO categorias (id, nome, ordem) VALUES (?, ?, (SELECT COALESCE(MAX(ordem), 0) + 1 FROM categorias))
       ON CONFLICT (id) DO UPDATE SET nome = excluded.nome`).run(c.id, c.nome);
}

// `ids`: todas as categorias, na ordem em que devem aparecer.
function ordenarCategorias(ids) {
  transacao(() => ids.forEach((id, posicao) => sql('UPDATE categorias SET ordem = ? WHERE id = ?').run(posicao + 1, id)));
}

function apagarCategoria(id) {
  sql('DELETE FROM categorias WHERE id = ?').run(id); // os produtos dela ficam sem categoria (ON DELETE SET NULL)
}

// ---------------------------------------------------------------- produtos

const paraProduto = (l) => l && {
  id: l.id, slug: l.slug, nome: l.nome, descricao: l.descricao, preco: l.preco,
  unidade: l.unidade, emoji: l.emoji, imagem: l.imagem, disponivel: Boolean(l.disponivel), categoriaId: l.categoria_id,
  estoque: l.estoque, // null = a loja não controla o estoque deste produto
};
const paraVariacao = (l) => ({ id: l.id, nome: l.nome, preco: l.preco, estoque: l.estoque });
const paraAdicional = (l) => ({ id: l.id, nome: l.nome, preco: l.preco });

// Junta a cada produto as variações e os adicionais dele, na ordem definida pela loja.
// Aqui vem tudo o que está gravado; o que aparece conforme os recursos ligados é decidido em src/catalogo.js.
function comOpcoes(produtos) {
  if (!produtos.length) return produtos;
  // Um produto só: busca as opções dele. Vários: uma consulta por tabela, em vez de uma por produto.
  const filtro = produtos.length === 1 ? 'WHERE produto_id = ?' : '';
  const parametros = produtos.length === 1 ? [produtos[0].id] : [];
  const agrupar = (tabela, converter) => {
    const grupos = new Map();
    for (const l of sql(`SELECT * FROM ${tabela} ${filtro} ORDER BY ordem`).all(...parametros)) {
      if (!grupos.has(l.produto_id)) grupos.set(l.produto_id, []);
      grupos.get(l.produto_id).push(converter(l));
    }
    return grupos;
  };
  const variacoes = agrupar('produto_variacoes', paraVariacao);
  const adicionais = agrupar('produto_adicionais', paraAdicional);
  return produtos.map((p) => ({ ...p, variacoes: variacoes.get(p.id) || [], adicionais: adicionais.get(p.id) || [] }));
}
const umProduto = (linha) => (linha ? comOpcoes([paraProduto(linha)])[0] : undefined);

function listarProdutos({ soDisponiveis = false } = {}) {
  return comOpcoes(sql(`SELECT * FROM produtos ${soDisponiveis ? 'WHERE disponivel = 1' : ''} ORDER BY rowid`).all().map(paraProduto));
}
const produtoPorId = (id) => umProduto(sql('SELECT * FROM produtos WHERE id = ?').get(String(id)));
const produtoPorSlug = (slug) => umProduto(sql('SELECT * FROM produtos WHERE slug = ?').get(String(slug)));

// Cria ou atualiza (pelo id), com as variações e os adicionais: os que não vierem na lista são apagados.
function salvarProduto(d) {
  transacao(() => {
    sql(`INSERT INTO produtos (id, slug, nome, descricao, preco, unidade, emoji, imagem, disponivel, categoria_id, estoque)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT (id) DO UPDATE SET slug = excluded.slug, nome = excluded.nome, descricao = excluded.descricao,
           preco = excluded.preco, unidade = excluded.unidade, emoji = excluded.emoji, imagem = excluded.imagem,
           disponivel = excluded.disponivel, categoria_id = excluded.categoria_id, estoque = excluded.estoque`)
      .run(d.id, d.slug, d.nome, d.descricao, d.preco, d.unidade, d.emoji, d.imagem, d.disponivel ? 1 : 0, d.categoriaId || null, d.estoque ?? null);

    const variacoes = d.variacoes || [];
    const adicionais = d.adicionais || [];
    apagarOpcoesForaDaLista('produto_variacoes', d.id, variacoes);
    apagarOpcoesForaDaLista('produto_adicionais', d.id, adicionais);
    variacoes.forEach((v, ordem) => {
      sql(`INSERT INTO produto_variacoes (id, produto_id, nome, preco, estoque, ordem) VALUES (?, ?, ?, ?, ?, ?)
           ON CONFLICT (id) DO UPDATE SET nome = excluded.nome, preco = excluded.preco, estoque = excluded.estoque, ordem = excluded.ordem`)
        .run(v.id, d.id, v.nome, v.preco, v.estoque ?? null, ordem);
    });
    adicionais.forEach((a, ordem) => {
      sql(`INSERT INTO produto_adicionais (id, produto_id, nome, preco, ordem) VALUES (?, ?, ?, ?, ?)
           ON CONFLICT (id) DO UPDATE SET nome = excluded.nome, preco = excluded.preco, ordem = excluded.ordem`)
        .run(a.id, d.id, a.nome, a.preco, ordem);
    });
  });
}

function apagarOpcoesForaDaLista(tabela, produtoId, lista) {
  const manter = new Set(lista.map((o) => o.id));
  for (const { id } of sql(`SELECT id FROM ${tabela} WHERE produto_id = ?`).all(produtoId)) {
    if (!manter.has(id)) sql(`DELETE FROM ${tabela} WHERE id = ?`).run(id);
  }
}

// ---- estoque
// O estoque de um item de pedido fica na variação escolhida, quando há uma; senão, no produto.
const ondeFicaOEstoque = (item) => (item.variacaoId ? ['produto_variacoes', item.variacaoId] : ['produtos', item.produtoId]);

// Tira a quantidade do item do estoque, só se houver o bastante (a conferência e a baixa são um comando só).
// Devolve { baixou: true }, ou { baixou: false, restam }: `restam` é quanto há, ou null se o estoque não é controlado.
function baixarEstoque(item) {
  const [tabela, id] = ondeFicaOEstoque(item);
  const { changes } = sql(`UPDATE ${tabela} SET estoque = estoque - ? WHERE id = ? AND estoque >= ?`).run(item.quantidade, id, item.quantidade);
  if (Number(changes) > 0) return { baixou: true };
  const linha = sql(`SELECT estoque FROM ${tabela} WHERE id = ?`).get(id);
  return { baixou: false, restam: linha ? linha.estoque : null };
}

// Devolve a quantidade do item ao estoque (pedido cancelado). Não faz nada se o estoque deixou de ser controlado.
function devolverEstoque(item) {
  const [tabela, id] = ondeFicaOEstoque(item);
  sql(`UPDATE ${tabela} SET estoque = estoque + ? WHERE id = ? AND estoque IS NOT NULL`).run(item.quantidade, id);
}

// Situação do estoque nos itens de um pedido: 1 = saiu do estoque, 2 = voltou (ver migração 004).
function trocarSituacaoEstoque(pedidoNumero, de, para) {
  sql('UPDATE pedido_itens SET estoque_situacao = ? WHERE pedido_numero = ? AND estoque_situacao = ?').run(para, pedidoNumero, de);
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
      sql(`INSERT INTO pedido_itens (pedido_numero, produto_id, nome, preco_unit, quantidade, observacoes,
             variacao_id, variacao, adicionais, estoque_situacao) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
        .run(numero, i.produtoId || null, i.nome, i.precoUnit, i.quantidade, i.observacoes || '',
          i.variacaoId || null, i.variacao || '', JSON.stringify(i.adicionais || []), i.estoqueSituacao || 0);
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
    itens.get(i.pedido_numero).push({
      produtoId: i.produto_id, nome: i.nome, precoUnit: i.preco_unit, quantidade: i.quantidade, observacoes: i.observacoes,
      variacaoId: i.variacao_id, variacao: i.variacao, adicionais: JSON.parse(i.adicionais), estoqueSituacao: i.estoque_situacao,
    });
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
  listarCategorias, categoriaPorId, salvarCategoria, ordenarCategorias, apagarCategoria,
  listarProdutos, produtoPorId, produtoPorSlug, salvarProduto, apagarProduto,
  baixarEstoque, devolverEstoque, trocarSituacaoEstoque,
  listarClientes, clientePorId, clientePorEmail, salvarCliente,
  inserirPedido, listarPedidos, pedidoPorId, mudarStatusPedido, contarPedidosComStatus, apagarPedidosDemo,
};
