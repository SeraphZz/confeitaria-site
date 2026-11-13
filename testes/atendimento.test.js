'use strict';
// Horários de funcionamento e formas de receber o pedido (retirada e entrega).

const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { subirServidor, dadosCliente, hojeLocal } = require('./apoio');

let servidor, loja, visitante, cliente, dados, produto;
before(async () => {
  servidor = await subirServidor();
  loja = servidor.navegador();
  await loja.entrarComoAdmin();
  visitante = servidor.navegador();
  cliente = servidor.navegador();
  dados = dadosCliente();
  await cliente.post('/api/cadastro', dados);
  [produto] = (await visitante.get('/api/produtos')).dados;
});
after(() => servidor.parar());

const ENDERECO = { cep: '01001-000', rua: 'Praça da Sé', numero: '10', cidade: 'São Paulo', uf: 'SP' };
const pedido = (tipo) => ({
  cliente: { nome: dados.nome, telefone: dados.telefone },
  entrega: { tipo, data: hojeLocal(1), ...(tipo === 'entrega' ? { endereco: ENDERECO } : {}) },
  itens: [{ produtoId: produto.id, quantidade: 1 }],
});

const dia = (extra = {}) => ({ aberto: false, abre: '09:00', fecha: '18:00', abre2: '', fecha2: '', ...extra });
// Corpo válido completo; cada teste troca só o que interessa.
const corpo = (extra = {}) => ({
  exibirHorarios: true,
  horarios: [dia(), dia({ aberto: true }), dia({ aberto: true }), dia({ aberto: true }), dia({ aberto: true }), dia({ aberto: true }), dia({ aberto: true, fecha: '13:00' })],
  observacaoHorarios: 'Fechado em feriados',
  retirada: { ativa: true, instrucoes: 'Rua das Flores, 10' },
  entrega: { ativa: true, taxa: 'R$ 8,00', instrucoes: 'Só no centro' },
  ...extra,
});
const gravar = (extra) => loja.put('/api/configuracoes/atendimento', corpo(extra));

test('instalação nova: retirada e entrega ligadas, horários não divulgados', async () => {
  const { atendimento } = (await visitante.get('/api/site')).dados;
  assert.equal(atendimento.exibirHorarios, false);
  assert.equal(atendimento.horarios.length, 7);
  assert.ok(atendimento.horarios.every((d) => d.aberto === false));
  assert.deepEqual(atendimento.retirada, { ativa: true, instrucoes: '' });
  assert.deepEqual(atendimento.entrega, { ativa: true, taxa: 'taxa a combinar', instrucoes: '' });
});

test('só a loja altera; o visitante recebe o que foi gravado', async () => {
  assert.equal((await visitante.put('/api/configuracoes/atendimento', corpo())).status, 401);
  assert.equal((await cliente.put('/api/configuracoes/atendimento', corpo())).status, 401);
  const r = await gravar();
  assert.equal(r.status, 200);
  assert.deepEqual(r.dados, corpo());
  assert.deepEqual((await visitante.get('/api/site')).dados.atendimento, corpo());
});

test('horários inválidos são recusados com uma mensagem que diz o dia', async () => {
  const comDia = (i, extra) => { const h = corpo().horarios; h[i] = dia(extra); return { horarios: h }; };
  const casos = [
    [{ horarios: [] }, /sete dias/],
    [{ horarios: corpo().horarios.slice(0, 6) }, /sete dias/],
    [{ horarios: 'sempre' }, /sete dias/],
    [comDia(1, { aberto: true, abre: '9h' }), /segunda/],
    [comDia(2, { aberto: true, abre: '25:00' }), /terça/],
    [comDia(3, { aberto: true, abre: '09:00', fecha: '09:00' }), /quarta/],
    [comDia(4, { aberto: true, abre2: '18:00' }), /quinta.*2º período/],
    [comDia(5, { aberto: true, abre2: '18:00', fecha2: '18:00' }), /sexta/],
    [comDia(6, { aberto: true, abre: '<script>' }), /sábado/],
    [{ observacaoHorarios: 'x'.repeat(161) }, /160/],
    [{ retirada: { ativa: true, instrucoes: 'x'.repeat(301) } }, /300/],
    [{ entrega: { ativa: true, taxa: 'x'.repeat(81) } }, /80/],
  ];
  for (const [extra, mensagem] of casos) {
    const r = await gravar(extra);
    assert.equal(r.status, 400, JSON.stringify(extra).slice(0, 120));
    assert.match(r.dados.erro, mensagem);
  }
  assert.deepEqual((await visitante.get('/api/site')).dados.atendimento, corpo(), 'nada inválido foi gravado');
});

test('dois períodos no dia e fechamento depois da meia-noite são aceitos', async () => {
  const horarios = corpo().horarios;
  horarios[5] = dia({ aberto: true, abre: '11:00', fecha: '15:00', abre2: '18:00', fecha2: '23:30' }); // almoço e jantar
  horarios[6] = dia({ aberto: true, abre: '18:00', fecha: '02:00' }); // vira a noite
  const r = await gravar({ horarios });
  assert.equal(r.status, 200);
  assert.deepEqual(r.dados.horarios[5], horarios[5]);
  assert.deepEqual(r.dados.horarios[6], horarios[6]);
});

test('dia fechado não exige horário preenchido', async () => {
  const horarios = corpo().horarios;
  horarios[0] = { aberto: false, abre: '', fecha: '' };
  const r = await gravar({ horarios });
  assert.equal(r.status, 200);
  assert.deepEqual(r.dados.horarios[0], dia());
});

test('é obrigatório manter ao menos uma forma de receber', async () => {
  const r = await gravar({ retirada: { ativa: false }, entrega: { ativa: false } });
  assert.equal(r.status, 400);
  assert.match(r.dados.erro, /ao menos uma/);
});

test('forma de receber desligada não aceita pedido, mesmo que o navegador envie', async () => {
  assert.equal((await gravar({ entrega: { ativa: false, taxa: '', instrucoes: '' } })).status, 200);
  const recusado = await cliente.post('/api/pedidos', pedido('entrega'));
  assert.equal(recusado.status, 400);
  assert.match(recusado.dados.erro, /não está fazendo entregas/);
  assert.equal((await cliente.post('/api/pedidos', pedido('retirada'))).status, 200);

  assert.equal((await gravar({ retirada: { ativa: false, instrucoes: '' } })).status, 200);
  assert.equal((await cliente.post('/api/pedidos', pedido('entrega'))).status, 200);
  const semRetirada = await cliente.post('/api/pedidos', pedido('retirada'));
  assert.equal(semRetirada.status, 400);
  assert.match(semRetirada.dados.erro, /não tem retirada/);
  // Sem dizer o tipo, o servidor entende retirada (como sempre fez) e recusa do mesmo jeito.
  const semTipo = pedido('retirada');
  delete semTipo.entrega.tipo;
  assert.equal((await cliente.post('/api/pedidos', semTipo)).status, 400);

  assert.equal((await loja.get('/api/pedidos')).dados.itens.length, 2);
});

test('endereço da loja é opcional e aparece para o visitante', async () => {
  const r = await loja.put('/api/loja', { nome: 'Loja', endereco: 'Av. Brasil, 500 - Centro', cidade: 'Maringá, PR' });
  assert.equal(r.dados.endereco, 'Av. Brasil, 500 - Centro');
  assert.equal((await visitante.get('/api/site')).dados.loja.endereco, 'Av. Brasil, 500 - Centro');
  assert.equal((await loja.put('/api/loja', { nome: 'Loja', endereco: 'x'.repeat(161) })).status, 400);
  assert.equal((await loja.put('/api/loja', { nome: 'Loja' })).dados.endereco, '');
});
