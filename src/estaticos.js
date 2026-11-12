'use strict';
// Páginas (pages/*.html) e arquivos estáticos (css, js e fotos enviadas).

const fs = require('node:fs');
const path = require('node:path');
const { RAIZ } = require('./ambiente');
const { CABECALHOS_SEGURANCA } = require('./http');
const { UPLOADS_DIR } = require('./imagens');

const PAGINAS = [
  [/^\/$/, 'index.html'],
  [/^\/doce\/[a-z0-9-]+$/, 'doce.html'],
  [/^\/sobre$/, 'sobre.html'],
  [/^\/carrinho$/, 'carrinho.html'],
  [/^\/login$/, 'login.html'],
  [/^\/cadastro$/, 'cadastro.html'],
  [/^\/conta$/, 'conta.html'],
  [/^\/esqueci-senha$/, 'esqueci-senha.html'],
  [/^\/redefinir-senha$/, 'redefinir-senha.html'],
  [/^\/admin$/, 'admin.html'],
];

const PASTAS_ESTATICAS = { css: path.join(RAIZ, 'css'), js: path.join(RAIZ, 'js'), uploads: UPLOADS_DIR };

const MIME = {
  '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.map': 'application/json', '.json': 'application/json', '.jpg': 'image/jpeg', '.png': 'image/png', '.webp': 'image/webp',
};

function enviarArquivo(res, arquivo, status = 200) {
  const tipo = MIME[path.extname(arquivo).toLowerCase()];
  fs.readFile(arquivo, (erro, conteudo) => {
    if (erro || !tipo) return enviarArquivo404(res);
    res.writeHead(status, { 'Content-Type': tipo, 'Cache-Control': 'no-cache', ...CABECALHOS_SEGURANCA });
    res.end(conteudo);
  });
}

function enviarArquivo404(res) {
  res.writeHead(404, { 'Content-Type': 'text/html; charset=utf-8', ...CABECALHOS_SEGURANCA });
  res.end('<!doctype html><meta charset="utf-8"><title>Não encontrado</title><p style="font-family:sans-serif;padding:2rem">Página não encontrada. <a href="/">Voltar ao início</a></p>');
}

function servirEstatico(caminho, res) {
  const pagina = PAGINAS.find(([re]) => re.test(caminho));
  if (pagina) return enviarArquivo(res, path.join(RAIZ, 'pages', pagina[1]));

  const [, pasta, ...resto] = caminho.split('/');
  const base = PASTAS_ESTATICAS[pasta];
  if (!base || !resto.length) return enviarArquivo404(res);
  // path.resolve + verificação de prefixo impede sair da pasta com "../".
  const arquivo = path.resolve(base, resto.join('/'));
  if (!arquivo.startsWith(base + path.sep)) return enviarArquivo404(res);
  enviarArquivo(res, arquivo);
}

module.exports = { servirEstatico };
