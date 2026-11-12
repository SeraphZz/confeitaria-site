'use strict';
// Fotos enviadas pela loja. Ficam em DATA_DIR/uploads e são servidas em /uploads/.

const fs = require('node:fs');
const path = require('node:path');
const banco = require('../banco');
const { ErroHttp } = require('./http');

const UPLOADS_DIR = path.join(banco.DATA_DIR, 'uploads');
fs.mkdirSync(UPLOADS_DIR, { recursive: true });

// O tipo é conferido pelos primeiros bytes do arquivo, não pelo que o navegador declarou.
const IMAGENS = {
  jpeg: { ext: 'jpg', ok: (b) => b[0] === 0xff && b[1] === 0xd8 },
  png: { ext: 'png', ok: (b) => b.subarray(0, 4).toString('hex') === '89504e47' },
  webp: { ext: 'webp', ok: (b) => b.subarray(0, 4).toString() === 'RIFF' && b.subarray(8, 12).toString() === 'WEBP' },
};

// Serve para qualquer registro com o campo `imagem` (um doce ou a página Sobre); `nome` vira o início do arquivo.
// Só troca o arquivo e o campo: quem chama grava o registro no banco.
function salvarImagem(registro, dataUrl, nome = registro.id) {
  const m = /^data:image\/(jpeg|png|webp);base64,([A-Za-z0-9+/=]+)$/.exec(typeof dataUrl === 'string' ? dataUrl : '');
  if (!m) throw new ErroHttp(400, 'Envie uma foto JPG, PNG ou WebP.');
  const bytes = Buffer.from(m[2], 'base64');
  const tipo = IMAGENS[m[1]];
  if (bytes.length > 2 * 1024 * 1024 || !tipo.ok(bytes)) throw new ErroHttp(400, 'Foto inválida ou maior que 2 MB.');
  removerImagem(registro);
  const arquivo = `${nome}-${Date.now()}.${tipo.ext}`;
  fs.writeFileSync(path.join(UPLOADS_DIR, arquivo), bytes);
  registro.imagem = `/uploads/${arquivo}`;
}

function removerImagem(registro) {
  if (!registro.imagem) return;
  fs.rmSync(path.join(UPLOADS_DIR, path.basename(registro.imagem)), { force: true });
  registro.imagem = '';
}

// Limite do corpo JSON nas rotas que recebem foto (a foto vai em base64 dentro do JSON).
const LIMITE_JSON_COM_FOTO = 3 * 1024 * 1024;

module.exports = { UPLOADS_DIR, LIMITE_JSON_COM_FOTO, salvarImagem, removerImagem };
