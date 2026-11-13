'use strict';
// Rotas das notificações: o que a tela precisa para montar os formulários, o histórico da fila, reenviar e testar.
// Os textos e os canais ligados são uma seção das configurações: gravam por PUT /api/configuracoes/notificacoes
// (src/rotas/loja.js), com a permissão de configurações.

const banco = require('../../banco');
const { ErroHttp, lerJson, ipDe, limitar, lerPagina, pagina } = require('../http');
const { anotar } = require('../auditoria');
const { CANAIS } = require('../notificacoes/canais');
const { EVENTOS, VARIAVEIS } = require('../notificacoes/modelos');
const fila = require('../notificacoes/fila');

const POR_PAGINA = 30;
const ESTADOS = ['pendente', 'enviada', 'falhou'];
const ACOMPANHAR = 'notificacoes.gerenciar';

// O que sai para a tela de uma linha da fila. `resumo` é o texto enviado (assunto do e-mail, SMS, campos do modelo).
const publica = (n) => ({
  id: n.id, evento: n.evento, canal: n.canal, para: n.para, destinatario: n.destinatario, pedidoNumero: n.pedidoNumero,
  resumo: CANAIS[n.canal].resumo(n.conteudo), estado: n.estado, tentativas: n.tentativas, proximaEm: n.proximaEm,
  criadaEm: n.criadaEm, enviadaEm: n.enviadaEm, erro: n.erro,
});

module.exports = [
  // Para montar a tela: quais canais o servidor tem configurados (só sim ou não: as credenciais nunca saem do
  // servidor), os acontecimentos e as variáveis que os textos podem usar.
  ['GET', /^\/api\/notificacoes\/opcoes$/, () => ({
    canais: Object.entries(CANAIS).map(([id, c]) => ({ id, nome: c.nome, configurado: c.configurado })),
    eventos: EVENTOS.map(({ id, nome, para, descricao }) => ({ id, nome, para, descricao })),
    variaveis: VARIAVEIS, guardarDias: fila.GUARDAR_DIAS,
  }), true],

  // Histórico da fila, da mensagem mais recente para a mais antiga: ?pagina=2&estado=falhou.
  ['GET', /^\/api\/notificacoes$/, (req, _p, _res, url) => {
    const estado = url.searchParams.get('estado') || '';
    if (estado && !ESTADOS.includes(estado)) throw new ErroHttp(400, 'Estado inválido.');
    const numero = lerPagina(url);
    const { itens, total } = banco.paginarNotificacoes({ estado, pagina: numero, porPagina: POR_PAGINA });
    return pagina(itens.map(publica), total, numero, POR_PAGINA);
  }, ACOMPANHAR],

  // Mensagem que falhou volta para a fila e sai de novo agora.
  ['POST', /^\/api\/notificacoes\/(\d{1,12})\/reenviar$/, async (req, [id]) => {
    const atual = banco.notificacaoPorId(Number(id));
    if (!atual) throw new ErroHttp(404, 'Mensagem não encontrada.');
    if (!banco.reabrirNotificacao(atual.id)) throw new ErroHttp(409, 'Só dá para reenviar uma mensagem que falhou.');
    anotar(req, `${CANAIS[atual.canal].nome}${atual.pedidoNumero ? `, pedido nº ${atual.pedidoNumero}` : ''}`);
    await fila.processar();
    return publica(banco.notificacaoPorId(atual.id));
  }, ACOMPANHAR, 'Reenviou uma notificação'],

  // Envia agora uma mensagem de teste (o modelo de "Pedido recebido", com dados de exemplo) e devolve o resultado.
  ['POST', /^\/api\/notificacoes\/teste$/, async (req) => {
    limitar(`teste-notificacao:${ipDe(req)}`, 10, 10 * 60 * 1000); // cada teste pode custar um envio pago
    const { canal: id, destinatario } = await lerJson(req);
    const canal = Object.hasOwn(CANAIS, id) ? CANAIS[id] : null;
    if (!canal) throw new ErroHttp(400, 'Canal inválido.');
    if (!canal.configurado) throw new ErroHttp(409, `O canal ${canal.nome} não está configurado no servidor (veja o README).`);
    const destino = canal.destino({ email: String(destinatario || '').trim(), telefone: destinatario });
    if (!destino) throw new ErroHttp(400, id === 'email' ? 'Informe um e-mail válido.' : 'Informe um telefone com DDD.');
    const criada = fila.enfileirarTeste(id, destino);
    if (!criada) throw new ErroHttp(409, 'Preencha e salve o modelo de "Pedido recebido" deste canal antes de testar.');
    anotar(req, canal.nome);
    await fila.processar();
    return publica(banco.notificacaoPorId(criada.id));
  }, ACOMPANHAR, 'Enviou uma notificação de teste'],
];
