'use strict';
// Configurações da instalação, em um lugar só. Tudo o que é próprio de um estabelecimento (nome, contato, textos,
// fuso horário...) fica no banco, na tabela `config`, uma linha por seção, e só é lido e gravado por este módulo.
//
// Cada seção declara:
//   publica   pode ser entregue a qualquer visitante (/api/site). Sem isso, nunca sai para o navegador de visitantes.
//   editavel  pode ser lida e alterada pelo painel (/api/configuracoes). Seções internas, como a conta de acesso,
//             não são: têm rotas próprias e nunca são devolvidas.
//   padrao    valores usados quando o banco ainda não tem o campo (instalação nova ou campo criado depois).
//   validar   recebe o que veio do navegador e devolve o objeto limpo para gravar; lança ErroHttp se for inválido.
//
// Para criar uma configuração nova: acrescente o campo em `padrao` e em `validar`. Não precisa de migração.

const banco = require('../banco');
const { ErroHttp } = require('./http');
const { texto } = require('./validacao');
const { fusoValido } = require('./datas');
const { FONTES, FONTE_PADRAO, normalizarCor } = require('./tema');
const atendimento = require('./atendimento');

const SECOES = {
  loja: {
    publica: true,
    editavel: true,
    padrao: { nome: 'Minha loja', slogan: '', whatsapp: '', instagram: '', email: '', endereco: '', cidade: '' },
    validar: (corpo) => ({
      nome: texto(corpo.nome, { max: 60, obrigatorio: true, campo: 'nome da loja' }),
      slogan: texto(corpo.slogan, { max: 160, campo: 'slogan' }),
      whatsapp: String(corpo.whatsapp || '').replace(/\D/g, '').slice(0, 15),
      instagram: texto(corpo.instagram, { max: 40, campo: 'Instagram' }).replace(/^@/, '').replace(/[^\w.]/g, ''),
      email: texto(corpo.email, { max: 120, campo: 'e-mail' }),
      // Rua, número e bairro, em uma linha só. Vazio = a loja não divulga o endereço.
      endereco: texto(corpo.endereco, { max: 160, campo: 'endereço' }),
      cidade: texto(corpo.cidade, { max: 80, campo: 'cidade' }),
    }),
  },

  sobre: {
    publica: true,
    editavel: true,
    padrao: { imagem: '', titulo: 'Sobre', texto: '', trajetoria: [] },
    validar(corpo, atual) {
      if (!Array.isArray(corpo.trajetoria) || corpo.trajetoria.length > 30) throw new ErroHttp(400, 'Trajetória inválida.');
      return {
        imagem: atual.imagem || '', // a foto tem rota própria (envio de arquivo)
        titulo: texto(corpo.titulo, { max: 80, obrigatorio: true, campo: 'título' }),
        texto: texto(corpo.texto, { max: 5000, campo: 'história' }),
        trajetoria: corpo.trajetoria.map((t) => ({
          ano: texto(t && t.ano, { max: 12, campo: 'ano' }),
          titulo: texto(t && t.titulo, { max: 80, obrigatorio: true, campo: 'título da etapa' }),
          texto: texto(t && t.texto, { max: 400, campo: 'texto da etapa' }),
        })),
      };
    },
  },

  // Vocabulário do catálogo: cada negócio chama o que vende de um jeito (doces, pratos, peças, produtos...).
  // As telas montam os textos com estes nomes, sempre em frases que servem para qualquer palavra ("Ver doces",
  // "Adicionar prato"), sem artigo nem adjetivo que dependa de masculino/feminino.
  catalogo: {
    publica: true,
    editavel: true,
    padrao: { nomeSingular: 'Produto', nomePlural: 'Produtos', emojiPadrao: '🛍️' },
    validar: (corpo) => ({
      nomeSingular: texto(corpo.nomeSingular, { max: 30, obrigatorio: true, campo: 'nome no singular' }),
      nomePlural: texto(corpo.nomePlural, { max: 30, obrigatorio: true, campo: 'nome no plural' }),
      // Ícone mostrado no lugar da foto em produtos que ainda não têm uma.
      emojiPadrao: texto(corpo.emojiPadrao, { max: 8, campo: 'ícone padrão' }) || '🛍️',
    }),
  },

  // Recursos opcionais do catálogo: cada loja liga só o que usa (as regras estão em src/catalogo.js).
  // Desligado é o padrão, então uma instalação que já existia continua exatamente como estava.
  modulos: {
    publica: true,
    editavel: true,
    padrao: { variacoes: false, adicionais: false, estoque: false },
    validar: (corpo) => ({ variacoes: corpo.variacoes === true, adicionais: corpo.adicionais === true, estoque: corpo.estoque === true }),
  },

  // Aparência da loja. Vira CSS em src/tema.js (servido em /tema.css). Cor vazia = usar a cor padrão do sistema.
  // Não é editável pela rota genérica: as alterações passam pelo rascunho e só valem depois de publicadas
  // (ver src/aparencia.js).
  tema: {
    publica: true,
    editavel: false,
    padrao: { corPrincipal: '', corSecundaria: '', fonteTitulos: FONTE_PADRAO, logo: '', favicon: '', banner: '' },
    validar(corpo, atual) {
      const cor = (valor, campo) => {
        if (valor == null || valor === '') return '';
        const normal = normalizarCor(valor);
        if (!normal) throw new ErroHttp(400, `Cor inválida: ${campo}. Use o formato #rrggbb.`);
        return normal;
      };
      const fonte = corpo.fonteTitulos == null || corpo.fonteTitulos === '' ? FONTE_PADRAO : corpo.fonteTitulos;
      if (typeof fonte !== 'string' || !Object.hasOwn(FONTES, fonte)) throw new ErroHttp(400, 'Fonte inválida.');
      return {
        corPrincipal: cor(corpo.corPrincipal, 'cor principal'),
        corSecundaria: cor(corpo.corSecundaria, 'cor secundária'),
        fonteTitulos: fonte,
        // As imagens têm rota própria (envio de arquivo): salvar as cores não mexe nelas.
        logo: atual.logo || '', favicon: atual.favicon || '', banner: atual.banner || '',
      };
    },
  },

  // Horários de funcionamento e formas de receber o pedido (ver src/atendimento.js).
  atendimento: { publica: true, editavel: true, padrao: atendimento.PADRAO, validar: (corpo) => atendimento.validar(corpo) },

  operacao: {
    publica: false,
    editavel: true,
    // Fuso da loja: define o que é "hoje" na data dos pedidos e os dias do resumo, onde quer que o servidor esteja.
    padrao: { fusoHorario: 'America/Sao_Paulo' },
    validar(corpo) {
      if (!fusoValido(corpo.fusoHorario)) throw new ErroHttp(400, 'Fuso horário inválido. Exemplo: America/Sao_Paulo.');
      return { fusoHorario: corpo.fusoHorario };
    },
  },

  // Alterações de aparência ainda não publicadas (mesmo formato de `tema`). Só quem está no painel vê.
  temaRascunho: { publica: false, editavel: false, padrao: null },

  // Conta de acesso ao painel: { usuario, salt, hash, senhaInicial }. Interna: nunca é devolvida ao navegador.
  admin: { publica: false, editavel: false, padrao: null },
};

function secao(nome) {
  if (!Object.hasOwn(SECOES, nome)) throw new Error(`Seção de configuração desconhecida: ${nome}`);
  return SECOES[nome];
}

// Valor atual da seção, completado com os padrões. Seção interna sem registro no banco devolve null.
function ler(nome) {
  const { padrao } = secao(nome);
  const gravado = banco.lerConfig(nome);
  if (!padrao) return gravado;
  return { ...padrao, ...(gravado || {}) };
}

// Grava um valor montado pelo próprio servidor (dados iniciais, troca de senha, foto). Não valida.
function substituir(nome, valor) {
  secao(nome);
  banco.gravarConfig(nome, valor);
  return valor;
}

function remover(nome) {
  secao(nome);
  banco.apagarConfig(nome);
}

// Aplica as regras de uma seção ao que veio do navegador, sem gravar. `atual` é o valor de onde se parte.
function validar(nome, corpo, atual = ler(nome)) {
  return secao(nome).validar(corpo, atual);
}

// Grava o que veio do painel, depois de validar. Só para seções editáveis.
function gravar(nome, corpo) {
  const s = exigirEditavel(nome);
  return substituir(nome, s.validar(corpo, ler(nome)));
}

function exigirEditavel(nome) {
  const s = Object.hasOwn(SECOES, nome) ? SECOES[nome] : null;
  if (!s || !s.editavel) throw new ErroHttp(404, 'Configuração não encontrada.');
  return s;
}

function lerVarias(filtro) {
  return Object.fromEntries(Object.keys(SECOES).filter((nome) => filtro(SECOES[nome])).map((nome) => [nome, ler(nome)]));
}

// O que qualquer visitante pode receber.
const publicas = () => lerVarias((s) => s.publica);
// O que o painel pode ler e alterar.
const editaveis = () => lerVarias((s) => s.editavel);

const fusoHorario = () => ler('operacao').fusoHorario;

module.exports = { ler, gravar, substituir, remover, validar, publicas, editaveis, fusoHorario };
