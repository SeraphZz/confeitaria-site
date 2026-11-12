'use strict';
// Página inicial: capa + grade de produtos.

App.pronto.then(async ({ loja, admin, catalogo }) => {
  const { esc, brl, fotoHtml, minusculas } = App;
  document.title = loja.nome;
  document.getElementById('capa-titulo').textContent = loja.nome;
  document.getElementById('capa-slogan').textContent = loja.slogan;
  // A loja escolhe como chamar o que vende (doces, pratos, produtos...): os textos seguem essa escolha.
  document.getElementById('ver-produtos').textContent = `Ver ${minusculas(catalogo.nomePlural)}`;
  document.getElementById('titulo-produtos').textContent = catalogo.nomePlural;
  const novo = document.getElementById('novo-produto');
  novo.textContent = `+ Adicionar ${minusculas(catalogo.nomeSingular)}`;
  novo.hidden = !admin;

  const grade = document.getElementById('grade');
  const produtos = await App.api('/api/produtos');
  if (!produtos.length) {
    grade.outerHTML = '<p class="suave">Em breve, novidades por aqui.</p>';
    return;
  }
  grade.innerHTML = produtos.map((p) => `
    <a class="produto-card${p.disponivel ? '' : ' indisponivel'}" href="/produto/${esc(p.slug)}">
      ${fotoHtml(p)}
      <div class="corpo">
        <h3>${esc(p.nome)}</h3>
        <span class="suave fs-sm">${esc(p.unidade)}</span>
        ${p.disponivel ? '' : '<span><span class="selo cinza">Oculto para clientes</span></span>'}
        <span class="preco">${brl(p.preco)}</span>
      </div>
    </a>`).join('');
}).catch((erro) => App.aviso(erro.message, { erro: true }));
