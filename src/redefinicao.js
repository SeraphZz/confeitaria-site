'use strict';
// "Esqueci minha senha": link de uso único enviado por e-mail, válido por 30 minutos.

const crypto = require('node:crypto');
const banco = require('../banco');
const email = require('../email');
const configuracoes = require('./configuracoes');
const { PRODUCAO, SITE_URL } = require('./ambiente');
const { limparVencidos } = require('./http');

// sha256(token) -> { clienteId, validade }. Guardamos só o hash: quem ler a memória/logs não consegue usar o link.
const redefinicoes = new Map();
limparVencidos(redefinicoes, 'validade');
const REDEFINICAO_MS = 30 * 60 * 1000;
const hashToken = (token) => crypto.createHash('sha256').update(String(token)).digest('hex');

function enviarLinkRedefinicao(cliente) {
  for (const [h, r] of redefinicoes) if (r.clienteId === cliente.id) redefinicoes.delete(h); // só o link mais recente vale
  const token = crypto.randomBytes(32).toString('hex');
  redefinicoes.set(hashToken(token), { clienteId: cliente.id, validade: Date.now() + REDEFINICAO_MS });
  // O token vai depois do "#": essa parte do endereço não é enviada ao servidor nem aparece em logs de acesso.
  const link = `${SITE_URL}/redefinir-senha#${token}`;

  if (!email.configurado) {
    if (PRODUCAO) return console.error('Redefinição de senha pedida, mas o SMTP não está configurado (veja o README).');
    return console.log(`\n[e-mail não configurado] Link de redefinição para ${cliente.email}:\n${link}\n`);
  }
  const loja = configuracoes.ler('loja');
  email.enviarEmail({
    para: cliente.email, nomeRemetente: loja.nome, assunto: `Redefinir sua senha - ${loja.nome}`,
    texto: `Olá, ${cliente.nome}!\n\nRecebemos um pedido para redefinir a senha da sua conta em ${loja.nome}.\n` +
      `Para criar uma nova senha, abra o link abaixo (ele vale por 30 minutos):\n\n${link}\n\n` +
      'Se não foi você, é só ignorar este e-mail: sua senha continua a mesma.\n',
  }).catch((erro) => console.error('Falha ao enviar e-mail de redefinição:', erro.message));
}

// Devolve o cliente dono de um link ainda válido (ou null) e uma função para gastar o link.
function conferirToken(token) {
  const chave = hashToken(typeof token === 'string' ? token : '');
  const pedido = redefinicoes.get(chave);
  const cliente = (pedido && pedido.validade > Date.now() && banco.clientePorId(pedido.clienteId)) || null;
  return { cliente, gastar: () => redefinicoes.delete(chave) };
}

module.exports = { enviarLinkRedefinicao, conferirToken };
