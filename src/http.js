'use strict';
// Utilidades HTTP usadas por todas as rotas: erros, respostas JSON, leitura do corpo, IP e limite de tentativas.

const { CONFIAR_NO_PROXY } = require('./ambiente');

class ErroHttp extends Error {
  constructor(status, mensagem) { super(mensagem); this.status = status; }
}

const CABECALHOS_SEGURANCA = {
  'X-Content-Type-Options': 'nosniff',
  'X-Frame-Options': 'DENY',
  'Referrer-Policy': 'same-origin',
  'Content-Security-Policy':
    // connect-src libera só a consulta de CEP (ViaCEP) feita pelo navegador.
    "default-src 'self'; img-src 'self' data: blob:; style-src 'self' 'unsafe-inline'; script-src 'self'; " +
    "connect-src 'self' https://viacep.com.br; frame-ancestors 'none'",
};

function enviarJson(res, status, corpo, extras = {}) {
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store',
    ...CABECALHOS_SEGURANCA, ...extras,
  });
  res.end(JSON.stringify(corpo));
}

function lerJson(req, limiteBytes = 100 * 1024) {
  return new Promise((resolve, reject) => {
    if (!/^application\/json\b/i.test(req.headers['content-type'] || '')) {
      return reject(new ErroHttp(415, 'Envie os dados como JSON.'));
    }
    const partes = [];
    let tamanho = 0;
    req.on('data', (parte) => {
      tamanho += parte.length;
      if (tamanho > limiteBytes) {
        reject(new ErroHttp(413, 'Conteúdo grande demais.'));
        req.destroy();
        return;
      }
      partes.push(parte);
    });
    req.on('end', () => {
      try {
        const corpo = JSON.parse(Buffer.concat(partes).toString('utf8') || '{}');
        if (!corpo || typeof corpo !== 'object' || Array.isArray(corpo)) throw new Error();
        resolve(corpo);
      } catch {
        reject(new ErroHttp(400, 'JSON inválido.'));
      }
    });
    req.on('error', reject);
  });
}

// IP de quem fez o pedido. Com TRUST_PROXY=1 vale o último item do X-Forwarded-For: é o que o proxy escreveu.
function ipDe(req) {
  const encaminhado = CONFIAR_NO_PROXY && String(req.headers['x-forwarded-for'] || '').split(',').pop().trim();
  return encaminhado || req.socket.remoteAddress;
}

function lerCookie(req, nome) {
  for (const par of (req.headers.cookie || '').split(';')) {
    const [k, ...v] = par.trim().split('=');
    if (k === nome) return v.join('=');
  }
  return '';
}

// Limite simples de tentativas por chave (IP ou conta), em memória.
const tentativas = new Map();
function limitar(chave, maximo, janelaMs) {
  const agora = Date.now();
  const reg = tentativas.get(chave);
  if (!reg || reg.ate < agora) {
    tentativas.set(chave, { n: 1, ate: agora + janelaMs });
    return;
  }
  if (++reg.n > maximo) throw new ErroHttp(429, 'Muitas tentativas. Aguarde alguns minutos e tente de novo.');
}

// Faxina periódica de um Map cujos valores têm um campo com o horário de validade.
function limparVencidos(mapa, campo) {
  setInterval(() => {
    const agora = Date.now();
    for (const [k, v] of mapa) if (v[campo] < agora) mapa.delete(k);
  }, 10 * 60 * 1000).unref();
}
limparVencidos(tentativas, 'ate');

module.exports = { ErroHttp, CABECALHOS_SEGURANCA, enviarJson, lerJson, ipDe, lerCookie, limitar, limparVencidos };
