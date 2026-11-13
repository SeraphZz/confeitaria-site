'use strict';
// Configurações centralizadas: o que é público, o que o painel edita, o que nunca sai, e o fuso horário da loja.

const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { subirServidor, dadosCliente, hojeLocal } = require('./apoio');
const { diaNoFuso, somarDias, instanteAntesDoDia, fusoValido } = require('../src/datas');

let servidor, loja, visitante, cliente, dados, produtos;
before(async () => {
  servidor = await subirServidor();
  loja = servidor.navegador();
  await loja.entrarComoAdmin();
  visitante = servidor.navegador();
  cliente = servidor.navegador();
  dados = dadosCliente();
  await cliente.post('/api/cadastro', dados);
  produtos = (await loja.get('/api/produtos')).dados;
});
after(() => servidor.parar());

const pedidoPara = (data) => ({
  cliente: { nome: dados.nome, telefone: dados.telefone }, entrega: { tipo: 'retirada', data },
  itens: [{ produtoId: produtos[0].id, quantidade: 1 }],
});

test('datas: o dia depende do fuso da loja, não do servidor', () => {
  const instante = new Date('2026-11-13T01:30:00Z'); // 22h30 do dia 12 em São Paulo
  assert.equal(diaNoFuso(instante, 'America/Sao_Paulo'), '2026-11-12');
  assert.equal(diaNoFuso(instante, 'UTC'), '2026-11-13');
  assert.equal(diaNoFuso(instante, 'Asia/Tokyo'), '2026-11-13');
  assert.equal(somarDias('2026-03-01', -1), '2026-02-28');
  assert.equal(somarDias('2028-02-28', 1), '2028-02-29');
  assert.equal(somarDias('2026-12-31', 1), '2027-01-01');
  assert.equal(instanteAntesDoDia('2026-11-12'), '2026-11-11T00:00:00.000Z');
  assert.equal(fusoValido('America/Manaus'), true);
  for (const ruim of ['Marte/Olimpo', '', null, 42, 'x'.repeat(65)]) assert.equal(fusoValido(ruim), false, String(ruim));
});

test('visitante recebe só as seções públicas', async () => {
  const r = await visitante.get('/api/site');
  assert.deepEqual(Object.keys(r.dados).sort(), ['admin', 'atendimento', 'catalogo', 'cliente', 'loja', 'modulos', 'previaTema', 'sobre', 'statusPedidos', 'tema', 'usuario']);
  assert.equal(r.dados.usuario, null);
  // Dos status de pedido, o visitante recebe só o necessário para mostrar o nome.
  assert.deepEqual(r.dados.statusPedidos[0], { id: 'novo', nome: 'Novo', tipo: 'aberto' });
  assert.doesNotMatch(r.texto, /hash|salt|confeiteira|fusoHorario/);
});

test('painel lê as seções editáveis, e nunca a conta de acesso', async () => {
  assert.equal((await visitante.get('/api/configuracoes')).status, 401);
  assert.equal((await cliente.get('/api/configuracoes')).status, 401);
  const r = await loja.get('/api/configuracoes');
  assert.equal(r.status, 200);
  assert.deepEqual(Object.keys(r.dados).sort(), ['atendimento', 'catalogo', 'loja', 'modulos', 'operacao', 'sobre']);
  assert.deepEqual(r.dados.operacao, { fusoHorario: 'America/Sao_Paulo' }); // padrão, sem nada gravado no banco
  assert.doesNotMatch(r.texto, /hash|salt|confeiteira"/);
});

test('seção interna ou desconhecida não pode ser gravada pelo painel', async () => {
  for (const secao of ['admin', 'inexistente', 'constructor', 'toString']) {
    const r = await loja.put(`/api/configuracoes/${secao}`, { usuario: 'invasor', salt: 'x', hash: 'y' });
    assert.equal(r.status, 404, secao);
  }
  assert.equal((await visitante.put('/api/configuracoes/operacao', { fusoHorario: 'UTC' })).status, 401);
  // A conta de acesso continua intacta.
  assert.equal((await servidor.navegador().entrarComoAdmin()).status, 200);
});

test('seções editáveis passam pela mesma validação dos endereços antigos', async () => {
  assert.equal((await loja.put('/api/configuracoes/loja', { nome: '' })).status, 400);
  const r = await loja.put('/api/configuracoes/loja', { nome: 'Empório Central', instagram: '@emporio', campoInventado: 'x' });
  assert.equal(r.status, 200);
  assert.deepEqual(r.dados, { nome: 'Empório Central', slogan: '', whatsapp: '', instagram: 'emporio', email: '', endereco: '', cidade: '' });
  assert.equal((await visitante.get('/api/site')).dados.loja.nome, 'Empório Central');
});

test('fuso horário: recusa valor inválido e muda o que é "hoje" para os pedidos', async () => {
  assert.equal((await loja.put('/api/configuracoes/operacao', { fusoHorario: 'Marte/Olimpo' })).status, 400);
  assert.equal((await loja.put('/api/configuracoes/operacao', {})).status, 400);

  // Kiritimati (UTC+14) e Pago Pago (UTC-11) estão a 25 horas um do outro: nunca é o mesmo dia nos dois.
  const adiantado = 'Pacific/Kiritimati', atrasado = 'Pacific/Pago_Pago';
  const hojeAtrasado = hojeLocal(0, atrasado);
  assert.ok(hojeAtrasado < hojeLocal(0, adiantado));

  assert.equal((await loja.put('/api/configuracoes/operacao', { fusoHorario: adiantado })).status, 200);
  assert.equal((await cliente.post('/api/pedidos', pedidoPara(hojeAtrasado))).status, 400, 'no fuso adiantado, essa data já passou');
  assert.equal((await cliente.post('/api/pedidos', pedidoPara(hojeLocal(0, adiantado)))).status, 200);

  assert.equal((await loja.put('/api/configuracoes/operacao', { fusoHorario: atrasado })).status, 200);
  assert.equal((await cliente.post('/api/pedidos', pedidoPara(hojeAtrasado))).status, 200, 'no fuso atrasado, essa data é hoje');
});

test('resumo do painel usa os dias do fuso da loja', async () => {
  for (const fuso of ['Pacific/Kiritimati', 'Pacific/Pago_Pago', 'America/Sao_Paulo']) {
    await loja.put('/api/configuracoes/operacao', { fusoHorario: fuso });
    const r = (await loja.get('/api/dashboard?dias=7')).dados;
    assert.equal(r.serie.length, 7, fuso);
    assert.equal(r.serie.at(-1).data, hojeLocal(0, fuso), fuso);
    assert.equal(r.serie[0].data, hojeLocal(-6, fuso), fuso);
    // Os dois pedidos acabaram de ser feitos: caem no último dia, seja qual for o fuso.
    assert.equal(r.kpis.pedidos, 2, fuso);
    assert.equal(r.serie.at(-1).pedidos, 2, fuso);
    assert.equal(r.kpis.receita, produtos[0].preco * 2, fuso);
  }
});
