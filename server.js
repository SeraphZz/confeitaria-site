'use strict';
// Ponto de entrada: sobe o servidor HTTP e encaminha cada pedido para a rota certa.
// Node puro, sem dependências (não precisa de `npm install`). O código fica em src/:
//   src/rotas/*.js   as rotas da API, agrupadas por assunto
//   src/*.js         sessão, senhas, validação, pedidos, imagens, arquivos estáticos
//   banco.js         camada de dados (SQLite); migracoes/ guarda a estrutura das tabelas

const http = require('node:http');
const { PORTA, HOST } = require('./src/ambiente');
const { ErroHttp, enviarJson, conferirOrigem } = require('./src/http');
const { ehAdmin } = require('./src/sessao');
const { servirEstatico } = require('./src/estaticos');
const { garantirDadosIniciais } = require('./src/primeiro-uso');

garantirDadosIniciais();

// Cada rota é [método, caminho, handler, exigeAdmin].
const rotas = [
  ...require('./src/rotas/contas'),
  ...require('./src/rotas/catalogo'),
  ...require('./src/rotas/pedidos'),
  ...require('./src/rotas/loja'),
];

async function atender(req, res) {
  const url = new URL(req.url, 'http://localhost');
  let caminho;
  try { caminho = decodeURIComponent(url.pathname); } catch { throw new ErroHttp(400, 'Endereço inválido.'); }

  if (!caminho.startsWith('/api/')) {
    if (req.method !== 'GET' && req.method !== 'HEAD') throw new ErroHttp(405, 'Método não permitido.');
    return servirEstatico(req, caminho, res, url.search);
  }

  // Tudo o que altera dados só é aceito se o pedido saiu de uma página do próprio site (ver src/http.js).
  if (req.method !== 'GET' && req.method !== 'HEAD') conferirOrigem(req);

  for (const [metodo, re, handler, exigeAdmin] of rotas) {
    const m = metodo === req.method && re.exec(caminho);
    if (!m) continue;
    if (exigeAdmin && !ehAdmin(req)) throw new ErroHttp(401, 'Faça login para continuar.');
    return enviarJson(res, 200, await handler(req, m.slice(1), res, url));
  }
  throw new ErroHttp(404, 'Rota não encontrada.');
}

http.createServer((req, res) => {
  atender(req, res).catch((erro) => {
    if (res.headersSent) return res.end();
    if (erro instanceof ErroHttp) return enviarJson(res, erro.status, { erro: erro.message });
    console.error(erro);
    enviarJson(res, 500, { erro: 'Erro interno. Tente novamente.' });
  });
}).listen(PORTA, HOST, () => {
  console.log(`Loja no ar: http://localhost:${PORTA}  (painel: /login)`);
});
