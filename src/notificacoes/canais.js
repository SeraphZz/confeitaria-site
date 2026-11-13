'use strict';
// Canais de notificação. Cada canal sabe quatro coisas:
//   configurado   se o servidor tem as credenciais dele (variáveis de ambiente; ver src/ambiente.js e email.js);
//   destino       o endereço de uma pessoa neste canal (e-mail ou telefone), ou '' se ela não tem;
//   montar        transforma o modelo da loja + os dados do pedido no conteúdo pronto para enviar (ou null);
//   enviar        entrega o conteúdo. Devolve { idExterno } ou lança ErroEnvio.
//
// Para criar um canal novo (ex.: push do navegador): acrescente aqui, em CANAIS de modelos.js e no CHECK da tabela.
// Sem dependências: o e-mail usa o email.js do projeto; WhatsApp e SMS usam o `fetch` do próprio Node.

const email = require('../../email');
const { WHATSAPP, SMS } = require('../ambiente');
const { preencher } = require('./modelos');

// `permanente`: tentar de novo não adianta (número inválido, modelo recusado, credencial errada). Sem isso, o
// envio é tentado de novo mais tarde (serviço fora do ar, limite de envios, queda de rede).
class ErroEnvio extends Error {
  constructor(mensagem, { permanente = false } = {}) { super(mensagem); this.permanente = permanente; }
}

const TEMPO_LIMITE_MS = 15000;

// Telefone como os serviços pedem: só dígitos, com o código do país. Os telefones do sistema têm DDD e, quase
// sempre, não têm o 55.
function telefoneInternacional(telefone) {
  const digitos = String(telefone || '').replace(/\D/g, '');
  if (digitos.length === 10 || digitos.length === 11) return `55${digitos}`;
  return digitos.length >= 12 && digitos.length <= 15 ? digitos : '';
}

// Chamada a um serviço de envio. Erro 4xx (menos 429) é definitivo; 429, 5xx e falha de rede valem nova tentativa.
async function chamar(url, opcoes, lerErro) {
  let resposta;
  try {
    resposta = await fetch(url, { ...opcoes, signal: AbortSignal.timeout(TEMPO_LIMITE_MS), redirect: 'error' });
  } catch (erro) {
    throw new ErroEnvio(erro.name === 'TimeoutError' ? 'O serviço de envio não respondeu a tempo.' : 'Não foi possível falar com o serviço de envio.');
  }
  const corpo = await resposta.json().catch(() => ({}));
  if (resposta.ok) return corpo;
  const detalhe = String(lerErro(corpo) || '').slice(0, 200);
  throw new ErroEnvio(`O serviço de envio recusou (${resposta.status})${detalhe ? `: ${detalhe}` : '.'}`,
    { permanente: resposta.status >= 400 && resposta.status < 500 && resposta.status !== 429 });
}

const CANAIS = {
  email: {
    nome: 'E-mail',
    configurado: email.configurado,
    destino: (pessoa) => (/^[^\s<>]+@[^\s<>]+$/.test(pessoa.email || '') ? pessoa.email : ''),
    montar: (modelo, dados) => ({ assunto: preencher(modelo.assunto, dados).replace(/[\r\n]+/g, ' ').slice(0, 200), corpo: preencher(modelo.corpo, dados), remetente: dados.loja }),
    resumo: (conteudo) => conteudo.assunto,
    async enviar(destinatario, conteudo) {
      try {
        await email.enviarEmail({ para: destinatario, assunto: conteudo.assunto, texto: conteudo.corpo, nomeRemetente: conteudo.remetente || '' });
      } catch (erro) {
        // "Servidor de e-mail respondeu: 550 ...": os códigos 5xx do SMTP são recusas definitivas.
        throw new ErroEnvio(erro.message, { permanente: /respondeu: 5\d\d|Destinatário inválido/.test(erro.message) });
      }
      return { idExterno: '' };
    },
  },

  whatsapp: {
    nome: 'WhatsApp',
    configurado: Boolean(WHATSAPP.token && WHATSAPP.idDoNumero),
    destino: (pessoa) => telefoneInternacional(pessoa.telefone),
    // Sem nome de modelo não há o que enviar. Os campos do modelo não aceitam quebra de linha nem espaços seguidos.
    montar: (modelo, dados) => (modelo.modelo ? {
      modelo: modelo.modelo, idioma: modelo.idioma,
      parametros: modelo.parametros.map((nome) => String(dados[nome] ?? '').replace(/\s+/g, ' ').trim().slice(0, 300) || '-'),
    } : null),
    resumo: (conteudo) => `modelo ${conteudo.modelo}${conteudo.parametros.length ? `: ${conteudo.parametros.join(' | ')}` : ''}`,
    async enviar(destinatario, conteudo) {
      const resposta = await chamar(`${WHATSAPP.url}/${encodeURIComponent(WHATSAPP.idDoNumero)}/messages`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${WHATSAPP.token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          messaging_product: 'whatsapp', to: destinatario, type: 'template',
          template: {
            name: conteudo.modelo, language: { code: conteudo.idioma },
            ...(conteudo.parametros.length ? { components: [{ type: 'body', parameters: conteudo.parametros.map((text) => ({ type: 'text', text })) }] } : {}),
          },
        }),
      }, (corpo) => corpo.error?.message);
      return { idExterno: String(resposta.messages?.[0]?.id || '') };
    },
  },

  sms: {
    nome: 'SMS',
    configurado: Boolean(SMS.conta && SMS.token && SMS.de),
    destino: (pessoa) => telefoneInternacional(pessoa.telefone),
    montar: (modelo, dados) => ({ corpo: preencher(modelo.corpo, dados).replace(/\s+/g, ' ').trim().slice(0, 480) }),
    resumo: (conteudo) => conteudo.corpo,
    async enviar(destinatario, conteudo) {
      const resposta = await chamar(`${SMS.url}/2010-04-01/Accounts/${encodeURIComponent(SMS.conta)}/Messages.json`, {
        method: 'POST',
        headers: { Authorization: `Basic ${Buffer.from(`${SMS.conta}:${SMS.token}`).toString('base64')}`, 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({ To: `+${destinatario}`, From: SMS.de, Body: conteudo.corpo }).toString(),
      }, (corpo) => corpo.message);
      return { idExterno: String(resposta.sid || '') };
    },
  },
};

module.exports = { CANAIS, ErroEnvio, telefoneInternacional };
