'use strict';
// Registro de atividades da equipe (tabela `auditoria`, só de inserção).
//
// O servidor registra sozinho toda rota que altera dados quando quem chama é da equipe: nenhuma rota nova fica de
// fora por esquecimento. O que cada rota pode acrescentar:
//   - o 5º item da rota: o texto da ação ("Alterou um produto"). Sem ele, fica o método e o endereço.
//   - `anotar(req, alvo, detalhes)`, dentro do handler: em quê a ação foi feita e o que mudou.
// Nunca entram aqui senhas nem o conteúdo enviado: só o que o handler escolher anotar.
//
// Entrar no painel (certo ou errado) é registrado à parte, porque nessa hora ainda não há ninguém logado.

const banco = require('../banco');
const { ipDe } = require('./http');

const anotacoes = new WeakMap();

// Chamado pelo handler para dizer em quê a ação foi feita. `detalhes`: objeto pequeno, com valores simples.
function anotar(req, alvo, detalhes = {}) {
  anotacoes.set(req, { alvo: String(alvo ?? ''), detalhes });
}

function gravar(req, usuario, acao) {
  const { alvo = '', detalhes = {} } = anotacoes.get(req) || {};
  banco.inserirAuditoria({
    usuarioId: usuario.id, usuarioLogin: usuario.usuario, usuarioNome: usuario.nome,
    acao: String(acao).slice(0, 120), alvo: alvo.slice(0, 160), detalhes, ip: ipDe(req) || '',
  });
}

// Usado pelo servidor depois que uma rota termina bem. `usuario` é quem estava logado quando o pedido chegou.
function registrarRota(req, usuario, rotulo, caminho) {
  if (!usuario || req.method === 'GET' || req.method === 'HEAD') return;
  gravar(req, usuario, rotulo || `${req.method} ${caminho}`);
}

// Para o que acontece fora de uma rota do painel (login; scripts passam `req` nulo).
function registrar(req, usuario, acao, alvo = '', detalhes = {}) {
  banco.inserirAuditoria({
    usuarioId: usuario.id, usuarioLogin: usuario.usuario, usuarioNome: usuario.nome,
    acao, alvo, detalhes, ip: req ? ipDe(req) || '' : '',
  });
}

module.exports = { anotar, registrarRota, registrar };
