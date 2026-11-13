'use strict';
// Permissões da equipe da loja. A lista é fixa, definida aqui: cada rota do painel declara qual exige (o 4º item
// da rota, em src/rotas/*.js) e cada perfil guarda quais concede.
//
// O que uma pessoa pode fazer = as permissões do perfil dela + os ajustes individuais ("conceder" soma, "negar"
// tira). O perfil de sistema (Administrador) tem sempre todas, inclusive as que forem criadas depois, e não aceita
// ajustes: é a garantia de que alguém sempre consegue administrar a loja.
//
// Para criar uma permissão nova: acrescente aqui e use o id na rota. Não precisa de migração.

const banco = require('../banco');

const PERMISSOES = [
  { id: 'resumo.ver', nome: 'Ver o resumo', descricao: 'Receita, gráficos e produtos mais vendidos.' },
  { id: 'pedidos.ver', nome: 'Ver pedidos', descricao: 'Lista de pedidos, com itens, endereço e contato do cliente.' },
  { id: 'pedidos.alterar', nome: 'Alterar pedidos', descricao: 'Mudar o status de um pedido, inclusive cancelar.' },
  { id: 'clientes.ver', nome: 'Ver clientes', descricao: 'Clientes, contatos e o que cada um já pediu.' },
  { id: 'produtos.editar', nome: 'Editar o catálogo', descricao: 'Criar, alterar e excluir produtos, categorias, preços e estoque.' },
  { id: 'conteudo.editar', nome: 'Editar a página Sobre', descricao: 'Texto, trajetória e foto da página Sobre.' },
  { id: 'aparencia.editar', nome: 'Mudar a aparência', descricao: 'Cores, letra, logotipo e banner; ver a prévia e publicar.' },
  { id: 'configuracoes.editar', nome: 'Alterar configurações', descricao: 'Dados da loja, horários, entrega e recursos opcionais.' },
  { id: 'usuarios.gerenciar', nome: 'Gerenciar a equipe', descricao: 'Criar pessoas e perfis e definir o que cada um pode fazer.' },
  { id: 'auditoria.ver', nome: 'Ver o registro de atividades', descricao: 'Quem fez o quê no painel, e quando.' },
];
const TODAS = PERMISSOES.map((p) => p.id);
const existe = (id) => TODAS.includes(id);

// Permissões que um perfil concede, sempre na ordem da lista acima.
const doPerfil = (perfil) => (perfil.sistema ? TODAS : TODAS.filter((id) => perfil.permissoes.includes(id)));

// Permissões efetivas de uma pessoa da equipe (lista de ids). `perfil` pode ser passado para simular uma mudança.
function doUsuario(usuario, perfil = banco.perfilPorId(usuario.perfilId)) {
  if (!perfil) return [];
  if (perfil.sistema) return TODAS;
  const negadas = new Set(usuario.ajustes.negar);
  const lista = new Set([...doPerfil(perfil), ...usuario.ajustes.conceder.filter(existe)]);
  return TODAS.filter((id) => lista.has(id) && !negadas.has(id));
}

module.exports = { PERMISSOES, TODAS, existe, doPerfil, doUsuario };
