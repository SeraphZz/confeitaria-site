'use strict';
// Backend da confeitaria — Node puro, sem dependências (não precisa de `npm install`).
// Dados ficam em data/db.json; fotos enviadas em data/uploads/.

const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

const PORT = Number(process.env.PORT) || 3000;
const ROOT = __dirname;
const DATA_DIR = process.env.DATA_DIR ? path.resolve(process.env.DATA_DIR) : path.join(ROOT, 'data');
const DB_FILE = path.join(DATA_DIR, 'db.json');
const UPLOADS_DIR = path.join(DATA_DIR, 'uploads');
const PRODUCAO = process.env.NODE_ENV === 'production';
// Endereço público do site, usado nos links enviados por e-mail. Nunca é lido da requisição:
// o cabeçalho Host é controlado por quem faz o pedido e poderia apontar o link para outro site.
const SITE_URL = (process.env.SITE_URL || `http://localhost:${PORT}`).replace(/\/+$/, '');
const email = require('./email');

const STATUS = ['novo', 'confirmado', 'producao', 'pronto', 'entregue', 'cancelado'];
const STATUS_ABERTOS = ['novo', 'confirmado', 'producao', 'pronto'];
const SESSAO_MS = 12 * 60 * 60 * 1000;

// ---------------------------------------------------------------- banco (arquivo JSON)

function ENDERECO_VAZIO() {
  return { cep: '', rua: '', numero: '', complemento: '', bairro: '', cidade: '', uf: '' };
}

function hashSenha(senha, salt) {
  return crypto.scryptSync(senha, salt, 64).toString('hex');
}

function criarSlug(nome, existentes) {
  const base = nome.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()
    .replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'doce';
  let slug = base;
  for (let i = 2; existentes.includes(slug); i++) slug = `${base}-${i}`;
  return slug;
}

function criarBanco() {
  const seed = require('./seed');
  const senha = process.env.ADMIN_PASSWORD || crypto.randomBytes(9).toString('base64url');
  const salt = crypto.randomBytes(16).toString('hex');
  const doces = [];
  for (const d of seed.doces) {
    doces.push({
      id: crypto.randomUUID(), slug: criarSlug(d.nome, doces.map((x) => x.slug)),
      nome: d.nome, descricao: d.descricao, preco: d.preco, unidade: d.unidade,
      emoji: d.emoji, imagem: '', disponivel: true,
    });
  }
  if (!process.env.ADMIN_PASSWORD) {
    console.log('\n==============================================');
    console.log(' Primeiro acesso da confeiteira');
    console.log(' Usuário: confeiteira');
    console.log(` Senha:   ${senha}`);
    console.log(' Troque a senha em Painel > Configurações.');
    console.log('==============================================\n');
  }
  return {
    loja: seed.loja, sobre: seed.sobre, doces, pedidos: [], proximoNumero: 1,
    admin: { usuario: 'confeiteira', salt, hash: hashSenha(senha, salt), senhaInicial: true },
  };
}

fs.mkdirSync(UPLOADS_DIR, { recursive: true });
let db;
if (fs.existsSync(DB_FILE)) {
  db = JSON.parse(fs.readFileSync(DB_FILE, 'utf8'));
} else {
  db = criarBanco();
  salvar();
}
db.clientes ||= []; // bancos criados antes do cadastro de clientes
for (const c of db.clientes) {
  // Endereço era um texto só; agora é separado por campos (CEP, rua, número...).
  if (typeof c.endereco !== 'object' || !c.endereco) c.endereco = { ...ENDERECO_VAZIO(), rua: String(c.endereco || '') };
}

// Grava em arquivo temporário e renomeia, para nunca deixar o db.json pela metade.
function salvar() {
  const tmp = DB_FILE + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(db, null, 2));
  fs.renameSync(tmp, DB_FILE);
}

// ---------------------------------------------------------------- utilidades HTTP

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

// Limite simples de tentativas por chave (IP), em memória.
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
setInterval(() => {
  const agora = Date.now();
  for (const [k, v] of tentativas) if (v.ate < agora) tentativas.delete(k);
  for (const [k, v] of sessoes) if (v.validade < agora) sessoes.delete(k);
  for (const [k, v] of redefinicoes) if (v.validade < agora) redefinicoes.delete(k);
}, 10 * 60 * 1000).unref();

// ---------------------------------------------------------------- validação

function texto(valor, { max, obrigatorio = false, campo }) {
  if (valor == null) valor = '';
  if (typeof valor !== 'string') throw new ErroHttp(400, `Campo inválido: ${campo}.`);
  const limpo = valor.trim();
  if (obrigatorio && !limpo) throw new ErroHttp(400, `Preencha o campo: ${campo}.`);
  if (limpo.length > max) throw new ErroHttp(400, `O campo "${campo}" aceita até ${max} caracteres.`);
  return limpo;
}

function inteiro(valor, { min, max, campo }) {
  if (!Number.isInteger(valor) || valor < min || valor > max) throw new ErroHttp(400, `Valor inválido: ${campo}.`);
  return valor;
}

function dataLocal(d) {
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

// ---------------------------------------------------------------- sessão

// token -> { validade, tipo: 'admin' | 'cliente', clienteId }. Em memória: reiniciar o servidor desloga.
const sessoes = new Map();

function lerCookie(req, nome) {
  for (const par of (req.headers.cookie || '').split(';')) {
    const [k, ...v] = par.trim().split('=');
    if (k === nome) return v.join('=');
  }
  return '';
}

function sessaoDe(req) {
  const sessao = sessoes.get(lerCookie(req, 'sid'));
  return sessao && sessao.validade > Date.now() ? sessao : null;
}

function ehAdmin(req) {
  return sessaoDe(req)?.tipo === 'admin';
}

function clienteLogado(req) {
  const sessao = sessaoDe(req);
  return (sessao?.tipo === 'cliente' && db.clientes.find((c) => c.id === sessao.clienteId)) || null;
}

function exigirCliente(req) {
  const cliente = clienteLogado(req);
  if (!cliente) throw new ErroHttp(401, 'Faça login para continuar.');
  return cliente;
}

function abrirSessao(res, dados) {
  const token = crypto.randomBytes(32).toString('hex');
  sessoes.set(token, { ...dados, validade: Date.now() + SESSAO_MS });
  res.setHeader('Set-Cookie', cookieSessao(token, SESSAO_MS / 1000));
}

function cookieSessao(token, maxAgeSeg) {
  return `sid=${token}; HttpOnly; SameSite=Lax; Path=/; Max-Age=${maxAgeSeg}${PRODUCAO ? '; Secure' : ''}`;
}

// Serve para a confeiteira (db.admin) e para clientes: ambos guardam { salt, hash }.
function senhaConfere(senha, conta) {
  if (typeof senha !== 'string' || senha.length > 200) return false;
  const a = Buffer.from(hashSenha(senha, conta.salt), 'hex');
  const b = Buffer.from(conta.hash, 'hex');
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

function novaSenha(senha) {
  if (typeof senha !== 'string' || senha.length < 8 || senha.length > 200) {
    throw new ErroHttp(400, 'A senha precisa ter pelo menos 8 caracteres.');
  }
  const salt = crypto.randomBytes(16).toString('hex');
  return { salt, hash: hashSenha(senha, salt) };
}

function lerTelefone(valor) {
  const telefone = String(valor || '').replace(/\D/g, '');
  if (telefone.length < 10 || telefone.length > 13) throw new ErroHttp(400, 'Informe um telefone com DDD.');
  return telefone;
}

// Os dados do ViaCEP chegam pelo navegador, então são validados aqui como qualquer outro campo digitado.
function lerEndereco(valor, obrigatorio) {
  const e = valor && typeof valor === 'object' ? valor : {};
  const cep = String(e.cep || '').replace(/\D/g, '');
  if (cep.length !== 8 && (obrigatorio || cep.length > 0)) throw new ErroHttp(400, 'Informe um CEP com 8 números.');
  const uf = texto(e.uf, { max: 2, obrigatorio, campo: 'UF' }).toUpperCase();
  if (uf && !/^[A-Z]{2}$/.test(uf)) throw new ErroHttp(400, 'UF inválida.');
  return {
    cep, uf,
    rua: texto(e.rua, { max: 120, obrigatorio, campo: 'rua' }),
    numero: texto(e.numero, { max: 10, obrigatorio, campo: 'número' }),
    complemento: texto(e.complemento, { max: 60, campo: 'complemento' }),
    bairro: texto(e.bairro, { max: 80, campo: 'bairro' }),
    cidade: texto(e.cidade, { max: 80, obrigatorio, campo: 'cidade' }),
  };
}

// "Rua das Flores, 10 - apto 2 - Centro, São Paulo/SP - CEP 01001-000"
function formatarEndereco(e) {
  const linha1 = [e.rua && `${e.rua}${e.numero ? `, ${e.numero}` : ''}`, e.complemento, e.bairro].filter(Boolean).join(' - ');
  const cidade = [e.cidade, e.uf].filter(Boolean).join('/');
  const cep = e.cep ? `CEP ${e.cep.slice(0, 5)}-${e.cep.slice(5)}` : '';
  return [[linha1, cidade].filter(Boolean).join(', '), cep].filter(Boolean).join(' - ');
}

// ---- "esqueci minha senha"
// sha256(token) -> { clienteId, validade }. Guardamos só o hash: quem ler a memória/logs não consegue usar o link.
const redefinicoes = new Map();
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
  email.enviarEmail({
    para: cliente.email, nomeRemetente: db.loja.nome, assunto: `Redefinir sua senha - ${db.loja.nome}`,
    texto: `Olá, ${cliente.nome}!\n\nRecebemos um pedido para redefinir a senha da sua conta em ${db.loja.nome}.\n` +
      `Para criar uma nova senha, abra o link abaixo (ele vale por 30 minutos):\n\n${link}\n\n` +
      'Se não foi você, é só ignorar este e-mail: sua senha continua a mesma.\n',
  }).catch((erro) => console.error('Falha ao enviar e-mail de redefinição:', erro.message));
}

// O que pode sair do servidor sobre um cliente (nunca salt/hash).
function clientePublico(c) {
  return c && { id: c.id, nome: c.nome, email: c.email, telefone: c.telefone, endereco: c.endereco };
}

// ---------------------------------------------------------------- regras de negócio

function acharDoce(id) {
  const doce = db.doces.find((d) => d.id === id);
  if (!doce) throw new ErroHttp(404, 'Doce não encontrado.');
  return doce;
}

function aplicarCamposDoce(doce, corpo) {
  if ('nome' in corpo) doce.nome = texto(corpo.nome, { max: 80, obrigatorio: true, campo: 'nome' });
  if ('descricao' in corpo) doce.descricao = texto(corpo.descricao, { max: 1000, campo: 'descrição' });
  if ('unidade' in corpo) doce.unidade = texto(corpo.unidade, { max: 40, campo: 'unidade' }) || 'unidade';
  if ('emoji' in corpo) doce.emoji = texto(corpo.emoji, { max: 8, campo: 'emoji' }) || '🧁';
  if ('preco' in corpo) doce.preco = inteiro(corpo.preco, { min: 0, max: 10_000_00, campo: 'preço' });
  if ('disponivel' in corpo) doce.disponivel = Boolean(corpo.disponivel);
}

function criarPedido(corpo, clienteId) {
  const cliente = corpo.cliente || {};
  const entrega = corpo.entrega || {};
  const nome = texto(cliente.nome, { max: 80, obrigatorio: true, campo: 'nome' });
  const telefone = lerTelefone(cliente.telefone);

  const tipo = entrega.tipo === 'entrega' ? 'entrega' : 'retirada';
  const endereco = tipo === 'entrega' ? lerEndereco(entrega.endereco, true) : null;
  const data = String(entrega.data || '');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(data) || Number.isNaN(Date.parse(data)) || data < dataLocal(new Date())) {
    throw new ErroHttp(400, 'Escolha uma data de hoje em diante.');
  }

  if (!Array.isArray(corpo.itens) || corpo.itens.length < 1 || corpo.itens.length > 50) {
    throw new ErroHttp(400, 'O carrinho está vazio.');
  }
  // Preço e nome vêm sempre do banco — nunca do que o navegador enviou.
  const itens = corpo.itens.map((item) => {
    const doce = db.doces.find((d) => d.id === (item && item.doceId));
    if (!doce || !doce.disponivel) throw new ErroHttp(409, 'Um dos doces do carrinho não está mais disponível. Atualize a página.');
    return {
      doceId: doce.id, nome: doce.nome, precoUnit: doce.preco,
      quantidade: inteiro(item.quantidade, { min: 1, max: 999, campo: 'quantidade' }),
      observacoes: texto(item.observacoes, { max: 300, campo: 'alterações' }),
    };
  });

  const pedido = {
    id: crypto.randomUUID(), numero: db.proximoNumero++, criadoEm: new Date().toISOString(),
    clienteId: clienteId || null, cliente: { nome, telefone }, entrega: { tipo, data, endereco: endereco ? formatarEndereco(endereco) : '' },
    itens, observacoes: texto(corpo.observacoes, { max: 500, campo: 'observações' }),
    total: itens.reduce((s, i) => s + i.precoUnit * i.quantidade, 0), status: 'novo',
  };
  db.pedidos.push(pedido);
  // Primeira entrega de quem ainda não tinha endereço no cadastro: guarda para os próximos pedidos.
  const conta = endereco && db.clientes.find((c) => c.id === clienteId);
  if (conta && !conta.endereco.cep) conta.endereco = endereco;
  salvar();
  return pedido;
}

// Agrupa os pedidos por pessoa: pela conta, quando o cliente estava logado; senão pelo telefone.
function montarClientes() {
  const pessoas = new Map();
  for (const c of db.clientes) {
    pessoas.set(c.id, { nome: c.nome, telefone: c.telefone, email: c.email, cadastrado: true, pedidos: [] });
  }
  for (const p of db.pedidos) {
    const chave = p.clienteId && pessoas.has(p.clienteId) ? p.clienteId : `tel:${p.cliente.telefone}`;
    if (!pessoas.has(chave)) {
      pessoas.set(chave, { nome: p.cliente.nome, telefone: p.cliente.telefone, email: '', cadastrado: false, pedidos: [] });
    }
    pessoas.get(chave).pedidos.push({
      numero: p.numero, criadoEm: p.criadoEm, total: p.total, status: p.status,
      itens: p.itens.map((i) => `${i.quantidade}× ${i.nome}`).join(', '),
    });
  }
  return [...pessoas.values()].map((pessoa) => {
    const validos = pessoa.pedidos.filter((p) => p.status !== 'cancelado');
    pessoa.pedidos.reverse(); // mais recentes primeiro
    return {
      ...pessoa, quantidade: validos.length, total: validos.reduce((s, p) => s + p.total, 0),
      ultimoPedido: pessoa.pedidos[0]?.criadoEm || '',
    };
  }).sort((a, b) => b.total - a.total || a.nome.localeCompare(b.nome));
}

function montarDashboard(dias) {
  const hoje = new Date();
  hoje.setHours(0, 0, 0, 0);
  const inicio = new Date(hoje);
  inicio.setDate(inicio.getDate() - (dias - 1));
  const inicioAnterior = new Date(inicio);
  inicioAnterior.setDate(inicioAnterior.getDate() - dias);

  const serie = new Map();
  for (let d = new Date(inicio); d <= hoje; d.setDate(d.getDate() + 1)) {
    serie.set(dataLocal(d), { data: dataLocal(d), receita: 0, pedidos: 0 });
  }

  const porDoce = new Map();
  const status = Object.fromEntries(STATUS.map((s) => [s, 0]));
  let receita = 0, pedidos = 0, receitaAnterior = 0, emAberto = 0;

  for (const p of db.pedidos) {
    if (STATUS_ABERTOS.includes(p.status)) emAberto++;
    const criado = new Date(p.criadoEm);
    if (criado >= inicio) status[p.status]++;
    if (p.status === 'cancelado') continue; // cancelados não contam como receita
    if (criado >= inicio) {
      const dia = serie.get(dataLocal(criado));
      if (!dia) continue;
      dia.receita += p.total;
      dia.pedidos++;
      receita += p.total;
      pedidos++;
      for (const item of p.itens) {
        const reg = porDoce.get(item.nome) || { nome: item.nome, quantidade: 0, receita: 0 };
        reg.quantidade += item.quantidade;
        reg.receita += item.precoUnit * item.quantidade;
        porDoce.set(item.nome, reg);
      }
    } else if (criado >= inicioAnterior) {
      receitaAnterior += p.total;
    }
  }

  return {
    dias,
    kpis: { receita, pedidos, ticketMedio: pedidos ? Math.round(receita / pedidos) : 0, receitaAnterior, emAberto },
    serie: [...serie.values()],
    topDoces: [...porDoce.values()].sort((a, b) => b.receita - a.receita).slice(0, 6),
    status,
  };
}

const IMAGENS = {
  jpeg: { ext: 'jpg', ok: (b) => b[0] === 0xff && b[1] === 0xd8 },
  png: { ext: 'png', ok: (b) => b.subarray(0, 4).toString('hex') === '89504e47' },
  webp: { ext: 'webp', ok: (b) => b.subarray(0, 4).toString() === 'RIFF' && b.subarray(8, 12).toString() === 'WEBP' },
};

function salvarImagem(doce, dataUrl) {
  const m = /^data:image\/(jpeg|png|webp);base64,([A-Za-z0-9+/=]+)$/.exec(typeof dataUrl === 'string' ? dataUrl : '');
  if (!m) throw new ErroHttp(400, 'Envie uma foto JPG, PNG ou WebP.');
  const bytes = Buffer.from(m[2], 'base64');
  const tipo = IMAGENS[m[1]];
  if (bytes.length > 2 * 1024 * 1024 || !tipo.ok(bytes)) throw new ErroHttp(400, 'Foto inválida ou maior que 2 MB.');
  removerImagem(doce);
  const arquivo = `${doce.id}-${Date.now()}.${tipo.ext}`;
  fs.writeFileSync(path.join(UPLOADS_DIR, arquivo), bytes);
  doce.imagem = `/uploads/${arquivo}`;
}

function removerImagem(doce) {
  if (!doce.imagem) return;
  fs.rmSync(path.join(UPLOADS_DIR, path.basename(doce.imagem)), { force: true });
  doce.imagem = '';
}

// ---------------------------------------------------------------- rotas da API
// [método, caminho, handler, exigeAdmin]

const rotas = [
  ['GET', /^\/api\/site$/, (req) => ({
    loja: db.loja, sobre: db.sobre, admin: ehAdmin(req), cliente: clientePublico(clienteLogado(req)),
  })],

  ['GET', /^\/api\/doces$/, (req) => (ehAdmin(req) ? db.doces : db.doces.filter((d) => d.disponivel))],

  ['GET', /^\/api\/doces\/([a-z0-9-]+)$/, (req, [slug]) => {
    const doce = db.doces.find((d) => d.slug === slug);
    if (!doce || (!doce.disponivel && !ehAdmin(req))) throw new ErroHttp(404, 'Doce não encontrado.');
    return doce;
  }],

  ['POST', /^\/api\/pedidos$/, async (req) => {
    limitar(`pedido:${req.socket.remoteAddress}`, 10, 10 * 60 * 1000);
    const cliente = exigirCliente(req); // só clientes logados fazem pedido
    const pedido = criarPedido(await lerJson(req), cliente.id);
    return { numero: pedido.numero, total: pedido.total };
  }],

  ['POST', /^\/api\/login$/, async (req, _p, res) => {
    limitar(`login:${req.socket.remoteAddress}`, 8, 15 * 60 * 1000);
    // Login único: a confeiteira entra com o usuário dela; clientes, com o e-mail.
    const { usuario, senha } = await lerJson(req);
    const login = typeof usuario === 'string' ? usuario.trim().toLowerCase() : '';
    if (login === db.admin.usuario) {
      if (!senhaConfere(senha, db.admin)) throw new ErroHttp(401, 'E-mail/usuário ou senha incorretos.');
      abrirSessao(res, { tipo: 'admin' });
      return { tipo: 'admin' };
    }
    const cliente = db.clientes.find((c) => c.email === login);
    // Sem conta, confere contra um hash qualquer: a resposta demora o mesmo tanto e não revela se o e-mail existe.
    const senhaOk = senhaConfere(senha, cliente || db.admin);
    if (!cliente || !senhaOk) throw new ErroHttp(401, 'E-mail/usuário ou senha incorretos.');
    abrirSessao(res, { tipo: 'cliente', clienteId: cliente.id });
    return { tipo: 'cliente' };
  }],

  ['POST', /^\/api\/cadastro$/, async (req, _p, res) => {
    limitar(`cadastro:${req.socket.remoteAddress}`, 5, 60 * 60 * 1000);
    const corpo = await lerJson(req);
    const emailNovo = texto(corpo.email, { max: 120, obrigatorio: true, campo: 'e-mail' }).toLowerCase();
    if (!/^[^\s@<>"',;]+@[^\s@<>"',;]+\.[^\s@<>"',;]+$/.test(emailNovo)) throw new ErroHttp(400, 'Informe um e-mail válido.');
    if (db.clientes.some((c) => c.email === emailNovo)) throw new ErroHttp(409, 'Já existe uma conta com este e-mail. Tente entrar.');
    const cliente = {
      id: crypto.randomUUID(), email: emailNovo,
      nome: texto(corpo.nome, { max: 80, obrigatorio: true, campo: 'nome' }),
      telefone: lerTelefone(corpo.telefone),
      endereco: lerEndereco(corpo.endereco, false),
      ...novaSenha(corpo.senha), criadoEm: new Date().toISOString(),
    };
    db.clientes.push(cliente);
    salvar();
    abrirSessao(res, { tipo: 'cliente', clienteId: cliente.id });
    return clientePublico(cliente);
  }],

  // Responde sempre igual, exista a conta ou não, para não revelar quem é cliente.
  ['POST', /^\/api\/senha\/esqueci$/, async (req) => {
    limitar(`esqueci:${req.socket.remoteAddress}`, 5, 60 * 60 * 1000);
    const corpo = await lerJson(req);
    const login = typeof corpo.email === 'string' ? corpo.email.trim().toLowerCase() : '';
    const cliente = db.clientes.find((c) => c.email === login);
    if (cliente) {
      // No máximo 3 e-mails por hora para a mesma conta, sem avisar quem pediu (evita lotar a caixa de alguém).
      try { limitar(`esqueci-conta:${cliente.id}`, 3, 60 * 60 * 1000); enviarLinkRedefinicao(cliente); } catch { /* limite atingido */ }
    }
    return { ok: true };
  }],

  ['POST', /^\/api\/senha\/redefinir$/, async (req) => {
    limitar(`redefinir:${req.socket.remoteAddress}`, 10, 15 * 60 * 1000);
    const { token, senha } = await lerJson(req);
    const chave = hashToken(typeof token === 'string' ? token : '');
    const pedido = redefinicoes.get(chave);
    const cliente = pedido && pedido.validade > Date.now() && db.clientes.find((c) => c.id === pedido.clienteId);
    if (!cliente) throw new ErroHttp(400, 'Este link expirou ou já foi usado. Peça um novo.');
    Object.assign(cliente, novaSenha(senha)); // se a senha for inválida, lança antes de gastar o link
    redefinicoes.delete(chave);
    salvar();
    // Quem estava logado nessa conta (talvez um invasor) é deslogado.
    for (const [t, sessao] of sessoes) if (sessao.clienteId === cliente.id) sessoes.delete(t);
    return { ok: true };
  }],

  // ---- conta do cliente logado

  ['PUT', /^\/api\/conta$/, async (req) => {
    const cliente = exigirCliente(req);
    const corpo = await lerJson(req);
    const nome = texto(corpo.nome, { max: 80, obrigatorio: true, campo: 'nome' });
    const telefone = lerTelefone(corpo.telefone);
    const endereco = lerEndereco(corpo.endereco, false);
    if (corpo.novaSenha) {
      limitar(`senha:${req.socket.remoteAddress}`, 8, 15 * 60 * 1000);
      if (!senhaConfere(corpo.senhaAtual, cliente)) throw new ErroHttp(400, 'A senha atual não confere.');
      Object.assign(cliente, novaSenha(corpo.novaSenha));
    }
    Object.assign(cliente, { nome, telefone, endereco });
    salvar();
    return clientePublico(cliente);
  }],

  ['GET', /^\/api\/conta\/pedidos$/, (req) => {
    const cliente = exigirCliente(req);
    return db.pedidos.filter((p) => p.clienteId === cliente.id).reverse()
      .map(({ numero, criadoEm, entrega, itens, total, status }) => ({ numero, criadoEm, entrega, itens, total, status }));
  }],

  ['POST', /^\/api\/logout$/, (req, _p, res) => {
    sessoes.delete(lerCookie(req, 'sid'));
    res.setHeader('Set-Cookie', cookieSessao('', 0));
    return { ok: true };
  }],

  // ---- daqui para baixo, só a confeiteira logada

  ['POST', /^\/api\/doces$/, async (req) => {
    const corpo = await lerJson(req);
    const doce = { id: crypto.randomUUID(), slug: '', nome: '', descricao: '', preco: 0, unidade: 'unidade', emoji: '🧁', imagem: '', disponivel: true };
    aplicarCamposDoce(doce, { nome: '', ...corpo });
    doce.slug = criarSlug(doce.nome, db.doces.map((d) => d.slug));
    db.doces.push(doce);
    salvar();
    return doce;
  }, true],

  ['PUT', /^\/api\/doces\/([0-9a-f-]{36})$/, async (req, [id]) => {
    const doce = acharDoce(id);
    aplicarCamposDoce(doce, await lerJson(req));
    salvar();
    return doce;
  }, true],

  ['DELETE', /^\/api\/doces\/([0-9a-f-]{36})$/, (req, [id]) => {
    const doce = acharDoce(id);
    removerImagem(doce);
    db.doces = db.doces.filter((d) => d !== doce);
    salvar();
    return { ok: true };
  }, true],

  ['PUT', /^\/api\/doces\/([0-9a-f-]{36})\/imagem$/, async (req, [id]) => {
    const doce = acharDoce(id);
    const { imagem } = await lerJson(req, 3 * 1024 * 1024);
    if (imagem) salvarImagem(doce, imagem); else removerImagem(doce);
    salvar();
    return doce;
  }, true],

  ['PUT', /^\/api\/sobre$/, async (req) => {
    const corpo = await lerJson(req);
    if (!Array.isArray(corpo.trajetoria) || corpo.trajetoria.length > 30) throw new ErroHttp(400, 'Trajetória inválida.');
    db.sobre = {
      titulo: texto(corpo.titulo, { max: 80, obrigatorio: true, campo: 'título' }),
      texto: texto(corpo.texto, { max: 5000, campo: 'história' }),
      trajetoria: corpo.trajetoria.map((t) => ({
        ano: texto(t && t.ano, { max: 12, campo: 'ano' }),
        titulo: texto(t && t.titulo, { max: 80, obrigatorio: true, campo: 'título da etapa' }),
        texto: texto(t && t.texto, { max: 400, campo: 'texto da etapa' }),
      })),
    };
    salvar();
    return db.sobre;
  }, true],

  ['PUT', /^\/api\/loja$/, async (req) => {
    const corpo = await lerJson(req);
    db.loja = {
      nome: texto(corpo.nome, { max: 60, obrigatorio: true, campo: 'nome da loja' }),
      slogan: texto(corpo.slogan, { max: 160, campo: 'slogan' }),
      whatsapp: String(corpo.whatsapp || '').replace(/\D/g, '').slice(0, 15),
      instagram: texto(corpo.instagram, { max: 40, campo: 'Instagram' }).replace(/^@/, '').replace(/[^\w.]/g, ''),
      email: texto(corpo.email, { max: 120, campo: 'e-mail' }),
      cidade: texto(corpo.cidade, { max: 80, campo: 'cidade' }),
    };
    salvar();
    return db.loja;
  }, true],

  ['PUT', /^\/api\/senha$/, async (req) => {
    limitar(`senha:${req.socket.remoteAddress}`, 8, 15 * 60 * 1000);
    const { atual, nova } = await lerJson(req);
    if (!senhaConfere(atual, db.admin)) throw new ErroHttp(400, 'A senha atual não confere.');
    Object.assign(db.admin, novaSenha(nova), { senhaInicial: false });
    salvar();
    // Derruba as outras sessões da confeiteira; mantém só a atual.
    const atualToken = lerCookie(req, 'sid');
    for (const [t, sessao] of sessoes) if (sessao.tipo === 'admin' && t !== atualToken) sessoes.delete(t);
    return { ok: true };
  }, true],

  ['GET', /^\/api\/pedidos$/, () => [...db.pedidos].reverse(), true],

  ['GET', /^\/api\/clientes$/, () => montarClientes(), true],

  ['PATCH', /^\/api\/pedidos\/([0-9a-f-]{36})$/, async (req, [id]) => {
    const pedido = db.pedidos.find((p) => p.id === id);
    if (!pedido) throw new ErroHttp(404, 'Pedido não encontrado.');
    const { status } = await lerJson(req);
    if (!STATUS.includes(status)) throw new ErroHttp(400, 'Status inválido.');
    pedido.status = status;
    salvar();
    return pedido;
  }, true],

  ['GET', /^\/api\/dashboard$/, (req, _p, _res, url) => {
    const dias = Number(url.searchParams.get('dias'));
    return { ...montarDashboard([7, 30, 90].includes(dias) ? dias : 30), senhaInicial: db.admin.senhaInicial };
  }, true],
];

// ---------------------------------------------------------------- páginas e arquivos estáticos

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

const PASTAS_ESTATICAS = { css: path.join(ROOT, 'css'), js: path.join(ROOT, 'js'), uploads: UPLOADS_DIR };

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
  if (pagina) return enviarArquivo(res, path.join(ROOT, 'pages', pagina[1]));

  const [, pasta, ...resto] = caminho.split('/');
  const base = PASTAS_ESTATICAS[pasta];
  if (!base || !resto.length) return enviarArquivo404(res);
  // path.resolve + verificação de prefixo impede sair da pasta com "../".
  const arquivo = path.resolve(base, resto.join('/'));
  if (!arquivo.startsWith(base + path.sep)) return enviarArquivo404(res);
  enviarArquivo(res, arquivo);
}

// ---------------------------------------------------------------- servidor

async function atender(req, res) {
  const url = new URL(req.url, 'http://localhost');
  let caminho;
  try { caminho = decodeURIComponent(url.pathname); } catch { throw new ErroHttp(400, 'Endereço inválido.'); }

  if (!caminho.startsWith('/api/')) {
    if (req.method !== 'GET' && req.method !== 'HEAD') throw new ErroHttp(405, 'Método não permitido.');
    return servirEstatico(caminho, res);
  }

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
}).listen(PORT, () => {
  console.log(`Confeitaria no ar: http://localhost:${PORT}  (painel: /login)`);
});
