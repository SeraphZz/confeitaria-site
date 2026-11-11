'use strict';
// Página inicial: capa + grade de doces.

App.pronto.then(async ({ loja, admin }) => {
  const { esc, brl, fotoHtml } = App;
  document.title = loja.nome;
  document.getElementById('capa-titulo').textContent = loja.nome;
  document.getElementById('capa-slogan').textContent = loja.slogan;
  document.getElementById('novo-doce').hidden = !admin;

  const grade = document.getElementById('grade');
  const doces = await App.api('/api/doces');
  if (!doces.length) {
    grade.outerHTML = '<p class="suave">Em breve, novidades por aqui.</p>';
    return;
  }
  grade.innerHTML = doces.map((d) => `
    <a class="doce-card${d.disponivel ? '' : ' indisponivel'}" href="/doce/${esc(d.slug)}">
      ${fotoHtml(d)}
      <div class="corpo">
        <h3>${esc(d.nome)}</h3>
        <span class="suave fs-sm">${esc(d.unidade)}</span>
        ${d.disponivel ? '' : '<span><span class="selo cinza">Oculto para clientes</span></span>'}
        <span class="preco">${brl(d.preco)}</span>
      </div>
    </a>`).join('');
}).catch((erro) => App.aviso(erro.message, { erro: true }));
