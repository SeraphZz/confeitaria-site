'use strict';
// O que a loja faz logada: produtos (cadastro, foto, disponibilidade), página Sobre, dados da loja e senha.

const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { subirServidor, SENHA_ADMIN, PNG_1X1 } = require('./apoio');

let servidor, loja, visitante;
before(async () => {
  servidor = await subirServidor();
  loja = servidor.navegador();
  await loja.entrarComoAdmin();
  visitante = servidor.navegador();
});
after(() => servidor.parar());

test('rotas da loja exigem login de admin', async () => {
  const id = '00000000-0000-0000-0000-000000000000';
  const tentativas = [
    ['POST', '/api/produtos', { nome: 'X', preco: 1 }], ['PUT', `/api/produtos/${id}`, { nome: 'X' }], ['DELETE', `/api/produtos/${id}`],
    ['PUT', `/api/produtos/${id}/imagem`, { imagem: PNG_1X1 }], ['PUT', '/api/sobre', { titulo: 'X', trajetoria: [] }],
    ['PUT', '/api/sobre/imagem', { imagem: PNG_1X1 }], ['PUT', '/api/loja', { nome: 'X' }], ['PUT', '/api/senha', { atual: 'a', nova: 'b' }],
    ['GET', '/api/pedidos'], ['GET', '/api/clientes'], ['GET', '/api/dashboard'], ['PATCH', `/api/pedidos/${id}`, { status: 'novo' }],
  ];
  for (const [metodo, caminho, corpo] of tentativas) {
    assert.equal((await visitante.pedir(metodo, caminho, corpo)).status, 401, `${metodo} ${caminho}`);
  }
});

test('produtos: criar, editar, ocultar e excluir', async (t) => {
  let produto;
  await t.test('criar gera slug sem acento e sem repetir', async () => {
    const r = await loja.post('/api/produtos', { nome: 'Pão de Mel Açucarado', preco: 850 });
    assert.equal(r.status, 200);
    produto = r.dados;
    assert.equal(produto.slug, 'pao-de-mel-acucarado');
    assert.equal(produto.preco, 850);
    assert.equal(produto.disponivel, true);
    assert.equal((await loja.post('/api/produtos', { nome: 'Pão de mel açucarado', preco: 900 })).dados.slug, 'pao-de-mel-acucarado-2');
  });

  await t.test('validação de nome e preço', async () => {
    assert.equal((await loja.post('/api/produtos', { nome: '', preco: 100 })).status, 400);
    assert.equal((await loja.post('/api/produtos', { nome: 'x'.repeat(81), preco: 100 })).status, 400);
    assert.equal((await loja.put(`/api/produtos/${produto.id}`, { preco: -1 })).status, 400);
    assert.equal((await loja.put(`/api/produtos/${produto.id}`, { preco: 12.5 })).status, 400);
    assert.equal((await loja.put(`/api/produtos/${produto.id}`, { preco: '100' })).status, 400);
  });

  await t.test('editar muda só os campos enviados e mantém o slug', async () => {
    const r = await loja.put(`/api/produtos/${produto.id}`, { descricao: 'Com <b>mel</b> de verdade', unidade: 'caixa com 4' });
    assert.equal(r.status, 200);
    assert.equal(r.dados.nome, 'Pão de Mel Açucarado');
    assert.equal(r.dados.descricao, 'Com <b>mel</b> de verdade'); // guardado como texto; quem escapa é a página
    assert.equal(r.dados.unidade, 'caixa com 4');
    assert.equal(r.dados.slug, produto.slug);
    assert.equal((await loja.put('/api/produtos/00000000-0000-0000-0000-000000000000', { nome: 'X' })).status, 404);
  });

  await t.test('produto oculto some para o público e continua para a loja', async () => {
    await loja.put(`/api/produtos/${produto.id}`, { disponivel: false });
    assert.ok(!(await visitante.get('/api/produtos')).dados.some((d) => d.id === produto.id));
    assert.equal((await visitante.get(`/api/produtos/${produto.slug}`)).status, 404);
    assert.ok((await loja.get('/api/produtos')).dados.some((d) => d.id === produto.id));
    assert.equal((await loja.get(`/api/produtos/${produto.slug}`)).status, 200);
  });

  await t.test('foto: aceita imagem de verdade, recusa o resto e apaga o arquivo antigo', async () => {
    const semFoto = await loja.put(`/api/produtos/${produto.id}/imagem`, { imagem: 'data:image/png;base64,' + Buffer.from('isto não é png').toString('base64') });
    assert.equal(semFoto.status, 400);
    assert.equal((await loja.put(`/api/produtos/${produto.id}/imagem`, { imagem: 'data:image/svg+xml;base64,PHN2Zz48L3N2Zz4=' })).status, 400);
    assert.equal((await loja.put(`/api/produtos/${produto.id}/imagem`, { imagem: 'data:text/html;base64,PGgxPg==' })).status, 400);

    const r1 = await loja.put(`/api/produtos/${produto.id}/imagem`, { imagem: PNG_1X1 });
    assert.equal(r1.status, 200);
    assert.match(r1.dados.imagem, new RegExp(`^/uploads/${produto.id}-\\d+\\.png$`));
    const foto = await visitante.get(r1.dados.imagem);
    assert.equal(foto.status, 200);
    assert.equal(foto.cabecalhos.get('content-type'), 'image/png');

    await new Promise((resolve) => setTimeout(resolve, 5)); // o nome do arquivo leva o horário
    const r2 = await loja.put(`/api/produtos/${produto.id}/imagem`, { imagem: PNG_1X1 });
    assert.notEqual(r2.dados.imagem, r1.dados.imagem);
    assert.equal((await visitante.get(r1.dados.imagem)).status, 404);

    const r3 = await loja.put(`/api/produtos/${produto.id}/imagem`, { imagem: '' });
    assert.equal(r3.dados.imagem, '');
    assert.deepEqual(fs.readdirSync(path.join(servidor.pasta, 'uploads')), []);
  });

  await t.test('excluir remove o produto e a foto', async () => {
    const comFoto = await loja.put(`/api/produtos/${produto.id}/imagem`, { imagem: PNG_1X1 });
    assert.equal((await loja.delete(`/api/produtos/${produto.id}`)).status, 200);
    assert.ok(!(await loja.get('/api/produtos')).dados.some((d) => d.id === produto.id));
    assert.equal((await visitante.get(comFoto.dados.imagem)).status, 404);
    assert.equal((await loja.delete(`/api/produtos/${produto.id}`)).status, 404);
  });
});

test('página Sobre: texto, trajetória e foto', async () => {
  const r = await loja.put('/api/sobre', {
    titulo: 'Nossa história', texto: 'Linha 1\nLinha 2',
    trajetoria: [{ ano: '2020', titulo: 'Começo', texto: 'Primeiros pedidos' }, { titulo: 'Sem ano' }],
  });
  assert.equal(r.status, 200);
  assert.equal(r.dados.trajetoria.length, 2);
  assert.deepEqual(r.dados.trajetoria[1], { ano: '', titulo: 'Sem ano', texto: '' });
  assert.equal((await visitante.get('/api/site')).dados.sobre.titulo, 'Nossa história');

  assert.equal((await loja.put('/api/sobre', { titulo: '', trajetoria: [] })).status, 400);
  assert.equal((await loja.put('/api/sobre', { titulo: 'X' })).status, 400);
  assert.equal((await loja.put('/api/sobre', { titulo: 'X', trajetoria: [{ titulo: '' }] })).status, 400);

  const foto = await loja.put('/api/sobre/imagem', { imagem: PNG_1X1 });
  assert.match(foto.dados.imagem, /^\/uploads\/sobre-\d+\.png$/);
  // Salvar o texto de novo não apaga a foto.
  const denovo = await loja.put('/api/sobre', { titulo: 'Nossa história', texto: '', trajetoria: [] });
  assert.equal(denovo.dados.imagem, foto.dados.imagem);
  assert.equal((await loja.put('/api/sobre/imagem', { imagem: '' })).dados.imagem, '');
});

test('dados da loja: grava, limpa e aparece no site', async () => {
  const r = await loja.put('/api/loja', {
    nome: 'Loja de Teste', slogan: 'Um slogan', whatsapp: '(11) 91234-5678', instagram: '@loja.teste!', email: 'oi@loja.com', endereco: ' Rua do Sol, 10 - Centro ', cidade: 'Recife, PE',
  });
  assert.equal(r.status, 200);
  assert.deepEqual(r.dados, { nome: 'Loja de Teste', slogan: 'Um slogan', whatsapp: '11912345678', instagram: 'loja.teste', email: 'oi@loja.com', endereco: 'Rua do Sol, 10 - Centro', cidade: 'Recife, PE' });
  assert.deepEqual((await visitante.get('/api/site')).dados.loja, r.dados);
  assert.equal((await loja.put('/api/loja', { nome: '' })).status, 400);
  assert.equal((await loja.put('/api/loja', { nome: 'x'.repeat(61) })).status, 400);
});

test('senha da loja: exige a atual, derruba as outras sessões e mantém a de quem trocou', async () => {
  const outraSessao = servidor.navegador();
  await outraSessao.entrarComoAdmin();
  assert.equal((await loja.get('/api/dashboard')).dados.senhaInicial, true);

  assert.equal((await loja.put('/api/senha', { atual: 'nao-e-essa', nova: 'nova-senha-loja-1' })).status, 400);
  assert.equal((await loja.put('/api/senha', { atual: SENHA_ADMIN, nova: 'curta' })).status, 400);
  assert.equal((await loja.put('/api/senha', { atual: SENHA_ADMIN, nova: 'nova-senha-loja-1' })).status, 200);

  assert.equal((await loja.get('/api/dashboard')).status, 200);
  assert.equal((await loja.get('/api/dashboard')).dados.senhaInicial, false);
  assert.equal((await outraSessao.get('/api/dashboard')).status, 401);
  assert.equal((await servidor.navegador().post('/api/login', { usuario: 'confeiteira', senha: SENHA_ADMIN })).status, 401);
  assert.equal((await servidor.navegador().post('/api/login', { usuario: 'confeiteira', senha: 'nova-senha-loja-1' })).status, 200);
});

test('limite de tentativas de login por IP', async () => {
  const nav = servidor.navegador({ ipFixo: '203.0.113.7' });
  for (let i = 0; i < 8; i++) {
    assert.equal((await nav.post('/api/login', { usuario: 'confeiteira', senha: 'errada-errada' })).status, 401, `tentativa ${i + 1}`);
  }
  assert.equal((await nav.post('/api/login', { usuario: 'confeiteira', senha: 'errada-errada' })).status, 429);
  // Nem a senha certa passa enquanto o IP está bloqueado; outro IP continua entrando.
  assert.equal((await nav.post('/api/login', { usuario: 'confeiteira', senha: 'nova-senha-loja-1' })).status, 429);
  assert.equal((await servidor.navegador().post('/api/login', { usuario: 'confeiteira', senha: 'nova-senha-loja-1' })).status, 200);
});

test('sem TRUST_PROXY o cabeçalho X-Forwarded-For é ignorado', async () => {
  // Se o servidor acreditasse no cabeçalho, bastaria inventar um IP por tentativa para nunca ser bloqueado.
  const direto = await subirServidor({ TRUST_PROXY: '0' });
  try {
    const nav = direto.navegador(); // manda um X-Forwarded-For diferente a cada chamada
    let ultimo;
    for (let i = 0; i < 9; i++) ultimo = await nav.post('/api/login', { usuario: 'confeiteira', senha: 'errada-errada' });
    assert.equal(ultimo.status, 429);
  } finally {
    await direto.parar();
  }
});
