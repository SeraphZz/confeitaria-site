'use strict';
// Utilidades HTTP usadas por todas as rotas: erros, respostas JSON, leitura do corpo, IP e limite de tentativas.

const { CONFIAR_NO_PROXY, PRODUCAO, SITE_URL } = require('./ambiente');

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
  // HSTS: depois da primeira visita, o navegador só fala com o site por HTTPS (por um ano), mesmo que alguém digite
  // ou receba um link http://. Só em produção: em casa o site roda sem HTTPS e o cabeçalho travaria o localhost.
  ...(PRODUCAO ? { 'Strict-Transport-Security': 'max-age=31536000' } : {}),
};

// Barra pedidos que alteram dados feitos a partir de outro site (CSRF): uma página qualquer, aberta no navegador de
// quem está logado, tentando agir em nome dessa pessoa. O navegador informa de onde o pedido saiu no cabeçalho
// Origin (ou Sec-Fetch-Site); só passa o que vem do próprio site. Pedidos sem nenhum dos dois não vêm de uma página
// (scripts, testes), e sem navegador não há cookie de outra pessoa para abusar.
const HOST_PUBLICO = (() => { try { return new URL(SITE_URL).host; } catch { return ''; } })();
function conferirOrigem(req) {
  const recusar = () => new ErroHttp(403, 'Pedido recusado: não veio deste site. Recarregue a página e tente de novo.');
  const origem = req.headers.origin;
  if (origem === undefined) {
    const relacao = req.headers['sec-fetch-site'];
    if (relacao !== undefined && relacao !== 'same-origin' && relacao !== 'none') throw recusar();
    return;
  }
  let host = '';
  try { host = new URL(origem).host; } catch { /* "null" ou texto qualquer: recusado abaixo */ }
  // Vale o endereço pelo qual o pedido chegou (Host) ou o endereço público configurado em SITE_URL.
  if (!host || (host !== req.headers.host && host !== HOST_PUBLICO)) throw recusar();
}

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

// Limite de erros de senha por conta, somando todos os IPs: quem tenta adivinhar a senha de uma conta trocando de IP
// a cada tentativa escapa do limite por IP, mas não deste. Só os erros contam, e acertar a senha zera a contagem.
// Uso: `conferirBloqueio` antes de testar a senha; depois, `registrarErro` ou `zerarErros`.
const erros = new Map();
const ERROS_MAXIMO = 10;
const ERROS_JANELA_MS = 15 * 60 * 1000;

function conferirBloqueio(chave) {
  const reg = erros.get(chave);
  if (reg && reg.ate > Date.now() && reg.n >= ERROS_MAXIMO) {
    throw new ErroHttp(429, 'Muitas tentativas com senha errada nesta conta. Aguarde 15 minutos e tente de novo.');
  }
}

function registrarErro(chave) {
  const agora = Date.now();
  const reg = erros.get(chave);
  if (!reg || reg.ate < agora) erros.set(chave, { n: 1, ate: agora + ERROS_JANELA_MS });
  else reg.n++;
}

const zerarErros = (chave) => erros.delete(chave);

// Número da página pedido em "?pagina=" (a primeira é 1). Qualquer coisa fora disso vira 1.
function lerPagina(url) {
  const n = Number(url.searchParams.get('pagina'));
  return Number.isInteger(n) && n >= 1 && n <= 1_000_000 ? n : 1;
}

// Resposta de uma lista paginada: os itens da página e o necessário para a tela saber se há mais.
function pagina(itens, total, numero, porPagina) {
  return { itens, total, pagina: numero, paginas: Math.max(1, Math.ceil(total / porPagina)) };
}

// Faxina periódica de um Map cujos valores têm um campo com o horário de validade.
function limparVencidos(mapa, campo) {
  setInterval(() => {
    const agora = Date.now();
    for (const [k, v] of mapa) if (v[campo] < agora) mapa.delete(k);
  }, 10 * 60 * 1000).unref();
}
limparVencidos(tentativas, 'ate');
limparVencidos(erros, 'ate');

module.exports = {
  ErroHttp, CABECALHOS_SEGURANCA, enviarJson, lerJson, ipDe, lerCookie, limitar, limparVencidos,
  conferirOrigem, conferirBloqueio, registrarErro, zerarErros, lerPagina, pagina,
};
