'use strict';
// Gera pedidos de exemplo para ver o painel com dados: `npm run demo`.
// Os pedidos de exemplo têm o cliente "Cliente Exemplo N"; rode com --limpar para removê-los.

const crypto = require('node:crypto');
const banco = require('../banco');

const produtos = banco.listarProdutos();
if (!produtos.length) {
  console.error('Rode o servidor uma vez antes (node server.js) para criar o banco.');
  process.exit(1);
}

banco.transacao(() => {
  banco.apagarPedidosDemo();
  if (process.argv.includes('--limpar')) return;

  const sortear = (lista) => lista[Math.floor(Math.random() * lista.length)];
  const iso = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  for (let n = 1; n <= 60; n++) {
    const pessoa = 1 + Math.floor(Math.random() * 15); // 15 pessoas, cada uma com seu telefone
    const criado = new Date(Date.now() - Math.random() * 90 * 86400000);
    const idade = (Date.now() - criado) / 86400000;
    const itens = Array.from({ length: 1 + Math.floor(Math.random() * 3) }, () => {
      const produto = sortear(produtos);
      return { produtoId: produto.id, nome: produto.nome, precoUnit: produto.preco, quantidade: produto.preco < 2000 ? 6 + Math.floor(Math.random() * 30) : 1, observacoes: '' };
    });
    const entrega = new Date(criado.getTime() + 3 * 86400000);
    banco.inserirPedido({
      demo: true, id: crypto.randomUUID(), criadoEm: criado.toISOString(),
      cliente: { nome: `Cliente Exemplo ${pessoa}`, telefone: `119999900${String(pessoa).padStart(2, '0')}` },
      entrega: { tipo: sortear(['retirada', 'retirada', 'entrega']), data: iso(entrega), endereco: '' },
      itens, observacoes: '', total: itens.reduce((s, i) => s + i.precoUnit * i.quantidade, 0),
      status: idade > 5 ? sortear(['entregue', 'entregue', 'entregue', 'entregue', 'cancelado']) : sortear(['novo', 'confirmado', 'producao', 'pronto']),
    });
  }
});

console.log(`Pronto. Pedidos no banco: ${banco.listarPedidos().length}`);
