'use strict';
// Rotas de configuração, só da loja: página Sobre, dados de contato e senha de acesso ao painel.

const banco = require('../../banco');
const { ErroHttp, lerJson, ipDe, limitar } = require('../http');
const { texto } = require('../validacao');
const { senhaConfere, novaSenha } = require('../senhas');
const { derrubarOutrasSessoesAdmin } = require('../sessao');
const { salvarImagem, removerImagem, LIMITE_JSON_COM_FOTO } = require('../imagens');

module.exports = [
  ['PUT', /^\/api\/sobre$/, async (req) => {
    const corpo = await lerJson(req);
    if (!Array.isArray(corpo.trajetoria) || corpo.trajetoria.length > 30) throw new ErroHttp(400, 'Trajetória inválida.');
    const sobre = {
      imagem: banco.lerConfig('sobre').imagem || '', // a foto tem rota própria, logo abaixo
      titulo: texto(corpo.titulo, { max: 80, obrigatorio: true, campo: 'título' }),
      texto: texto(corpo.texto, { max: 5000, campo: 'história' }),
      trajetoria: corpo.trajetoria.map((t) => ({
        ano: texto(t && t.ano, { max: 12, campo: 'ano' }),
        titulo: texto(t && t.titulo, { max: 80, obrigatorio: true, campo: 'título da etapa' }),
        texto: texto(t && t.texto, { max: 400, campo: 'texto da etapa' }),
      })),
    };
    banco.gravarConfig('sobre', sobre);
    return sobre;
  }, true],

  ['PUT', /^\/api\/sobre\/imagem$/, async (req) => {
    const { imagem } = await lerJson(req, LIMITE_JSON_COM_FOTO);
    const sobre = banco.lerConfig('sobre');
    if (imagem) salvarImagem(sobre, imagem, 'confeiteira'); else removerImagem(sobre);
    banco.gravarConfig('sobre', sobre);
    return sobre;
  }, true],

  ['PUT', /^\/api\/loja$/, async (req) => {
    const corpo = await lerJson(req);
    const loja = {
      nome: texto(corpo.nome, { max: 60, obrigatorio: true, campo: 'nome da loja' }),
      slogan: texto(corpo.slogan, { max: 160, campo: 'slogan' }),
      whatsapp: String(corpo.whatsapp || '').replace(/\D/g, '').slice(0, 15),
      instagram: texto(corpo.instagram, { max: 40, campo: 'Instagram' }).replace(/^@/, '').replace(/[^\w.]/g, ''),
      email: texto(corpo.email, { max: 120, campo: 'e-mail' }),
      cidade: texto(corpo.cidade, { max: 80, campo: 'cidade' }),
    };
    banco.gravarConfig('loja', loja);
    return loja;
  }, true],

  ['PUT', /^\/api\/senha$/, async (req) => {
    limitar(`senha:${ipDe(req)}`, 8, 15 * 60 * 1000);
    const { atual, nova } = await lerJson(req);
    const admin = banco.lerConfig('admin');
    if (!senhaConfere(atual, admin)) throw new ErroHttp(400, 'A senha atual não confere.');
    banco.gravarConfig('admin', { ...admin, ...novaSenha(nova), senhaInicial: false });
    derrubarOutrasSessoesAdmin(req);
    return { ok: true };
  }, true],
];
