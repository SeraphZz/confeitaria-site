'use strict';
// Banco vazio (primeira execução): cria a loja de exemplo e a conta de acesso ao painel.

const crypto = require('node:crypto');
const banco = require('../banco');
const { SENHA_INICIAL_ADMIN } = require('./ambiente');
const { gerarHash, sortearSenha } = require('./senhas');
const configuracoes = require('./configuracoes');

function criarSlug(nome, existentes) {
  const base = nome.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()
    .replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'produto';
  let slug = base;
  for (let i = 2; existentes.includes(slug); i++) slug = `${base}-${i}`;
  return slug;
}

function criarDadosIniciais() {
  const seed = require('../seed');
  const senha = SENHA_INICIAL_ADMIN || sortearSenha();
  banco.transacao(() => {
    const slugs = [];
    for (const d of seed.produtos) {
      const slug = criarSlug(d.nome, slugs);
      slugs.push(slug);
      banco.salvarProduto({
        id: crypto.randomUUID(), slug, nome: d.nome, descricao: d.descricao, preco: d.preco,
        unidade: d.unidade, emoji: d.emoji, imagem: '', disponivel: true,
      });
    }
    configuracoes.substituir('loja', seed.loja);
    configuracoes.substituir('sobre', seed.sobre);
    configuracoes.substituir('catalogo', seed.catalogo);
    configuracoes.substituir('admin', { usuario: 'confeiteira', ...gerarHash(senha), senhaInicial: true });
  });
  if (!SENHA_INICIAL_ADMIN) {
    console.log('\n==============================================');
    console.log(' Primeiro acesso da confeiteira');
    console.log(' Usuário: confeiteira');
    console.log(` Senha:   ${senha}`);
    console.log(' Troque a senha em Painel > Configurações.');
    console.log('==============================================\n');
  }
}

function garantirDadosIniciais() {
  if (!configuracoes.ler('admin')) criarDadosIniciais();
}

module.exports = { criarSlug, garantirDadosIniciais };
