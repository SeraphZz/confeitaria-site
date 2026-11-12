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

const SECOES = {
  loja: {
    publica: true,
    editavel: true,
    padrao: { nome: 'Minha loja', slogan: '', whatsapp: '', instagram: '', email: '', cidade: '' },
    validar: (corpo) => ({
      nome: texto(corpo.nome, { max: 60, obrigatorio: true, campo: 'nome da loja' }),
      slogan: texto(corpo.slogan, { max: 160, campo: 'slogan' }),
      whatsapp: String(corpo.whatsapp || '').replace(/\D/g, '').slice(0, 15),
      instagram: texto(corpo.instagram, { max: 40, campo: 'Instagram' }).replace(/^@/, '').replace(/[^\w.]/g, ''),
      email: texto(corpo.email, { max: 120, campo: 'e-mail' }),
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

module.exports = { ler, gravar, substituir, publicas, editaveis, fusoHorario };
