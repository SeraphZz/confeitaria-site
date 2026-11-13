'use strict';
// Datas "de calendário" (AAAA-MM-DD) no fuso horário da loja, não no do servidor.
// Um servidor em UTC vira o dia às 21h de Brasília; sem isto, "hoje" e os dias do resumo sairiam errados.

function fusoValido(fuso) {
  if (typeof fuso !== 'string' || !fuso || fuso.length > 64) return false;
  try { new Intl.DateTimeFormat('en-CA', { timeZone: fuso }); return true; } catch { return false; }
}

const formatadores = new Map();
// Que dia é, no fuso informado, no instante `data`. Ex.: 01:30 UTC do dia 13 ainda é dia 12 em São Paulo.
function diaNoFuso(data, fuso) {
  let f = formatadores.get(fuso);
  if (!f) formatadores.set(fuso, f = new Intl.DateTimeFormat('en-CA', { timeZone: fuso, year: 'numeric', month: '2-digit', day: '2-digit' }));
  const partes = Object.fromEntries(f.formatToParts(data).map((p) => [p.type, p.value]));
  return `${partes.year}-${partes.month}-${partes.day}`;
}

// Soma (ou subtrai) dias de um AAAA-MM-DD. É conta de calendário pura, sem fuso nem horário de verão.
function somarDias(dia, quantidade) {
  const [a, m, d] = dia.split('-').map(Number);
  return new Date(Date.UTC(a, m - 1, d + quantidade)).toISOString().slice(0, 10);
}

// Um instante garantidamente anterior ao começo desse dia em qualquer fuso do mundo (os fusos vão de -12h a +14h).
// Serve para pedir ao banco "tudo desde este dia" com folga; quem chama filtra o resto por diaNoFuso().
function instanteAntesDoDia(dia) {
  return new Date(`${somarDias(dia, -1)}T00:00:00.000Z`).toISOString();
}

module.exports = { fusoValido, diaNoFuso, somarDias, instanteAntesDoDia };
