'use strict';
// Atendimento da loja: horários de funcionamento e as formas de receber o pedido (retirada e entrega).
// Aqui ficam o formato, os valores padrão e a validação; quem guarda é src/configuracoes.js (seção `atendimento`).

const { ErroHttp } = require('./http');
const { texto } = require('./validacao');

const DIAS = ['domingo', 'segunda', 'terça', 'quarta', 'quinta', 'sexta', 'sábado']; // posição = dia da semana (0 = domingo)
const HORA = /^([01]\d|2[0-3]):[0-5]\d$/;

// Um dia tem um período (abre–fecha) e, se a loja fecha no meio do dia, um segundo (abre2–fecha2).
const diaPadrao = () => ({ aberto: false, abre: '09:00', fecha: '18:00', abre2: '', fecha2: '' });

const PADRAO = {
  // Os horários só aparecem no site depois que a loja os preenche e marca para exibir.
  exibirHorarios: false,
  horarios: DIAS.map(diaPadrao),
  observacaoHorarios: '',
  retirada: { ativa: true, instrucoes: '' },
  entrega: { ativa: true, taxa: 'taxa a combinar', instrucoes: '' },
};

function validarDia(dia, nome) {
  const d = dia && typeof dia === 'object' ? dia : {};
  const hora = (valor, campo, obrigatoria) => {
    const h = typeof valor === 'string' ? valor.trim() : '';
    if (!h && !obrigatoria) return '';
    if (!HORA.test(h)) throw new ErroHttp(400, `Horário inválido em ${nome} (${campo}). Use o formato 09:00.`);
    return h;
  };
  const aberto = Boolean(d.aberto);
  // Dia fechado guarda os horários que estavam digitados (ou o padrão), para a loja não perder o que preencheu.
  const abre = hora(d.abre, 'abertura', aberto) || '09:00';
  const fecha = hora(d.fecha, 'fechamento', aberto) || '18:00';
  const abre2 = hora(d.abre2, 'abertura do 2º período', false);
  const fecha2 = hora(d.fecha2, 'fechamento do 2º período', false);
  if (aberto && abre === fecha) throw new ErroHttp(400, `Em ${nome}, a abertura e o fechamento estão iguais.`);
  if (Boolean(abre2) !== Boolean(fecha2)) throw new ErroHttp(400, `Em ${nome}, preencha a abertura e o fechamento do 2º período (ou deixe os dois vazios).`);
  if (abre2 && abre2 === fecha2) throw new ErroHttp(400, `Em ${nome}, a abertura e o fechamento do 2º período estão iguais.`);
  return { aberto, abre, fecha, abre2, fecha2 };
}

function validar(corpo) {
  if (!Array.isArray(corpo.horarios) || corpo.horarios.length !== 7) throw new ErroHttp(400, 'Informe os horários dos sete dias da semana.');
  const retirada = corpo.retirada && typeof corpo.retirada === 'object' ? corpo.retirada : {};
  const entrega = corpo.entrega && typeof corpo.entrega === 'object' ? corpo.entrega : {};
  const resultado = {
    exibirHorarios: Boolean(corpo.exibirHorarios),
    horarios: corpo.horarios.map((dia, i) => validarDia(dia, DIAS[i])),
    observacaoHorarios: texto(corpo.observacaoHorarios, { max: 160, campo: 'observação dos horários' }),
    retirada: { ativa: Boolean(retirada.ativa), instrucoes: texto(retirada.instrucoes, { max: 300, campo: 'instruções de retirada' }) },
    entrega: {
      ativa: Boolean(entrega.ativa),
      taxa: texto(entrega.taxa, { max: 80, campo: 'taxa de entrega' }),
      instrucoes: texto(entrega.instrucoes, { max: 300, campo: 'informações de entrega' }),
    },
  };
  if (!resultado.retirada.ativa && !resultado.entrega.ativa) {
    throw new ErroHttp(400, 'Deixe ao menos uma forma de receber o pedido ligada: retirada ou entrega.');
  }
  return resultado;
}

module.exports = { DIAS, PADRAO, validar };
