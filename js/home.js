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
  const [produtos, categorias] = await Promise.all([App.api('/api/produtos'), App.api('/api/categorias')]);
  if (!produtos.length) {
    grade.outerHTML = '<p class="suave">Em breve, novidades por aqui.</p>';
    return;
  }
  // `titulo`: h3 na lista única; h4 quando o cartão fica abaixo do título de uma categoria.
  const cartao = (p, titulo = 'h3') => `
    <a class="produto-card${p.disponivel ? '' : ' indisponivel'}" href="/produto/${esc(p.slug)}">
      ${fotoHtml(p)}
      <div class="corpo">
        <${titulo} class="nome">${esc(p.nome)}</${titulo}>
        <span class="suave fs-sm">${esc(p.unidade)}</span>
        ${p.disponivel ? '' : '<span><span class="selo cinza">Oculto para clientes</span></span>'}
        <span class="preco">${brl(p.preco)}</span>
      </div>
    </a>`;

  // Só entram as categorias que têm algum produto à mostra, na ordem definida pela loja.
  const grupos = categorias.map((c) => ({ nome: c.nome, produtos: produtos.filter((p) => p.categoriaId === c.id) })).filter((g) => g.produtos.length);
  if (!grupos.length) {
    grade.innerHTML = produtos.map((p) => cartao(p)).join(''); // loja sem categorias: uma lista só, como sempre foi
    return;
  }
  const semCategoria = produtos.filter((p) => !categorias.some((c) => c.id === p.categoriaId));
  if (semCategoria.length) grupos.push({ nome: `Mais ${minusculas(catalogo.nomePlural)}`, produtos: semCategoria });

  grade.className = '';
  grade.innerHTML = `
    <div class="filtros" id="filtros" role="group" aria-label="Categorias">
      <button type="button" data-grupo="todos" aria-pressed="true">Tudo</button>
      ${grupos.map((g, i) => `<button type="button" data-grupo="${i}" aria-pressed="false">${esc(g.nome)}</button>`).join('')}
    </div>
    ${grupos.map((g, i) => `
    <section data-secao="${i}">
      <h3 class="titulo-categoria">${esc(g.nome)}</h3>
      <div class="grade-produtos">${g.produtos.map((p) => cartao(p, 'h4')).join('')}</div>
    </section>`).join('')}`;

  document.getElementById('filtros').addEventListener('click', (evento) => {
    const escolhido = evento.target.dataset.grupo;
    if (escolhido === undefined) return;
    grade.querySelectorAll('[data-grupo]').forEach((b) => b.setAttribute('aria-pressed', b.dataset.grupo === escolhido));
    grade.querySelectorAll('[data-secao]').forEach((s) => { s.hidden = escolhido !== 'todos' && s.dataset.secao !== escolhido; });
  });
}).catch((erro) => App.aviso(erro.message, { erro: true }));
