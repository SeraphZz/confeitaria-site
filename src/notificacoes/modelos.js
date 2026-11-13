'use strict';
// Modelos das notificações: quais acontecimentos geram mensagem, para quem, e o texto de cada canal.
// A loja edita os textos no painel (Notificações); eles ficam na seção `notificacoes` das configurações.
//
// As variáveis são uma lista fechada: o texto só pode usar as que estão em VARIAVEIS, escritas entre chaves
// ("{cliente}"). O valor de cada uma sai do banco na hora de montar a mensagem; nada do modelo é executado.

const { ErroHttp } = require('../http');
const { texto } = require('../validacao');

const CANAIS = ['email', 'whatsapp', 'sms'];

const VARIAVEIS = [
  { id: 'cliente', descricao: 'nome do cliente' },
  { id: 'numero', descricao: 'número do pedido' },
  { id: 'total', descricao: 'valor total (R$ 0,00)' },
  { id: 'status', descricao: 'status em que o pedido está' },
  { id: 'itens', descricao: 'itens do pedido, em uma linha' },
  { id: 'recebimento', descricao: '"Retirada" ou "Entrega"' },
  { id: 'data', descricao: 'data marcada para a retirada ou entrega' },
  { id: 'telefone', descricao: 'telefone do cliente' },
  { id: 'loja', descricao: 'nome da loja' },
  { id: 'link', descricao: 'endereço de "Minha conta", onde o cliente acompanha o pedido' },
  { id: 'painel', descricao: 'endereço da lista de pedidos no painel' },
];
const NOMES_VARIAVEIS = new Set(VARIAVEIS.map((v) => v.id));

// Cada acontecimento que gera mensagem. `para`: quem recebe.
// No WhatsApp o texto não é livre: a Meta só deixa uma empresa iniciar conversa com um modelo aprovado por ela.
// Por isso o que a loja informa é o nome desse modelo, o idioma e quais variáveis preenchem os campos {{1}},
// {{2}}... dele, nessa ordem. Sem nome de modelo, o acontecimento não gera mensagem de WhatsApp.
const EVENTOS = [
  {
    id: 'pedido_recebido', nome: 'Pedido recebido', para: 'cliente', descricao: 'Para o cliente, assim que ele envia o pedido.',
    padrao: {
      email: {
        assunto: 'Recebemos seu pedido nº {numero} - {loja}',
        corpo: 'Olá, {cliente}!\n\nRecebemos o seu pedido nº {numero}.\n\nItens: {itens}\nTotal: {total}\n{recebimento} em {data}\n\nAcompanhe o andamento em {link}\n\n{loja}',
      },
      sms: { corpo: '{loja}: recebemos seu pedido nº {numero} ({total}). {recebimento} em {data}.' },
    },
  },
  {
    id: 'pedido_status', nome: 'Pedido mudou de status', para: 'cliente', descricao: 'Para o cliente, quando a loja muda o status do pedido.',
    padrao: {
      email: {
        assunto: 'Pedido nº {numero}: {status} - {loja}',
        corpo: 'Olá, {cliente}!\n\nSeu pedido nº {numero} agora está: {status}.\n\nAcompanhe o andamento em {link}\n\n{loja}',
      },
      sms: { corpo: '{loja}: seu pedido nº {numero} agora está: {status}.' },
    },
  },
  {
    id: 'pedido_novo_loja', nome: 'Novo pedido (aviso para a loja)', para: 'loja', descricao: 'Para o e-mail e o WhatsApp da loja (Configurações), quando chega um pedido.',
    padrao: {
      email: {
        assunto: 'Novo pedido nº {numero} ({total})',
        corpo: 'Pedido nº {numero}, de {cliente} ({telefone}).\n\nItens: {itens}\nTotal: {total}\n{recebimento} em {data}\n\nAbra o painel: {painel}',
      },
      sms: { corpo: 'Novo pedido nº {numero}: {cliente}, {total}. {recebimento} em {data}.' },
    },
  },
];
for (const evento of EVENTOS) evento.padrao.whatsapp = { modelo: '', idioma: 'pt_BR', parametros: [] };

// Tudo desligado de partida: uma instalação que já existia continua sem enviar nada até a loja ligar um canal.
const PADRAO = {
  canais: { email: false, whatsapp: false, sms: false },
  eventos: Object.fromEntries(EVENTOS.map((e) => [e.id, { ativo: true, ...(e.id === 'pedido_status' ? { silenciados: [] } : {}), ...structuredClone(e.padrao) }])),
};

// As variáveis usadas em um texto. Lança se alguma não existir ("{nome}" escrito errado nunca chega ao cliente).
function variaveisDe(textoModelo, campo) {
  const usadas = [...textoModelo.matchAll(/\{([^{}\s]*)\}/g)].map((m) => m[1]);
  const estranha = usadas.find((nome) => !NOMES_VARIAVEIS.has(nome));
  if (estranha !== undefined) throw new ErroHttp(400, `Variável desconhecida em ${campo}: {${estranha}}. Use só as da lista.`);
  return usadas;
}

// Troca cada {variavel} pelo valor. O valor entra como texto puro: chaves dentro dele não são interpretadas.
const preencher = (textoModelo, dados) => textoModelo.replace(/\{([^{}\s]*)\}/g, (inteiro, nome) => (NOMES_VARIAVEIS.has(nome) ? String(dados[nome] ?? '') : inteiro));

// Completa o que está gravado com os padrões (campo criado depois, instalação que nunca abriu a tela).
function completar(gravado) {
  const g = gravado && typeof gravado === 'object' ? gravado : {};
  return {
    canais: { ...PADRAO.canais, ...(g.canais || {}) },
    eventos: Object.fromEntries(EVENTOS.map((e) => {
      const atual = (g.eventos || {})[e.id] || {};
      const padrao = PADRAO.eventos[e.id];
      return [e.id, {
        ...padrao, ...atual,
        email: { ...padrao.email, ...(atual.email || {}) }, sms: { ...padrao.sms, ...(atual.sms || {}) }, whatsapp: { ...padrao.whatsapp, ...(atual.whatsapp || {}) },
      }];
    })),
  };
}

// Confere o que veio do painel e devolve o objeto limpo para gravar.
function validar(corpo) {
  const canais = corpo.canais && typeof corpo.canais === 'object' ? corpo.canais : {};
  const eventosEnviados = corpo.eventos && typeof corpo.eventos === 'object' ? corpo.eventos : {};
  return {
    canais: Object.fromEntries(CANAIS.map((canal) => [canal, canais[canal] === true])),
    eventos: Object.fromEntries(EVENTOS.map((e) => {
      const enviado = eventosEnviados[e.id];
      if (!enviado || typeof enviado !== 'object') throw new ErroHttp(400, `Faltou o modelo de "${e.nome}".`);
      const { email = {}, sms = {}, whatsapp = {} } = enviado;
      const onde = `"${e.nome}"`;

      const assunto = texto(email.assunto, { max: 120, obrigatorio: true, campo: `assunto do e-mail de ${onde}` });
      const corpoEmail = texto(email.corpo, { max: 2000, obrigatorio: true, campo: `texto do e-mail de ${onde}` });
      const corpoSms = texto(sms.corpo, { max: 300, obrigatorio: true, campo: `texto do SMS de ${onde}` });
      if (/[\r\n]/.test(assunto)) throw new ErroHttp(400, `O assunto do e-mail de ${onde} precisa ficar em uma linha.`);
      variaveisDe(assunto, `assunto do e-mail de ${onde}`);
      variaveisDe(corpoEmail, `texto do e-mail de ${onde}`);
      variaveisDe(corpoSms, `texto do SMS de ${onde}`);

      const modelo = texto(whatsapp.modelo, { max: 60, campo: `modelo do WhatsApp de ${onde}` });
      if (modelo && !/^[a-z0-9_]+$/.test(modelo)) throw new ErroHttp(400, `O nome do modelo do WhatsApp de ${onde} só tem letras minúsculas, números e "_".`);
      const idioma = texto(whatsapp.idioma, { max: 10, campo: 'idioma do modelo' }) || 'pt_BR';
      if (!/^[a-z]{2}(_[A-Z]{2})?$/.test(idioma)) throw new ErroHttp(400, 'Idioma do modelo inválido. Exemplo: pt_BR.');
      const parametros = Array.isArray(whatsapp.parametros) ? whatsapp.parametros : [];
      if (parametros.length > 10) throw new ErroHttp(400, `O modelo do WhatsApp de ${onde} aceita até 10 variáveis.`);
      for (const nome of parametros) {
        if (!NOMES_VARIAVEIS.has(nome)) throw new ErroHttp(400, `Variável desconhecida no modelo do WhatsApp de ${onde}: ${String(nome).slice(0, 30)}.`);
      }

      const limpo = { ativo: enviado.ativo === true, email: { assunto, corpo: corpoEmail }, sms: { corpo: corpoSms }, whatsapp: { modelo, idioma, parametros } };
      // Status em que o cliente NÃO é avisado. Guardar os silenciados (e não os avisados) faz um status criado
      // depois já nascer avisando.
      if (e.id === 'pedido_status') {
        const lista = Array.isArray(enviado.silenciados) ? enviado.silenciados : [];
        if (lista.length > 30 || lista.some((id) => typeof id !== 'string' || id.length > 60)) throw new ErroHttp(400, 'Lista de status inválida.');
        limpo.silenciados = [...new Set(lista)];
      }
      return [e.id, limpo];
    })),
  };
}

module.exports = { CANAIS, VARIAVEIS, EVENTOS, PADRAO, completar, validar, preencher };
