'use strict';
// Gera pedidos de exemplo para ver o painel com dados: `npm run demo` (com o servidor parado).
// Os pedidos de exemplo têm o cliente "Cliente Exemplo N"; rode com --limpar para removê-los.

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

const DATA_DIR = process.env.DATA_DIR ? path.resolve(process.env.DATA_DIR) : path.join(__dirname, '..', 'data');
const DB_FILE = path.join(DATA_DIR, 'db.json');
if (!fs.existsSync(DB_FILE)) {
  console.error('Rode o servidor uma vez antes (node server.js) para criar o banco.');
  process.exit(1);
}

const db = JSON.parse(fs.readFileSync(DB_FILE, 'utf8'));
db.pedidos = db.pedidos.filter((p) => !p.demo);

if (!process.argv.includes('--limpar')) {
  const sortear = (lista) => lista[Math.floor(Math.random() * lista.length)];
  const iso = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  for (let n = 1; n <= 60; n++) {
    const pessoa = 1 + Math.floor(Math.random() * 15); // 15 pessoas, cada uma com seu telefone
    const criado = new Date(Date.now() - Math.random() * 90 * 86400000);
    const idade = (Date.now() - criado) / 86400000;
    const itens = Array.from({ length: 1 + Math.floor(Math.random() * 3) }, () => {
      const doce = sortear(db.doces);
      return { doceId: doce.id, nome: doce.nome, precoUnit: doce.preco, quantidade: doce.preco < 2000 ? 6 + Math.floor(Math.random() * 30) : 1, observacoes: '' };
    });
    const entrega = new Date(criado.getTime() + 3 * 86400000);
    db.pedidos.push({
      demo: true, id: crypto.randomUUID(), numero: db.proximoNumero++, criadoEm: criado.toISOString(),
      cliente: { nome: `Cliente Exemplo ${pessoa}`, telefone: `119999900${String(pessoa).padStart(2, "0")}` },
      entrega: { tipo: sortear(['retirada', 'retirada', 'entrega']), data: iso(entrega), endereco: '' },
      itens, observacoes: '', total: itens.reduce((s, i) => s + i.precoUnit * i.quantidade, 0),
      status: idade > 5 ? sortear(['entregue', 'entregue', 'entregue', 'entregue', 'cancelado']) : sortear(['novo', 'confirmado', 'producao', 'pronto']),
    });
  }
  db.pedidos.sort((a, b) => a.criadoEm.localeCompare(b.criadoEm));
}

fs.writeFileSync(DB_FILE, JSON.stringify(db, null, 2));
console.log(`Pronto. Pedidos no banco: ${db.pedidos.length}`);
