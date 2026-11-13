'use strict';
// Rotas de entrada e de conta: login (loja e clientes), cadastro, senha esquecida, dados e pedidos do cliente.

const crypto = require('node:crypto');
const banco = require('../../banco');
const { ErroHttp, lerJson, ipDe, limitar, conferirBloqueio, registrarErro, zerarErros, lerPagina, pagina } = require('../http');
const { texto, lerEmail, lerTelefone, lerEndereco } = require('../validacao');
const { senhaConfere, novaSenha } = require('../senhas');
const { clienteLogado, exigirCliente, abrirSessao, encerrarSessao, derrubarSessoesDoCliente, ehAdmin } = require('../sessao');
const { enviarLinkRedefinicao, conferirToken } = require('../redefinicao');
const configuracoes = require('../configuracoes');
const { temaPara, temRascunho } = require('../aparencia');

const PEDIDOS_POR_PAGINA = 20; // histórico em "Minha conta"

// O que pode sair do servidor sobre um cliente (nunca salt/hash).
function clientePublico(c) {
  return c && { id: c.id, nome: c.nome, email: c.email, telefone: c.telefone, endereco: c.endereco };
}

module.exports = [
  ['GET', /^\/api\/site$/, (req) => {
    const admin = ehAdmin(req);
    return {
      // Só as seções marcadas como públicas em src/configuracoes.js saem daqui.
      ...configuracoes.publicas(), admin, cliente: clientePublico(clienteLogado(req)),
      // Quem está no painel navega vendo o rascunho da aparência, se houver; `previaTema` avisa a tela disso.
      tema: temaPara(admin), previaTema: admin && temRascunho(),
    };
  }],

  ['POST', /^\/api\/login$/, async (req, _p, res) => {
    limitar(`login:${ipDe(req)}`, 8, 15 * 60 * 1000);
    // Login único: a loja entra com o usuário dela; clientes, com o e-mail.
    const { usuario, senha } = await lerJson(req);
    const login = typeof usuario === 'string' ? usuario.trim().toLowerCase() : '';
    // Além do limite por IP, cada conta aceita poucos erros de senha seguidos, venham de onde vierem. A contagem é
    // pelo que foi digitado, exista a conta ou não: assim o bloqueio também não revela quem é cliente.
    const conta = `login:${login.slice(0, 120)}`;
    conferirBloqueio(conta);
    const recusar = () => { registrarErro(conta); return new ErroHttp(401, 'E-mail/usuário ou senha incorretos.'); };

    const admin = configuracoes.ler('admin');
    if (login === admin.usuario) {
      if (!senhaConfere(senha, admin)) throw recusar();
      zerarErros(conta);
      abrirSessao(res, { tipo: 'admin' });
      return { tipo: 'admin' };
    }
    const cliente = banco.clientePorEmail(login);
    // Sem conta, confere contra um hash qualquer: a resposta demora o mesmo tanto e não revela se o e-mail existe.
    const senhaOk = senhaConfere(senha, cliente || admin);
    if (!cliente || !senhaOk) throw recusar();
    zerarErros(conta);
    abrirSessao(res, { tipo: 'cliente', clienteId: cliente.id });
    return { tipo: 'cliente' };
  }],

  ['POST', /^\/api\/cadastro$/, async (req, _p, res) => {
    limitar(`cadastro:${ipDe(req)}`, 5, 60 * 60 * 1000);
    const corpo = await lerJson(req);
    const emailNovo = lerEmail(corpo.email);
    if (banco.clientePorEmail(emailNovo)) throw new ErroHttp(409, 'Já existe uma conta com este e-mail. Tente entrar.');
    const cliente = {
      id: crypto.randomUUID(), email: emailNovo,
      nome: texto(corpo.nome, { max: 80, obrigatorio: true, campo: 'nome' }),
      telefone: lerTelefone(corpo.telefone),
      endereco: lerEndereco(corpo.endereco, false),
      ...novaSenha(corpo.senha), criadoEm: new Date().toISOString(),
    };
    banco.salvarCliente(cliente);
    abrirSessao(res, { tipo: 'cliente', clienteId: cliente.id });
    return clientePublico(cliente);
  }],

  // Responde sempre igual, exista a conta ou não, para não revelar quem é cliente.
  ['POST', /^\/api\/senha\/esqueci$/, async (req) => {
    limitar(`esqueci:${ipDe(req)}`, 5, 60 * 60 * 1000);
    const corpo = await lerJson(req);
    const login = typeof corpo.email === 'string' ? corpo.email.trim().toLowerCase() : '';
    const cliente = banco.clientePorEmail(login);
    if (cliente) {
      // No máximo 3 e-mails por hora para a mesma conta, sem avisar quem pediu (evita lotar a caixa de alguém).
      try { limitar(`esqueci-conta:${cliente.id}`, 3, 60 * 60 * 1000); enviarLinkRedefinicao(cliente); } catch { /* limite atingido */ }
    }
    return { ok: true };
  }],

  ['POST', /^\/api\/senha\/redefinir$/, async (req) => {
    limitar(`redefinir:${ipDe(req)}`, 10, 15 * 60 * 1000);
    const { token, senha } = await lerJson(req);
    const { cliente, gastar } = conferirToken(token);
    if (!cliente) throw new ErroHttp(400, 'Este link expirou ou já foi usado. Peça um novo.');
    Object.assign(cliente, novaSenha(senha)); // se a senha for inválida, lança antes de gastar o link
    gastar();
    banco.salvarCliente(cliente);
    derrubarSessoesDoCliente(cliente.id);
    return { ok: true };
  }],

  ['PUT', /^\/api\/conta$/, async (req) => {
    const cliente = exigirCliente(req);
    const corpo = await lerJson(req);
    const nome = texto(corpo.nome, { max: 80, obrigatorio: true, campo: 'nome' });
    const telefone = lerTelefone(corpo.telefone);
    const endereco = lerEndereco(corpo.endereco, false);
    if (corpo.novaSenha) {
      limitar(`senha:${ipDe(req)}`, 8, 15 * 60 * 1000);
      const conta = `senha:${cliente.id}`;
      conferirBloqueio(conta);
      if (!senhaConfere(corpo.senhaAtual, cliente)) { registrarErro(conta); throw new ErroHttp(400, 'A senha atual não confere.'); }
      zerarErros(conta);
      Object.assign(cliente, novaSenha(corpo.novaSenha));
    }
    Object.assign(cliente, { nome, telefone, endereco });
    banco.salvarCliente(cliente);
    return clientePublico(cliente);
  }],

  ['GET', /^\/api\/conta\/pedidos$/, (req, _p, _res, url) => {
    const cliente = exigirCliente(req);
    // Do mais novo para o mais antigo, uma página por vez (?pagina=2...).
    const numero = lerPagina(url);
    const { pedidos, total } = banco.paginarPedidos({ clienteId: cliente.id, pagina: numero, porPagina: PEDIDOS_POR_PAGINA });
    const resumidos = pedidos.map(({ numero: n, criadoEm, entrega, itens, total: valor, status }) => ({ numero: n, criadoEm, entrega, itens, total: valor, status }));
    return pagina(resumidos, total, numero, PEDIDOS_POR_PAGINA);
  }],

  ['POST', /^\/api\/logout$/, (req, _p, res) => {
    encerrarSessao(req, res);
    return { ok: true };
  }],
];
