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

  // ---- Notificações (src/notificacoes/). As credenciais ficam só aqui, no servidor: nunca vão para o banco, para
  // o painel nem para os backups. Canal sem credencial simplesmente não envia.
  // WhatsApp: API oficial da Meta (WhatsApp Cloud API). O token e o id do número saem do painel da Meta.
  WHATSAPP: {
    token: process.env.WHATSAPP_TOKEN || '',
    idDoNumero: process.env.WHATSAPP_PHONE_ID || '',
    // A versão da API faz parte do endereço; quando a Meta aposentar esta, basta trocar a variável.
    url: (process.env.WHATSAPP_API_URL || 'https://graph.facebook.com/v21.0').replace(/\/+$/, ''),
  },
  // SMS: Twilio. `de` é o número (ou o remetente) comprado na Twilio.
  SMS: {
    conta: process.env.SMS_TWILIO_SID || '',
    token: process.env.SMS_TWILIO_TOKEN || '',
    de: process.env.SMS_TWILIO_FROM || '',
    url: (process.env.SMS_API_URL || 'https://api.twilio.com').replace(/\/+$/, ''),
  },
  // Espera, em segundos, antes de cada nova tentativa de envio que falhou: 1 min, 5 min, 30 min, 2 h, 6 h.
  // Depois da última, a mensagem fica como "falhou" e só sai de novo se alguém mandar reenviar pelo painel.
  ESPERAS_NOTIFICACAO_S: (process.env.NOTIFICACOES_ESPERAS || '60,300,1800,7200,21600').split(',').map(Number).filter((n) => Number.isFinite(n) && n >= 0),
};
