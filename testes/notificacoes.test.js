'use strict';
// Notificações: fila gravada junto com o pedido, envio por canal, novas tentativas, modelos e histórico.
// O WhatsApp e o SMS falam com um serviço falso, que sobe aqui mesmo e guarda o que recebeu.

const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const path = require('node:path');
const { DatabaseSync } = require('node:sqlite');
const { subirServidor, dadosCliente, hojeLocal } = require('./apoio');

const TOKEN_WHATSAPP = 'token-secreto-do-whatsapp';
const TOKEN_SMS = 'token-secreto-do-sms';

let servidor, servico, dona, visitante, cliente, dados, produtos;

// Serviço de envio de mentira: responde como a Meta e a Twilio responderiam, ou como `responder` mandar.
function subirServico() {
  const recebidos = [];
  const estado = { responder: null };
  const padrao = (pedido) => (pedido.caminho.includes('/messages')
    ? { status: 200, corpo: { messages: [{ id: `wamid.${recebidos.length}` }] } }
    : { status: 201, corpo: { sid: `SM${recebidos.length}` } });
  const srv = http.createServer((req, res) => {
    let corpo = '';
    req.on('data', (parte) => { corpo += parte; });
    req.on('end', () => {
      const tipo = req.headers['content-type'] || '';
      const pedido = {
        caminho: req.url, autorizacao: req.headers.authorization, canal: req.url.includes('/messages') ? 'whatsapp' : 'sms',
        corpo: tipo.includes('json') ? JSON.parse(corpo) : Object.fromEntries(new URLSearchParams(corpo)),
      };
      recebidos.push(pedido);
      const r = (estado.responder || padrao)(pedido) || padrao(pedido);
      res.writeHead(r.status, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(r.corpo));
    });
  });
  return new Promise((resolve) => {
    srv.listen(0, '127.0.0.1', () => resolve({
      url: `http://127.0.0.1:${srv.address().port}`, recebidos, estado,
      limpar() { recebidos.length = 0; estado.responder = null; },
      parar: () => new Promise((fim) => { srv.closeAllConnections(); srv.close(fim); }),
    }));
  });
}

const historico = async (consulta = '', quem = dona) => (await quem.get(`/api/notificacoes${consulta}`)).dados;
const config = async () => (await dona.get('/api/configuracoes')).dados.notificacoes;
const gravar = (cfg, quem = dona) => quem.put('/api/configuracoes/notificacoes', cfg);
const pedir = async () => (await cliente.post('/api/pedidos', {
  cliente: { nome: dados.nome, telefone: dados.telefone }, entrega: { tipo: 'retirada', data: hojeLocal(1) },
  itens: [{ produtoId: produtos[0].id, quantidade: 2 }],
})).dados.numero;
const idDoPedido = async (numero) => (await dona.get('/api/pedidos')).dados.itens.find((p) => p.numero === numero).id;
const mudar = async (numero, status) => dona.patch(`/api/pedidos/${await idDoPedido(numero)}`, { status });

// Espera a fila esvaziar: nenhuma mensagem pendente (o envio acontece depois da resposta ao navegador).
async function filaVazia() {
  for (let i = 0; i < 200; i++) {
    if ((await historico('?estado=pendente')).total === 0) return;
    await new Promise((r) => setTimeout(r, 50));
  }
  // Na falha, a saída do servidor e a mensagem parada ajudam a entender o que travou.
  throw new Error(`A fila de notificações não esvaziou.\n${servidor.saida()}\n${JSON.stringify((await historico()).itens.map((n) => [n.id, n.canal, n.estado, n.tentativas, n.erro]))} ${JSON.stringify(servico.recebidos.map((p) => p.caminho))}`);
}

before(async () => {
  servico = await subirServico();
  servidor = await subirServidor({
    WHATSAPP_TOKEN: TOKEN_WHATSAPP, WHATSAPP_PHONE_ID: '123456', WHATSAPP_API_URL: `${servico.url}/v99.0`,
    SMS_TWILIO_SID: 'AC123', SMS_TWILIO_TOKEN: TOKEN_SMS, SMS_TWILIO_FROM: '+15005550006', SMS_API_URL: servico.url,
    NOTIFICACOES_ESPERAS: '0.1,0.1', // duas novas tentativas, quase imediatas
    SITE_URL: 'https://loja.exemplo',
  });
  dona = servidor.navegador();
  await dona.entrarComoAdmin();
  visitante = servidor.navegador();
  cliente = servidor.navegador();
  dados = dadosCliente({ nome: 'Ana {painel}' }); // nome com cara de variável: não pode ser interpretado
  await cliente.post('/api/cadastro', dados);
  produtos = (await dona.get('/api/produtos')).dados;
  // As rotas que gravam conferem a origem: o SITE_URL acima faz parte do que é aceito, e os testes chamam sem Origin.
});
after(async () => { await servidor.parar(); await servico.parar(); });

test('de partida nada é enviado: todos os canais vêm desligados', async () => {
  const cfg = await config();
  assert.deepEqual(cfg.canais, { email: false, whatsapp: false, sms: false });
  assert.deepEqual(Object.keys(cfg.eventos), ['pedido_recebido', 'pedido_status', 'pedido_novo_loja']);
  const numero = await pedir();
  await mudar(numero, 'confirmado');
  assert.equal((await historico()).total, 0);
  assert.equal(servico.recebidos.length, 0);
});

test('opções da tela: canais configurados no servidor (só sim ou não), acontecimentos e variáveis', async () => {
  assert.equal((await visitante.get('/api/notificacoes/opcoes')).status, 401);
  assert.equal((await cliente.get('/api/notificacoes/opcoes')).status, 401);
  const r = await dona.get('/api/notificacoes/opcoes');
  assert.deepEqual(r.dados.canais, [
    { id: 'email', nome: 'E-mail', configurado: false }, { id: 'whatsapp', nome: 'WhatsApp', configurado: true }, { id: 'sms', nome: 'SMS', configurado: true },
  ]);
  assert.deepEqual(r.dados.eventos.map((e) => [e.id, e.para]), [['pedido_recebido', 'cliente'], ['pedido_status', 'cliente'], ['pedido_novo_loja', 'loja']]);
  assert.ok(r.dados.variaveis.some((v) => v.id === 'numero'));
  assert.doesNotMatch(r.texto, /secreto|AC123|123456/);
});

test('modelos: só variáveis da lista; o que é inválido não é gravado', async () => {
  const base = await config();
  const com = (mudanca) => { const copia = structuredClone(base); mudanca(copia); return copia; };
  const casos = [
    com((c) => { c.eventos.pedido_recebido.sms.corpo = 'Olá, {nome}!'; }),
    com((c) => { c.eventos.pedido_recebido.email.assunto = 'Pedido {numeros}'; }),
    com((c) => { c.eventos.pedido_status.email.corpo = 'Veja {}'; }),
    com((c) => { c.eventos.pedido_status.sms.corpo = ''; }),
    com((c) => { c.eventos.pedido_status.sms.corpo = 'x'.repeat(301); }),
    com((c) => { c.eventos.pedido_recebido.whatsapp.modelo = 'Nome Com Espaço'; }),
    com((c) => { c.eventos.pedido_recebido.whatsapp.idioma = 'português'; }),
    com((c) => { c.eventos.pedido_recebido.whatsapp.parametros = ['cliente', 'senha']; }),
    com((c) => { c.eventos.pedido_recebido.whatsapp.parametros = Array(11).fill('cliente'); }),
    com((c) => { delete c.eventos.pedido_novo_loja; }),
  ];
  for (const corpo of casos) assert.equal((await gravar(corpo)).status, 400, JSON.stringify(corpo).slice(0, 200));
  assert.deepEqual(await config(), base);
  assert.equal((await gravar(base, visitante)).status, 401);
  assert.equal((await gravar(base, cliente)).status, 401);
});

test('pedido novo: SMS e WhatsApp para o cliente e aviso para a loja, com os dados do pedido', async () => {
  await dona.put('/api/loja', { nome: 'Doces da Dona', whatsapp: '(11) 3333-4444' });
  const cfg = await config();
  cfg.canais = { email: true, whatsapp: true, sms: true }; // e-mail ligado, mas sem SMTP no servidor: não entra na fila
  cfg.eventos.pedido_recebido.whatsapp = { modelo: 'pedido_recebido', idioma: 'pt_BR', parametros: ['cliente', 'numero', 'total'] };
  assert.equal((await gravar(cfg)).status, 200);

  const numero = await pedir();
  await filaVazia();
  const total = `R$ ${((produtos[0].preco * 2) / 100).toFixed(2).replace('.', ',')}`;

  const itens = (await historico()).itens.reverse();
  assert.deepEqual(itens.map((n) => [n.evento, n.canal, n.para, n.destinatario, n.pedidoNumero, n.estado, n.tentativas]), [
    ['pedido_recebido', 'whatsapp', 'cliente', '5511987654321', numero, 'enviada', 1],
    ['pedido_recebido', 'sms', 'cliente', '5511987654321', numero, 'enviada', 1],
    ['pedido_novo_loja', 'sms', 'loja', '551133334444', numero, 'enviada', 1], // WhatsApp da loja: sem modelo, não vai
  ]);
  assert.ok(itens.every((n) => n.enviadaEm && !n.erro && !n.proximaEm));

  const [whats, smsCliente, smsLoja] = servico.recebidos;
  assert.equal(whats.caminho, '/v99.0/123456/messages');
  assert.equal(whats.autorizacao, `Bearer ${TOKEN_WHATSAPP}`);
  assert.deepEqual(whats.corpo, {
    messaging_product: 'whatsapp', to: '5511987654321', type: 'template',
    template: { name: 'pedido_recebido', language: { code: 'pt_BR' }, components: [{ type: 'body', parameters: [
      { type: 'text', text: 'Ana {painel}' }, { type: 'text', text: String(numero) }, { type: 'text', text: total },
    ] }] },
  });
  assert.equal(smsCliente.caminho, '/2010-04-01/Accounts/AC123/Messages.json');
  assert.equal(smsCliente.autorizacao, `Basic ${Buffer.from(`AC123:${TOKEN_SMS}`).toString('base64')}`);
  assert.deepEqual(smsCliente.corpo, {
    To: '+5511987654321', From: '+15005550006',
    Body: `Doces da Dona: recebemos seu pedido nº ${numero} (${total}). Retirada em ${hojeLocal(1).split('-').reverse().join('/')}.`,
  });
  // O nome do cliente entra como texto: o "{painel}" que ele digitou não vira o endereço do painel.
  assert.equal(smsLoja.corpo.To, '+551133334444');
  assert.match(smsLoja.corpo.Body, new RegExp(`^Novo pedido nº ${numero}: Ana \\{painel\\}, `));
  // Nenhuma credencial aparece no histórico.
  assert.doesNotMatch(JSON.stringify(await historico()), /secreto|Bearer|Basic/);
});

test('mudança de status: avisa o cliente a cada mudança, menos nos status silenciados', async () => {
  servico.limpar();
  const antes = (await historico()).total;
  const numero = await pedir();
  await filaVazia();
  servico.limpar();

  await mudar(numero, 'confirmado');
  await mudar(numero, 'producao');
  await mudar(numero, 'confirmado'); // voltou a um status em que já esteve: é outra mudança, avisa de novo
  await filaVazia();
  assert.deepEqual(servico.recebidos.map((p) => p.corpo.Body), [
    `Doces da Dona: seu pedido nº ${numero} agora está: Confirmado.`,
    `Doces da Dona: seu pedido nº ${numero} agora está: Em produção.`,
    `Doces da Dona: seu pedido nº ${numero} agora está: Confirmado.`,
  ]);

  // "Pronto" silenciado: a mudança acontece, mas ninguém é avisado.
  const cfg = await config();
  cfg.eventos.pedido_status.silenciados = ['pronto'];
  await gravar(cfg);
  servico.limpar();
  assert.equal((await mudar(numero, 'pronto')).status, 200);
  await mudar(numero, 'entregue');
  await filaVazia();
  assert.deepEqual(servico.recebidos.map((p) => p.corpo.Body), [`Doces da Dona: seu pedido nº ${numero} agora está: Entregue.`]);

  // Acontecimento desligado: nada entra na fila. Mudança recusada também não avisa.
  cfg.eventos.pedido_status.ativo = false;
  await gravar(cfg);
  servico.limpar();
  assert.equal((await mudar(numero, 'novo')).status, 409); // de "Entregue" não se vai para "Novo"
  assert.equal((await mudar(numero, 'pronto')).status, 200);
  await filaVazia();
  assert.equal(servico.recebidos.length, 0);
  assert.equal((await historico()).total, antes + 3 + 4, 'pedido novo: 3 mensagens; status: 4');
  cfg.eventos.pedido_status.ativo = true;
  cfg.eventos.pedido_status.silenciados = [];
  await gravar(cfg);
});

test('falha passageira: o pedido é aceito mesmo assim e o envio é tentado de novo até dar certo', async () => {
  servico.limpar();
  let falhas = 0;
  servico.estado.responder = (p) => (p.canal === 'sms' && p.corpo.To === '+5511987654321' && falhas++ < 2 ? { status: 503, corpo: { message: 'Serviço fora do ar' } } : null);
  const numero = await pedir();
  assert.ok(numero > 0);
  await filaVazia();
  const sms = (await historico()).itens.find((n) => n.pedidoNumero === numero && n.canal === 'sms' && n.para === 'cliente');
  assert.deepEqual([sms.estado, sms.tentativas, sms.erro], ['enviada', 3, '']);
  assert.equal(servico.recebidos.filter((p) => p.corpo.To === '+5511987654321').length, 3);
});

test('falha que não passa: depois das tentativas a mensagem fica como "falhou" e pode ser reenviada', async () => {
  servico.limpar();
  servico.estado.responder = (p) => (p.canal === 'sms' ? { status: 500, corpo: { message: 'Erro interno' } } : null);
  const numero = await pedir();
  await filaVazia();
  const falhou = (await historico('?estado=falhou')).itens.filter((n) => n.pedidoNumero === numero);
  assert.deepEqual(falhou.map((n) => [n.para, n.estado, n.tentativas]).sort(), [['cliente', 'falhou', 3], ['loja', 'falhou', 3]]);
  assert.match(falhou[0].erro, /recusou \(500\): Erro interno/);
  assert.equal((await historico('?estado=enviada')).itens.some((n) => n.pedidoNumero === numero && n.canal === 'whatsapp'), true, 'um canal falhar não segura o outro');

  // Recusa definitiva (número inválido, por exemplo): não adianta insistir, falha na primeira.
  servico.limpar();
  servico.estado.responder = (p) => (p.canal === 'sms' ? { status: 400, corpo: { message: 'The number is not valid' } } : null);
  const outro = await pedir();
  await filaVazia();
  const definitiva = (await historico('?estado=falhou')).itens.find((n) => n.pedidoNumero === outro && n.para === 'cliente');
  assert.deepEqual([definitiva.tentativas, definitiva.erro], [1, 'O serviço de envio recusou (400): The number is not valid']);
  assert.equal(servico.recebidos.filter((p) => p.corpo.To === '+5511987654321').length, 1);

  // Reenviar: só o que falhou, e sai na hora.
  servico.limpar();
  const r = await dona.post(`/api/notificacoes/${definitiva.id}/reenviar`);
  assert.deepEqual([r.status, r.dados.estado, r.dados.tentativas], [200, 'enviada', 1]);
  assert.equal(servico.recebidos.length, 1);
  assert.equal((await dona.post(`/api/notificacoes/${definitiva.id}/reenviar`)).status, 409);
  assert.equal((await dona.post('/api/notificacoes/999999/reenviar')).status, 404);
  assert.equal((await visitante.post(`/api/notificacoes/${falhou[0].id}/reenviar`)).status, 401);
  assert.deepEqual((await dona.get('/api/auditoria')).dados.itens[0].acao, 'Reenviou uma notificação');
});

test('serviço fora do ar (sem resposta) também vale nova tentativa', async () => {
  servico.limpar();
  const cfg = await config();
  cfg.eventos.pedido_novo_loja.ativo = false;
  cfg.canais.whatsapp = false;
  await gravar(cfg);
  servico.estado.responder = null;
  // Fecha a conexão sem responder nas duas primeiras tentativas.
  let quedas = 0;
  servico.estado.responder = () => (quedas++ < 2 ? { status: 502, corpo: {} } : null);
  const numero = await pedir();
  await filaVazia();
  const sms = (await historico()).itens.find((n) => n.pedidoNumero === numero);
  assert.deepEqual([sms.estado, sms.tentativas], ['enviada', 3]);
});

test('envio de teste: sai na hora e mostra o resultado; só para quem acompanha as notificações', async () => {
  servico.limpar();
  const r = await dona.post('/api/notificacoes/teste', { canal: 'sms', destinatario: '(21) 97777-6666' });
  assert.deepEqual([r.status, r.dados.estado, r.dados.para, r.dados.destinatario], [200, 'enviada', 'teste', '5521977776666']);
  assert.match(servico.recebidos[0].corpo.Body, /^Doces da Dona: recebemos seu pedido nº 0 \(R\$ 50,00\)/);

  servico.estado.responder = () => ({ status: 401, corpo: { message: 'Authenticate' } });
  const recusado = await dona.post('/api/notificacoes/teste', { canal: 'sms', destinatario: '21977776666' });
  assert.deepEqual([recusado.status, recusado.dados.estado, recusado.dados.erro], [200, 'falhou', 'O serviço de envio recusou (401): Authenticate']);

  assert.equal((await dona.post('/api/notificacoes/teste', { canal: 'sms', destinatario: '123' })).status, 400);
  assert.equal((await dona.post('/api/notificacoes/teste', { canal: 'pombo', destinatario: '21977776666' })).status, 400);
  assert.equal((await dona.post('/api/notificacoes/teste', { canal: 'email', destinatario: 'a@b.com' })).status, 409, 'sem SMTP no servidor');
  assert.equal((await visitante.post('/api/notificacoes/teste', { canal: 'sms', destinatario: '21977776666' })).status, 401);

  // Atendimento não tem a permissão: nem histórico, nem teste, nem reenvio.
  const perfis = (await dona.get('/api/equipe')).dados.perfis;
  await dona.post('/api/usuarios', { usuario: 'bia', nome: 'Bia', perfilId: perfis.find((p) => p.nome === 'Atendimento').id, senha: 'senha-da-bia-1' });
  const bia = servidor.navegador();
  await bia.post('/api/login', { usuario: 'bia', senha: 'senha-da-bia-1' });
  assert.equal((await bia.get('/api/notificacoes')).status, 403);
  assert.equal((await bia.post('/api/notificacoes/teste', { canal: 'sms', destinatario: '21977776666' })).status, 403);
  assert.equal((await bia.post('/api/notificacoes/1/reenviar')).status, 403);
  assert.equal((await bia.get('/api/notificacoes/opcoes')).status, 200);
});

test('histórico: paginado, do mais recente para o mais antigo, com filtro por estado', async () => {
  const tudo = await historico();
  assert.ok(tudo.total > 10);
  assert.ok(tudo.itens.every((n, i) => i === 0 || n.id < tudo.itens[i - 1].id));
  assert.deepEqual(Object.keys(tudo.itens[0]).sort(), ['canal', 'criadaEm', 'destinatario', 'enviadaEm', 'erro', 'estado', 'evento', 'id', 'para', 'pedidoNumero', 'proximaEm', 'resumo', 'tentativas']);
  for (const estado of ['enviada', 'falhou']) {
    const parte = await historico(`?estado=${estado}`);
    assert.ok(parte.total > 0 && parte.itens.every((n) => n.estado === estado), estado);
  }
  assert.equal((await dona.get('/api/notificacoes?estado=sumiu')).status, 400);
  assert.equal((await visitante.get('/api/notificacoes')).status, 401);
  assert.equal((await cliente.get('/api/notificacoes')).status, 401);
});

test('a mesma mensagem não entra duas vezes na fila', async () => {
  const db = new DatabaseSync(path.join(servidor.pasta, 'loja.db'));
  try {
    db.exec('PRAGMA busy_timeout = 5000');
    const { chave } = db.prepare("SELECT chave FROM notificacoes WHERE evento = 'pedido_recebido' LIMIT 1").get();
    assert.match(chave, /^pedido:\d+:recebido:cliente:(whatsapp|sms)$/);
    assert.throws(() => db.prepare("INSERT INTO notificacoes (chave, evento, canal, para, destinatario, conteudo, criada_em) VALUES (?, 'x', 'sms', 'cliente', '1', '{}', 'x')").run(chave), /UNIQUE/);
    assert.throws(() => db.exec("INSERT INTO notificacoes (chave, evento, canal, para, destinatario, conteudo, criada_em) VALUES ('k', 'x', 'pombo', 'cliente', '1', '{}', 'x')"), /CHECK/);
  } finally {
    db.close();
  }
});
