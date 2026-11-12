'use strict';
// Rascunho e publicação do tema da loja.
//
// O que se altera em Painel > Aparência não vai direto para os clientes: fica guardado como rascunho
// (configuração `temaRascunho`). Quem está logado no painel navega pelo site vendo o rascunho; os clientes continuam
// vendo o tema publicado (`tema`) até alguém clicar em Publicar. Descartar joga o rascunho fora.
//
// Imagens: rascunho e tema publicado podem apontar para o mesmo arquivo (enquanto a imagem não foi trocada).
// Por isso um arquivo só é apagado quando nenhum dos dois o usa mais.

const banco = require('../banco');
const configuracoes = require('./configuracoes');
const { salvarImagem, removerImagem } = require('./imagens');

const IMAGENS = ['logo', 'favicon', 'banner'];
const iguais = (a, b) => JSON.stringify(a) === JSON.stringify(b);

const publicado = () => configuracoes.ler('tema');
// Rascunho guardado, ou null quando não há alterações pendentes.
const rascunho = () => configuracoes.ler('temaRascunho');

// Tema que esta pessoa deve ver: o rascunho para quem está no painel (se houver), o publicado para os demais.
function temaPara(ehDoPainel) {
  return (ehDoPainel && rascunho()) || publicado();
}

// Apaga os arquivos de `candidatos` que não aparecem em nenhum dos temas de `emUso`.
function apagarSemUso(candidatos, ...emUso) {
  for (const qual of IMAGENS) {
    const caminho = candidatos[qual];
    if (caminho && !emUso.some((tema) => tema && IMAGENS.some((outra) => tema[outra] === caminho))) removerImagem({ imagem: caminho });
  }
}

// Rascunho idêntico ao publicado não é rascunho: some, para o painel não avisar de alterações que não existem.
function guardarRascunho(novo) {
  if (iguais(novo, publicado())) configuracoes.remover('temaRascunho');
  else configuracoes.substituir('temaRascunho', novo);
  return estado();
}

// Cores e letra dos títulos vindas do formulário (validadas pelas regras da seção `tema`).
function salvarRascunho(corpo) {
  return guardarRascunho(configuracoes.validar('tema', corpo, temaPara(true)));
}

// Troca (ou remove, com dataUrl vazio) uma das imagens no rascunho.
function trocarImagem(qual, dataUrl) {
  const base = temaPara(true);
  const registro = { imagem: '' }; // vazio de propósito: quem decide se o arquivo antigo pode ser apagado é apagarSemUso
  if (dataUrl) salvarImagem(registro, dataUrl, qual);
  const novo = { ...base, [qual]: registro.imagem };
  apagarSemUso({ [qual]: base[qual] }, novo, publicado());
  return guardarRascunho(novo);
}

function publicar() {
  const novo = rascunho();
  if (!novo) return estado();
  const antigo = publicado();
  banco.transacao(() => {
    configuracoes.substituir('tema', novo);
    configuracoes.remover('temaRascunho');
  });
  apagarSemUso(antigo, novo);
  return estado();
}

function descartar() {
  const jogadoFora = rascunho();
  if (!jogadoFora) return estado();
  configuracoes.remover('temaRascunho');
  apagarSemUso(jogadoFora, publicado());
  return estado();
}

// O que a tela de Aparência precisa: o que está no ar e o que está pendente.
function estado() {
  return { publicado: publicado(), rascunho: rascunho() };
}

module.exports = { IMAGENS, temaPara, salvarRascunho, trocarImagem, publicar, descartar, estado, temRascunho: () => Boolean(rascunho()) };
