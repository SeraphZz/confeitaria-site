'use strict';
// Tudo o que vem de variáveis de ambiente fica aqui: é o que muda de uma instalação para outra no servidor.
// (As credenciais de SMTP continuam sendo lidas em email.js.)

const path = require('node:path');

const PORTA = Number(process.env.PORT) || 3000;

module.exports = {
  RAIZ: path.join(__dirname, '..'),
  PORTA,
  // HOST=127.0.0.1 faz o servidor aceitar só conexões da própria máquina (do proxy HTTPS). Sem HOST, aceita de qualquer lugar.
  HOST: process.env.HOST,
  PRODUCAO: process.env.NODE_ENV === 'production',
  // Endereço público do site, usado nos links enviados por e-mail. Nunca é lido da requisição:
  // o cabeçalho Host é controlado por quem faz o pedido e poderia apontar o link para outro site.
  SITE_URL: (process.env.SITE_URL || `http://localhost:${PORTA}`).replace(/\/+$/, ''),
  // Atrás de um proxy (HTTPS da hospedagem, Caddy, Nginx) a conexão chega sempre com o IP do proxy, e o IP real vem
  // no cabeçalho X-Forwarded-For. Só confiamos nele com TRUST_PROXY=1, porque sem proxy qualquer pessoa pode inventá-lo.
  CONFIAR_NO_PROXY: process.env.TRUST_PROXY === '1',
  SENHA_INICIAL_ADMIN: process.env.ADMIN_PASSWORD || '',
};
