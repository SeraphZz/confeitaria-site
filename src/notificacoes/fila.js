'use strict';
// Fila de notificações: põe as mensagens na tabela `notificacoes` e as envia.
//
// Quem causa a mensagem (pedido criado, status alterado) chama `aoCriarPedido` / `aoMudarStatus` DENTRO da própria
// transação: a mensagem só existe se o pedido foi gravado, e todo pedido gravado tem a mensagem na fila. O envio
// acontece depois, fora da transação e sem segurar o cliente: um trabalhador neste mesmo processo pega as pendentes,
// envia e, se falhar, marca para tentar de novo mais tarde (esperas em src/ambiente.js).
//
// Garantias e limites:
//   - a chave única impede a mesma mensagem de entrar duas vezes na fila;
//   - se o servidor cair no meio de um envio, a mensagem continua pendente e sai de novo ao subir: é melhor uma
//     mensagem repetida, muito raramente, do que uma perdida;
//   - o servidor roda em uma única instância (como o resto do sistema), então não há dois trabalhadores.

const banco = require('../../banco');
const configuracoes = require('../configuracoes');
const { SITE_URL, ESPERAS_NOTIFICACAO_S } = require('../ambiente');
const { descreverItem } = require('../catalogo');
const { CANAIS, ErroEnvio } = require('./canais');
const { EVENTOS } = require('./modelos');

const LOTE = 10;                       // mensagens por rodada
const INTERVALO_MS = 30 * 1000;        // de quanto em quanto tempo o trabalhador confere a fila
const GUARDAR_DIAS = 90;               // histórico: mensagens resolvidas há mais tempo são apagadas

const formatoBrl = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' });
const dataBr = (iso) => iso.slice(0, 10).split('-').reverse().join('/');

// Os valores das variáveis dos modelos (lista em modelos.js), tirados do pedido.
function dadosDoPedido(pedido, nomeDoStatus) {
  return {
    cliente: pedido.cliente.nome, numero: pedido.numero, total: formatoBrl.format(pedido.total / 100).replace(/ /g, ' '),
    status: nomeDoStatus, itens: pedido.itens.map((i) => `${i.quantidade}× ${descreverItem(i)}`).join(', '),
    recebimento: pedido.entrega.tipo === 'entrega' ? 'Entrega' : 'Retirada', data: dataBr(pedido.entrega.data),
    telefone: pedido.cliente.telefone, loja: configuracoes.ler('loja').nome,
    link: `${SITE_URL}/conta`, painel: `${SITE_URL}/admin#pedidos`,
  };
}

// Põe na fila as mensagens de um acontecimento, uma por canal ligado. `pessoa`: { email, telefone } de quem recebe.
// `chave` identifica o acontecimento (ex.: "pedido:12:recebido"). Devolve quantas mensagens entraram.
function enfileirar(evento, { chave, pessoa, dados, pedidoNumero }) {
  const definicao = EVENTOS.find((e) => e.id === evento);
  const cfg = configuracoes.ler('notificacoes');
  const modelo = cfg.eventos[evento];
  if (!modelo.ativo) return 0;
  let novas = 0;
  for (const [id, canal] of Object.entries(CANAIS)) {
    if (!cfg.canais[id] || !canal.configurado) continue;
    const destinatario = canal.destino(pessoa);
    const conteudo = destinatario && canal.montar(modelo[id], dados);
    if (!conteudo) continue; // a pessoa não tem esse contato, ou a loja não preencheu o modelo deste canal
    if (banco.inserirNotificacao({ chave: `${chave}:${definicao.para}:${id}`, evento, canal: id, para: definicao.para, destinatario, pedidoNumero, conteudo })) novas++;
  }
  if (novas) acordar();
  return novas;
}

// Um erro aqui nunca pode impedir o pedido: fica no log do servidor e o pedido segue.
function semDerrubar(fn) {
  try { return fn(); } catch (erro) { console.error('Falha ao preparar notificação:', erro); return 0; }
}

// Pedido novo: confirmação para o cliente e aviso para a loja. `conta` é o cliente logado que fez o pedido.
function aoCriarPedido(pedido, conta, nomeDoStatus) {
  return semDerrubar(() => {
    const dados = dadosDoPedido(pedido, nomeDoStatus);
    const loja = configuracoes.ler('loja');
    return enfileirar('pedido_recebido', { chave: `pedido:${pedido.numero}:recebido`, pessoa: { email: conta.email, telefone: pedido.cliente.telefone }, dados, pedidoNumero: pedido.numero })
      + enfileirar('pedido_novo_loja', { chave: `pedido:${pedido.numero}:novo`, pessoa: { email: loja.email, telefone: loja.whatsapp }, dados, pedidoNumero: pedido.numero });
  });
}

// Status alterado: aviso para o cliente, a menos que a loja tenha silenciado esse status.
// `mudanca` é o número da mudança no histórico do pedido: cada mudança avisa uma vez, mesmo que o pedido volte a
// um status em que já esteve.
function aoMudarStatus(pedido, status, mudanca) {
  return semDerrubar(() => {
    if (configuracoes.ler('notificacoes').eventos.pedido_status.silenciados.includes(status.id)) return 0;
    const conta = pedido.clienteId ? banco.clientePorId(pedido.clienteId) : null;
    return enfileirar('pedido_status', {
      chave: `pedido:${pedido.numero}:status:${mudanca}`, pessoa: { email: conta?.email, telefone: pedido.cliente.telefone },
      dados: dadosDoPedido(pedido, status.nome), pedidoNumero: pedido.numero,
    });
  });
}

// Mensagem de teste, pedida pelo painel: usa o modelo de "Pedido recebido" com dados de exemplo e vai direto para o
// destinatário informado. Devolve a linha da fila (ou null, se o canal não tem modelo para enviar).
function enfileirarTeste(canalId, destinatario) {
  const canal = CANAIS[canalId];
  const loja = configuracoes.ler('loja');
  const conteudo = canal.montar(configuracoes.ler('notificacoes').eventos.pedido_recebido[canalId], {
    cliente: 'Cliente de teste', numero: 0, total: 'R$ 50,00', status: 'Novo', itens: '1× Item de teste', recebimento: 'Retirada',
    data: dataBr(new Date().toISOString()), telefone: '(11) 99999-9999', loja: loja.nome, link: `${SITE_URL}/conta`, painel: `${SITE_URL}/admin#pedidos`,
  });
  if (!conteudo) return null;
  const chave = `teste:${Date.now()}:${Math.random().toString(36).slice(2, 10)}`;
  banco.inserirNotificacao({ chave: `${chave}:teste:${canalId}`, evento: 'teste', canal: canalId, para: 'teste', destinatario, conteudo });
  return banco.notificacaoPorChave(`${chave}:teste:${canalId}`);
}

// ---- envio

async function enviarUma(n) {
  const canal = CANAIS[n.canal];
  try {
    if (!canal?.configurado) throw new ErroEnvio('Este canal não está configurado no servidor.', { permanente: true });
    const { idExterno } = await canal.enviar(n.destinatario, n.conteudo);
    banco.marcarNotificacaoEnviada(n.id, idExterno);
  } catch (erro) {
    if (!(erro instanceof ErroEnvio)) console.error('Erro inesperado ao enviar notificação:', erro);
    // n.tentativas ainda não conta esta: a 1ª falha espera ESPERAS[0], a 2ª espera ESPERAS[1]...
    const espera = erro.permanente ? undefined : ESPERAS_NOTIFICACAO_S[n.tentativas];
    banco.marcarNotificacaoFalha(n.id, erro.message || 'Erro desconhecido.', espera === undefined ? null : new Date(Date.now() + espera * 1000).toISOString());
  }
}

// Envia tudo o que está na hora. Só uma rodada por vez: quem chama durante uma rodada espera a mesma terminar e
// pede mais uma, para pegar o que entrou na fila nesse meio-tempo.
let rodada = null;
let pedirOutra = false;
function processar() {
  if (rodada) { pedirOutra = true; return rodada; }
  rodada = (async () => {
    // Cede a vez antes de começar: sem isso, uma rodada sem nada para enviar terminaria (e limparia `rodada`) antes
    // de a linha acima guardar a promessa, e a fila ficaria parada para sempre achando que há uma rodada em curso.
    await null;
    try {
      do {
        pedirOutra = false;
        for (let lote; (lote = banco.notificacoesParaEnviar(new Date().toISOString(), LOTE)).length;) {
          for (const n of lote) await enviarUma(n);
        }
      } while (pedirOutra);
    } catch (erro) {
      console.error('Falha na fila de notificações:', erro);
    } finally {
      rodada = null;
    }
  })();
  return rodada;
}

// Chamado de dentro de uma transação: o envio começa logo depois que ela termina (e a mensagem já está gravada).
function acordar() {
  setImmediate(processar);
}

let ultimaFaxina = 0;
function faxina() {
  if (Date.now() - ultimaFaxina < 24 * 60 * 60 * 1000) return;
  ultimaFaxina = Date.now();
  banco.apagarNotificacoesAntigas(new Date(Date.now() - GUARDAR_DIAS * 24 * 60 * 60 * 1000).toISOString());
}

// Liga o trabalhador. Chamado uma vez, quando o servidor sobe: o que ficou pendente da última execução sai agora.
function iniciar() {
  const rodar = () => { try { faxina(); } catch (erro) { console.error('Falha na faxina de notificações:', erro); } processar(); };
  // Menor que o intervalo padrão quando as esperas configuradas são curtas (testes): nenhuma tentativa atrasa.
  const menorEspera = Math.min(INTERVALO_MS, ...ESPERAS_NOTIFICACAO_S.map((s) => Math.max(s * 1000, 50)));
  setInterval(rodar, menorEspera).unref();
  rodar();
}

module.exports = { aoCriarPedido, aoMudarStatus, enfileirarTeste, processar, iniciar, GUARDAR_DIAS };
