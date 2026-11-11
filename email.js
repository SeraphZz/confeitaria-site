'use strict';
// Envio de e-mail por SMTP, sem dependências. Configurado por variáveis de ambiente:
//   SMTP_HOST, SMTP_USER, SMTP_PASS  (obrigatórias para enviar de verdade)
//   SMTP_PORT  465 (padrão, TLS direto) ou 587 (STARTTLS)
//   SMTP_MODO  opcional: "tls" ou "starttls", só para portas fora do padrão
//   SMTP_FROM  endereço do remetente (padrão: SMTP_USER)
// A senha só trafega depois que a conexão está criptografada e o certificado do servidor foi validado.

const net = require('node:net');
const tls = require('node:tls');
const crypto = require('node:crypto');

const cfg = {
  host: process.env.SMTP_HOST || '',
  port: Number(process.env.SMTP_PORT) || 465,
  user: process.env.SMTP_USER || '',
  pass: process.env.SMTP_PASS || '',
  from: process.env.SMTP_FROM || process.env.SMTP_USER || '',
};
const configurado = Boolean(cfg.host && cfg.user && cfg.pass && /^[^\s<>]+@[^\s<>]+$/.test(cfg.from));
const TEMPO_LIMITE_MS = 15000;

// Texto com acento em cabeçalho precisa ir codificado (RFC 2047).
function cabecalho(valor) {
  const limpo = String(valor).replace(/[\r\n]+/g, ' ');
  return /^[\x20-\x7e]*$/.test(limpo) ? limpo.replace(/["\\]/g, '') : `=?UTF-8?B?${Buffer.from(limpo).toString('base64')}?=`;
}

function preparar(socket) {
  socket.setEncoding('utf8');
  socket.setTimeout(TEMPO_LIMITE_MS, () => socket.destroy(new Error('Tempo esgotado falando com o servidor de e-mail.')));
  return socket;
}

// Envia uma linha (ou só espera, se linha for null) e confere o código da resposta do servidor.
function comando(socket, linha, codigoEsperado) {
  return new Promise((resolve, reject) => {
    let recebido = '';
    const parar = () => { socket.off('data', aoReceber); socket.off('error', falhar); socket.off('close', aoFechar); };
    const falhar = (erro) => { parar(); reject(erro); };
    const aoFechar = () => falhar(new Error('O servidor de e-mail fechou a conexão.'));
    const aoReceber = (parte) => {
      recebido += parte;
      if (!recebido.endsWith('\n')) return;
      // Respostas podem ter várias linhas ("250-..."); a última tem espaço depois do código ("250 ...").
      const final = recebido.split(/\r?\n/).find((l) => /^\d{3} /.test(l));
      if (!final) return;
      parar();
      if (final.startsWith(codigoEsperado)) resolve();
      else reject(new Error(`Servidor de e-mail respondeu: ${final.slice(0, 200)}`));
    };
    socket.on('data', aoReceber);
    socket.on('error', falhar);
    socket.on('close', aoFechar);
    if (linha !== null) socket.write(linha + '\r\n');
  });
}

async function enviarEmail({ para, assunto, texto, nomeRemetente = '' }) {
  if (!configurado) throw new Error('SMTP não configurado.');
  // `para` vai dentro de um comando SMTP: nada de espaço, quebra de linha ou <>.
  if (!/^[^\s<>]+@[^\s<>]+$/.test(para)) throw new Error('Destinatário inválido.');

  // Nome simples vai entre aspas; nome com acento vira "palavra codificada", que não pode ficar entre aspas.
  const nome = cabecalho(nomeRemetente.slice(0, 30));
  const mensagem = [
    `From: ${nome ? `${nome.startsWith('=?') ? nome : `"${nome}"`} ` : ''}<${cfg.from}>`,
    `To: <${para}>`,
    `Subject: ${cabecalho(assunto)}`,
    `Date: ${new Date().toUTCString().replace('GMT', '+0000')}`,
    `Message-ID: <${crypto.randomUUID()}@${cfg.from.split('@')[1]}>`,
    'MIME-Version: 1.0',
    'Content-Type: text/plain; charset=utf-8',
    'Content-Transfer-Encoding: base64',
    '',
    // base64 em linhas de 76 caracteres: nunca contém uma linha só com "." (que encerraria a mensagem).
    Buffer.from(texto).toString('base64').replace(/(.{76})/g, '$1\r\n'),
  ].join('\r\n');

  // Porta 465 fala TLS desde o início; as demais começam em texto e sobem para TLS com STARTTLS.
  // SMTP_MODO=tls ou SMTP_MODO=starttls força um dos dois, para provedores com porta fora do padrão.
  const tlsDireto = process.env.SMTP_MODO ? process.env.SMTP_MODO === 'tls' : cfg.port === 465;
  let socket = preparar(tlsDireto
    ? tls.connect({ host: cfg.host, port: cfg.port, servername: cfg.host })
    : net.connect({ host: cfg.host, port: cfg.port }));
  try {
    await comando(socket, null, '220');
    await comando(socket, 'EHLO localhost', '250');
    if (!tlsDireto) {
      await comando(socket, 'STARTTLS', '220');
      socket = preparar(tls.connect({ socket, servername: cfg.host }));
      await new Promise((resolve, reject) => { socket.once('secureConnect', resolve); socket.once('error', reject); });
      await comando(socket, 'EHLO localhost', '250');
    }
    await comando(socket, `AUTH PLAIN ${Buffer.from(`\0${cfg.user}\0${cfg.pass}`).toString('base64')}`, '235');
    await comando(socket, `MAIL FROM:<${cfg.from}>`, '250');
    await comando(socket, `RCPT TO:<${para}>`, '25');
    await comando(socket, 'DATA', '354');
    await comando(socket, `${mensagem}\r\n.`, '250');
    await comando(socket, 'QUIT', '221').catch(() => {}); // a mensagem já foi aceita
  } finally {
    socket.destroy();
  }
}

module.exports = { enviarEmail, configurado };
