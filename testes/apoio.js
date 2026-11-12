'use strict';
// Apoio dos testes de integração: sobe um servidor de verdade, com banco vazio em uma pasta temporária,
// e oferece um "navegador" simples (guarda o cookie de sessão entre as chamadas).
// Cada arquivo de teste sobe o próprio servidor, então os limites de tentativas não se misturam.

const { spawn } = require('node:child_process');
const fs = require('node:fs');
const net = require('node:net');
const os = require('node:os');
const path = require('node:path');

const RAIZ = path.join(__dirname, '..');
const SENHA_ADMIN = 'senha-de-teste-123';

function portaLivre() {
  return new Promise((resolve, reject) => {
    const s = net.createServer();
    s.once('error', reject);
    s.listen(0, '127.0.0.1', () => {
      const { port } = s.address();
      s.close(() => resolve(port));
    });
  });
}

async function subirServidor(envExtra = {}) {
  const pasta = fs.mkdtempSync(path.join(os.tmpdir(), 'loja-teste-'));
  const porta = await portaLivre();
  // TRUST_PROXY=1: o servidor lê o IP do cabeçalho X-Forwarded-For, e assim cada chamada dos testes pode vir de um
  // "visitante" diferente. Sem isso, os limites de tentativas por IP barrariam os próprios testes.
  const env = { ...process.env, PORT: String(porta), HOST: '127.0.0.1', DATA_DIR: pasta, ADMIN_PASSWORD: SENHA_ADMIN, TRUST_PROXY: '1', ...envExtra };
  // Nada do ambiente de quem roda os testes pode vazar para o servidor de teste.
  for (const nome of ['NODE_ENV', 'SITE_URL', 'SMTP_HOST', 'SMTP_USER', 'SMTP_PASS', 'SMTP_FROM', 'SMTP_PORT', 'SMTP_MODO']) {
    if (!(nome in envExtra)) delete env[nome];
  }

  const processo = spawn(process.execPath, ['server.js'], { cwd: RAIZ, env, stdio: ['ignore', 'pipe', 'pipe'] });
  let saida = '';
  processo.stdout.on('data', (parte) => { saida += parte; });
  processo.stderr.on('data', (parte) => { saida += parte; });

  await new Promise((resolve, reject) => {
    const limite = setTimeout(() => reject(new Error('O servidor de teste não subiu:\n' + saida)), 15000);
    const conferir = () => {
      if (!saida.includes('no ar')) return;
      clearTimeout(limite);
      processo.stdout.off('data', conferir);
      resolve();
    };
    processo.stdout.on('data', conferir);
    processo.once('exit', (codigo) => { clearTimeout(limite); reject(new Error(`O servidor de teste saiu (código ${codigo}):\n${saida}`)); });
    conferir();
  });

  return {
    url: `http://127.0.0.1:${porta}`,
    pasta,
    saida: () => saida,
    // `ipFixo`: todas as chamadas deste navegador vêm do mesmo IP (para testar os limites de tentativas).
    navegador({ ipFixo = '' } = {}) { return criarNavegador(`http://127.0.0.1:${porta}`, ipFixo); },
    async parar() {
      if (processo.exitCode === null) {
        const saiu = new Promise((resolve) => processo.once('exit', resolve));
        processo.kill();
        await saiu;
      }
      fs.rmSync(pasta, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
    },
  };
}

// Cada navegador tem o próprio cookie: um para a loja, um para cada cliente, um para o visitante.
let ipSeq = 0;
function criarNavegador(base, ipFixo) {
  let cookie = '';
  async function pedir(metodo, caminho, corpo, cabecalhos = {}) {
    ipSeq++;
    const resposta = await fetch(base + caminho, {
      method: metodo,
      redirect: 'manual',
      headers: {
        'X-Forwarded-For': ipFixo || `10.${(ipSeq >> 16) & 255}.${(ipSeq >> 8) & 255}.${ipSeq & 255}`,
        ...(corpo !== undefined ? { 'Content-Type': 'application/json' } : {}),
        ...(cookie ? { Cookie: cookie } : {}),
        ...cabecalhos,
      },
      body: corpo === undefined ? undefined : (typeof corpo === 'string' ? corpo : JSON.stringify(corpo)),
    });
    for (const linha of resposta.headers.getSetCookie()) {
      const [par] = linha.split(';');
      if (par.startsWith('sid=')) cookie = par === 'sid=' ? '' : par;
    }
    const textoResposta = await resposta.text();
    let dados = null;
    try { dados = JSON.parse(textoResposta); } catch { /* não é JSON (página, arquivo) */ }
    return { status: resposta.status, dados, texto: textoResposta, cabecalhos: resposta.headers };
  }
  return {
    get: (caminho, cabecalhos) => pedir('GET', caminho, undefined, cabecalhos),
    post: (caminho, corpo = {}, cabecalhos) => pedir('POST', caminho, corpo, cabecalhos),
    put: (caminho, corpo = {}, cabecalhos) => pedir('PUT', caminho, corpo, cabecalhos),
    patch: (caminho, corpo = {}, cabecalhos) => pedir('PATCH', caminho, corpo, cabecalhos),
    delete: (caminho) => pedir('DELETE', caminho),
    pedir,
    cookie: () => cookie,
    entrarComoAdmin() { return pedir('POST', '/api/login', { usuario: 'confeiteira', senha: SENHA_ADMIN }); },
  };
}

function hojeLocal(maisDias = 0) {
  const d = new Date();
  d.setDate(d.getDate() + maisDias);
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

let contador = 0;
function dadosCliente(extra = {}) {
  contador++;
  return {
    nome: `Cliente Teste ${contador}`, email: `cliente${contador}-${Date.now()}@exemplo.com`,
    telefone: '(11) 98765-4321', senha: 'senha-cliente-1', endereco: {}, ...extra,
  };
}

// Menor PNG válido (1×1 pixel), como o navegador envia: data URL em base64.
const PNG_1X1 = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==';

module.exports = { subirServidor, hojeLocal, dadosCliente, SENHA_ADMIN, PNG_1X1 };
