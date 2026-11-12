'use strict';
// Tema da loja: transforma as escolhas feitas em Painel > Aparência (duas cores, fonte dos títulos, banner) no CSS
// servido em /tema.css. O arquivo css/site.css traz o visual padrão em variáveis; aqui só trocamos essas variáveis.
//
// Nada do que a loja digita vai direto para o CSS: cores passam por um formato fixo (#rrggbb), a fonte é escolhida
// de uma lista e os endereços das imagens são gerados pelo servidor. Assim não há como injetar CSS por um campo.

const COR = /^#[0-9a-f]{6}$/;

// Fontes dos títulos. São todas fontes que já vêm nos aparelhos: nada é baixado de outros sites.
const FONTES = {
  classica: { nome: 'Clássica (com serifa)', css: "Georgia, 'Times New Roman', serif" },
  moderna: { nome: 'Moderna (sem serifa)', css: "system-ui, -apple-system, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif" },
  elegante: { nome: 'Elegante', css: "'Palatino Linotype', Palatino, 'Book Antiqua', 'URW Palladio L', serif" },
  arredondada: { nome: 'Arredondada', css: "ui-rounded, 'Hiragino Maru Gothic ProN', Quicksand, Nunito, 'Trebuchet MS', 'Segoe UI', sans-serif" },
  marcante: { nome: 'Marcante (condensada)', css: "'Arial Narrow', 'Roboto Condensed', 'Helvetica Neue', Arial, sans-serif" },
};
const FONTE_PADRAO = 'classica';

// As cores do visual padrão (as mesmas de css/site.css), usadas como base quando a loja troca só uma delas.
const PADRAO = { principal: '#b8436a', secundaria: '#f8dde2' };
const TINTA = '#4a2530';

// ---------------------------------------------------------------- contas com cores

function normalizarCor(valor) {
  const cor = typeof valor === 'string' ? valor.trim().toLowerCase() : '';
  return COR.test(cor) ? cor : null;
}

const rgb = (hex) => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));
const hex = (canais) => '#' + canais.map((c) => Math.round(Math.min(255, Math.max(0, c))).toString(16).padStart(2, '0')).join('');

// Mistura duas cores: quanto = 0 devolve `a`, quanto = 1 devolve `b`.
function misturar(a, b, quanto) {
  const [ca, cb] = [rgb(a), rgb(b)];
  return hex(ca.map((c, i) => c + (cb[i] - c) * quanto));
}

// Luminância e contraste como definidos nas diretrizes de acessibilidade (WCAG 2).
function luminancia(cor) {
  const [r, g, b] = rgb(cor).map((c) => { const v = c / 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}
function contraste(a, b) {
  const [clara, escura] = [luminancia(a), luminancia(b)].sort((x, y) => y - x);
  return (clara + 0.05) / (escura + 0.05);
}

// Escurece a cor aos poucos até dar para ler como texto sobre fundo claro (contraste 4,5:1 com branco).
function legivelComoTexto(cor) {
  let atual = cor;
  for (let passo = 0; passo < 20 && contraste(atual, '#ffffff') < 4.5; passo++) atual = misturar(atual, '#000000', 0.1);
  return atual;
}

// ---------------------------------------------------------------- CSS do tema

function variaveisDeCor(tema) {
  const principal = normalizarCor(tema.corPrincipal);
  const secundaria = normalizarCor(tema.corSecundaria);
  if (!principal && !secundaria) return null; // visual padrão: css/site.css já tem tudo

  const destaque = principal || PADRAO.principal;
  const faixa = secundaria || PADRAO.secundaria;
  // Faixa escura (ex.: preto, vinho, azul-marinho): o texto sobre ela vira branco, e os detalhes claros do site
  // (bordas, selos, fundo das fotos) usam um tom bem clarinho dela em vez da cor cheia.
  const faixaEscura = contraste(faixa, '#ffffff') >= 3;
  const marca = faixaEscura ? misturar(faixa, '#ffffff', 0.86) : faixa;
  const destaqueTexto = legivelComoTexto(destaque);
  const [r, g, b] = rgb(destaque);

  return {
    '--faixa': faixa,
    '--marca': marca,
    '--marca-clara': misturar(marca, '#ffffff', 0.6),
    '--marca-media': misturar(marca, destaque, 0.2),
    '--destaque': destaque,
    '--destaque-texto': destaqueTexto,
    '--destaque-escuro': misturar(destaqueTexto, '#000000', 0.25),
    '--bs-primary-border': misturar(destaque, '#ffffff', 0.5),
    '--bs-primary-focus-ring': `rgba(${r}, ${g}, ${b}, .4)`,
    // Texto dos botões: branco ou escuro, o que der mais leitura sobre a cor principal.
    '--bs-primary-contrast': contraste(destaque, '#ffffff') >= contraste(destaque, TINTA) ? '#ffffff' : TINTA,
    '--texto-na-faixa': faixaEscura ? '#ffffff' : 'var(--tinta)',
    '--texto-suave-na-faixa': faixaEscura ? 'rgba(255, 255, 255, .82)' : 'var(--tinta-suave)',
    '--realce-na-faixa': faixaEscura ? 'rgba(255, 255, 255, .16)' : 'rgba(255, 255, 255, .7)',
    '--capa-fim': faixaEscura ? misturar(faixa, '#ffffff', 0.12) : misturar(marca, '#ffffff', 0.6),
  };
}

// Só entram no CSS endereços de imagem no formato que o próprio servidor gera ao receber um envio.
const IMAGEM_ENVIADA = /^\/uploads\/[A-Za-z0-9-]+\.(jpg|png|webp)$/;
const imagemSegura = (caminho) => (typeof caminho === 'string' && IMAGEM_ENVIADA.test(caminho) ? caminho : '');

function gerarCss(tema) {
  const blocos = ['/* Tema da loja, gerado a partir de Painel > Aparência. Não edite: altere pelo painel. */'];

  const variaveis = variaveisDeCor(tema) || {};
  const fonte = Object.hasOwn(FONTES, tema.fonteTitulos) && tema.fonteTitulos !== FONTE_PADRAO ? FONTES[tema.fonteTitulos] : null;
  if (fonte) variaveis['--fonte-titulos'] = fonte.css;
  if (Object.keys(variaveis).length) {
    blocos.push(`:root {\n${Object.entries(variaveis).map(([nome, valor]) => `  ${nome}: ${valor};`).join('\n')}\n}`);
  }

  const banner = imagemSegura(tema.banner);
  if (banner) {
    // Um véu claro sobre a foto mantém o nome e a frase da loja legíveis, qualquer que seja a imagem.
    blocos.push(
      `.capa {\n  background-image: linear-gradient(rgba(255, 255, 255, .74), rgba(255, 255, 255, .74)), url("${banner}");\n` +
      '  background-size: cover;\n  background-position: center;\n}\n' +
      '.capa h1 { color: var(--tinta); }\n.capa p { color: var(--tinta-suave); }');
  }
  return blocos.join('\n\n') + '\n';
}

module.exports = { FONTES, FONTE_PADRAO, normalizarCor, misturar, contraste, legivelComoTexto, imagemSegura, gerarCss };
