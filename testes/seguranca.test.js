'use strict';
// Proteções da Fase 1.7: pedidos vindos de outro site (Origin), HSTS, limite de erros por conta e listas paginadas.

const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { subirServidor, dadosCliente, hojeLocal, SENHA_ADMIN } = require('./apoio');

let servidor, loja, visitante;
before(async () => {
  servidor = await subirServidor();
  loja = servidor.navegador();
  await loja.entrarComoAdmin();
  visitante = servidor.navegador();
});
after(() => servidor.parar());

const login = (nav, usuario, senha, cabecalhos) => nav.post('/api/login', { usuario, senha }, cabecalhos);

test('Origin: pedido que altera dados vindo de outro site é recusado, mesmo com sessão válida', async () => {
  const host = new URL(servidor.url).host;
  const nomeAntes = (await visitante.get('/api/site')).dados.loja.nome;

  for (const cabecalhos of [
    { Origin: 'https://site-malicioso.example' },
    { Origin: `http://${host}.site-malicioso.example` },
    { Origin: `http://outro-${host}` },
    { Origin: 'null' },                       // página aberta de um arquivo ou de um iframe isolado
    { Origin: 'isto não é um endereço' },
    { 'Sec-Fetch-Site': 'cross-site' },       // navegador que não mandou Origin, mas avisou que é de outro site
    { 'Sec-Fetch-Site': 'same-site' },        // outro subdomínio do mesmo domínio também não é o site
  ]) {
    const r = await loja.put('/api/loja', { nome: 'Invadida' }, cabecalhos);
    assert.equal(r.status, 403, JSON.stringify(cabecalhos));
    assert.match(r.dados.erro, /não veio deste site/);
  }
  assert.equal((await loja.post('/api/logout', {}, { Origin: 'https://site-malicioso.example' })).status, 403);
  assert.equal((await loja.delete('/api/categorias/00000000-0000-4000-8000-000000000000')).status, 404); // sem Origin: segue normal
  assert.equal((await visitante.get('/api/site')).dados.loja.nome, nomeAntes);
  assert.equal((await loja.get('/api/dashboard')).status, 200, 'a sessão da loja continua valendo');
});

test('Origin: o próprio site passa; leituras não são afetadas', async () => {
  const origem = new URL(servidor.url).origin;
  assert.equal((await login(servidor.navegador(), 'confeiteira', SENHA_ADMIN, { Origin: origem })).status, 200);
  assert.equal((await login(servidor.navegador(), 'confeiteira', SENHA_ADMIN, { 'Sec-Fetch-Site': 'same-origin' })).status, 200);
  assert.equal((await login(servidor.navegador(), 'confeiteira', SENHA_ADMIN, { 'Sec-Fetch-Site': 'none' })).status, 200);
  // Origin e Sec-Fetch-Site juntos (o normal nos navegadores atuais): vale o Origin.
  assert.equal((await login(servidor.navegador(), 'confeiteira', SENHA_ADMIN, { Origin: origem, 'Sec-Fetch-Site': 'same-origin' })).status, 200);
  assert.equal((await visitante.get('/api/produtos', { Origin: 'https://site-malicioso.example' })).status, 200);
  assert.equal((await visitante.get('/', { Origin: 'https://site-malicioso.example' })).status, 200);
});

test('Origin: atrás de um proxy, vale o endereço público configurado em SITE_URL', async () => {
  const publico = await subirServidor({ SITE_URL: 'https://www.minhaloja.example/' });
  try {
    const nav = publico.navegador();
    assert.equal((await login(nav, 'confeiteira', SENHA_ADMIN, { Origin: 'https://www.minhaloja.example' })).status, 200);
    assert.equal((await login(nav, 'confeiteira', SENHA_ADMIN, { Origin: 'https://minhaloja.example' })).status, 403);
  } finally {
    await publico.parar();
  }
});

test('HSTS: só em produção, em páginas, arquivos e API', async () => {
  for (const caminho of ['/', '/api/site', '/css/site.css', '/tema.css', '/nao-existe']) {
    assert.equal((await visitante.get(caminho)).cabecalhos.get('strict-transport-security'), null, caminho);
  }
  const producao = await subirServidor({ NODE_ENV: 'production' });
  try {
    const nav = producao.navegador();
    for (const caminho of ['/', '/api/site', '/css/site.css', '/tema.css', '/nao-existe', '/doce/brigadeiro-gourmet']) {
      assert.equal((await nav.get(caminho)).cabecalhos.get('strict-transport-security'), 'max-age=31536000', caminho);
    }
    assert.equal((await nav.post('/api/login', { usuario: 'x', senha: 'y' })).cabecalhos.get('strict-transport-security'), 'max-age=31536000');
  } finally {
    await producao.parar();
  }
});

test('limite por conta: dez erros de senha bloqueiam a conta, venham de quantos IPs vierem', async () => {
  const dados = dadosCliente();
  const outra = dadosCliente();
  await servidor.navegador().post('/api/cadastro', dados);
  await servidor.navegador().post('/api/cadastro', outra);

  // Cada chamada sai de um IP diferente: o limite por IP nunca seria atingido.
  for (let i = 0; i < 10; i++) {
    assert.equal((await login(servidor.navegador(), dados.email, 'senha-errada-123')).status, 401, `tentativa ${i + 1}`);
  }
  const bloqueado = await login(servidor.navegador(), dados.email, dados.senha);
  assert.equal(bloqueado.status, 429);
  assert.match(bloqueado.dados.erro, /nesta conta/);
  // Maiúsculas e espaços no e-mail não abrem outra contagem.
  assert.equal((await login(servidor.navegador(), `  ${dados.email.toUpperCase()} `, dados.senha)).status, 429);
  // As outras contas e a loja continuam entrando.
  assert.equal((await login(servidor.navegador(), outra.email, outra.senha)).status, 200);
  assert.equal((await login(servidor.navegador(), 'confeiteira', SENHA_ADMIN)).status, 200);
});

test('limite por conta: e-mail sem cadastro é bloqueado do mesmo jeito (não revela quem é cliente)', async () => {
  for (let i = 0; i < 10; i++) assert.equal((await login(servidor.navegador(), 'ninguem@exemplo.com', 'senha-errada-123')).status, 401);
  assert.equal((await login(servidor.navegador(), 'ninguem@exemplo.com', 'senha-errada-123')).status, 429);
});

test('limite por conta: acertar a senha zera a contagem de erros', async () => {
  const dados = dadosCliente();
  await servidor.navegador().post('/api/cadastro', dados);
  for (let rodada = 0; rodada < 2; rodada++) {
    for (let i = 0; i < 9; i++) assert.equal((await login(servidor.navegador(), dados.email, 'senha-errada-123')).status, 401);
    assert.equal((await login(servidor.navegador(), dados.email, dados.senha)).status, 200, `rodada ${rodada + 1}`);
  }
});

test('limite por conta: troca de senha com a senha atual errada', async () => {
  const dados = dadosCliente();
  const cliente = servidor.navegador();
  await cliente.post('/api/cadastro', dados);
  const trocar = (senhaAtual) => cliente.put('/api/conta', { nome: dados.nome, telefone: dados.telefone, endereco: {}, senhaAtual, novaSenha: 'nova-senha-456' });
  for (let i = 0; i < 10; i++) assert.equal((await trocar('nao-e-essa')).status, 400);
  assert.equal((await trocar(dados.senha)).status, 429);
  // Salvar os dados sem trocar a senha continua funcionando.
  assert.equal((await cliente.put('/api/conta', { nome: 'Outro Nome', telefone: dados.telefone, endereco: {} })).status, 200);
});

test('paginação: pedidos do painel, histórico do cliente e clientes', async () => {
  const dados = dadosCliente({ nome: 'Paula Paginada' });
  const cliente = servidor.navegador();
  await cliente.post('/api/cadastro', dados);
  const [produto] = (await visitante.get('/api/produtos')).dados;
  for (let i = 0; i < 32; i++) {
    const r = await cliente.post('/api/pedidos', {
      cliente: { nome: dados.nome, telefone: dados.telefone }, entrega: { tipo: 'retirada', data: hojeLocal(1) },
      itens: [{ produtoId: produto.id, quantidade: 1 }],
    });
    assert.equal(r.status, 200, `pedido ${i + 1}`);
  }

  // Painel: 30 por página, do mais novo para o mais antigo.
  const p1 = (await loja.get('/api/pedidos')).dados;
  assert.deepEqual([p1.itens.length, p1.total, p1.pagina, p1.paginas], [30, 32, 1, 2]);
  assert.deepEqual(p1.itens.slice(0, 3).map((p) => p.numero), [32, 31, 30]);
  assert.equal(p1.itens[0].itens[0].nome, produto.nome, 'cada pedido vem com os itens');
  const p2 = (await loja.get('/api/pedidos?pagina=2')).dados;
  assert.deepEqual([p2.itens.map((p) => p.numero), p2.pagina], [[2, 1], 2]);
  assert.deepEqual((await loja.get('/api/pedidos?pagina=3')).dados.itens, []);
  for (const ruim of ['0', '-1', '1.5', 'abc', '']) assert.equal((await loja.get(`/api/pedidos?pagina=${ruim}`)).dados.pagina, 1, ruim);

  // Filtro por status feito no servidor: a contagem e as páginas são as do filtro.
  await loja.patch(`/api/pedidos/${p1.itens[0].id}`, { status: 'entregue' });
  await loja.patch(`/api/pedidos/${p1.itens[1].id}`, { status: 'cancelado' });
  await loja.patch(`/api/pedidos/${p1.itens[2].id}`, { status: 'confirmado' });
  const abertos = (await loja.get('/api/pedidos?status=abertos')).dados;
  assert.deepEqual([abertos.total, abertos.paginas, abertos.itens[0].numero], [30, 1, 30]);
  assert.deepEqual((await loja.get('/api/pedidos?status=entregue')).dados.itens.map((p) => p.numero), [32]);
  assert.equal((await loja.get('/api/pedidos?status=todos')).dados.total, 32);
  assert.equal((await loja.get('/api/pedidos?status=inventado')).status, 400);
  assert.equal((await visitante.get('/api/pedidos?pagina=1')).status, 401);

  // Histórico do cliente: 20 por página, só os pedidos dele.
  const h1 = (await cliente.get('/api/conta/pedidos')).dados;
  assert.deepEqual([h1.itens.length, h1.total, h1.paginas, h1.itens[0].numero], [20, 32, 2, 32]);
  assert.equal('id' in h1.itens[0], false);
  const h2 = (await cliente.get('/api/conta/pedidos?pagina=2')).dados;
  assert.deepEqual([h2.itens.length, h2.itens.at(-1).numero], [12, 1]);
  const semPedidos = servidor.navegador();
  await semPedidos.post('/api/cadastro', dadosCliente());
  assert.deepEqual((await semPedidos.get('/api/conta/pedidos')).dados, { itens: [], total: 0, pagina: 1, paginas: 1 });

  // Clientes: busca no servidor, por nome, telefone ou e-mail.
  const todos = (await loja.get('/api/clientes')).dados;
  assert.ok(todos.total >= 6 && todos.itens.length === todos.total && todos.paginas === 1);
  assert.equal(todos.itens[0].nome, 'Paula Paginada', 'quem mais comprou vem primeiro');
  const achada = (await loja.get('/api/clientes?busca=PAULA%20pag')).dados;
  assert.deepEqual([achada.total, achada.itens[0].email, achada.itens[0].pedidos.length], [1, dados.email, 32]);
  assert.equal((await loja.get(`/api/clientes?busca=${encodeURIComponent(dados.email)}`)).dados.total, 1);
  assert.deepEqual((await loja.get('/api/clientes?busca=ninguem-com-esse-nome')).dados, { itens: [], total: 0, pagina: 1, paginas: 1 });
  assert.deepEqual((await loja.get('/api/clientes?pagina=2')).dados.itens, []);
});
