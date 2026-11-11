'use strict';
// Página de um doce: o cliente escolhe quantidade/alterações; a confeiteira logada edita tudo no próprio lugar.

App.pronto.then(async ({ loja, admin }) => {
  const { esc, brl, api, aviso, fotoHtml } = App;
  const conteudo = document.getElementById('conteudo');
  const slug = location.pathname.split('/')[2];

  let doce;
  try {
    doce = await api(`/api/doces/${slug}`);
  } catch (erro) {
    conteudo.innerHTML = `<p>${esc(erro.message)}</p><a class="btn btn-outline theme-primary" href="/">Ver todos os doces</a>`;
    return;
  }

  function mostrar() {
    document.title = `${doce.nome} · ${loja.nome}`;
    conteudo.innerHTML = `
      <p><a href="/">← Todos os doces</a></p>
      <div class="row g-7">
        <div class="col-12 md:col-6">${fotoHtml(doce, 'grande', { ampliar: true })}</div>
        <div class="col-12 md:col-6">
          ${doce.disponivel ? '' : '<p><span class="selo cinza">Oculto para clientes</span></p>'}
          <h1 class="mb-2">${esc(doce.nome)}</h1>
          <p class="mb-4"><span class="preco-grande">${brl(doce.preco)}</span> <span class="suave">/ ${esc(doce.unidade)}</span></p>
          <p class="pre-linha mb-6">${esc(doce.descricao)}</p>

          <form class="painel" id="form-pedido">
            <div class="mb-4">
              <label class="form-label d-block" for="quantidade">Quantidade</label>
              <div class="qtd">
                <button type="button" data-passo="-1" aria-label="Diminuir">−</button>
                <input id="quantidade" type="number" min="1" max="999" value="1" inputmode="numeric" required>
                <button type="button" data-passo="1" aria-label="Aumentar">+</button>
              </div>
            </div>
            <div class="mb-5">
              <label class="form-label" for="observacoes">Alterações ou observações (opcional)</label>
              <textarea class="form-control" id="observacoes" rows="3" maxlength="300" placeholder="Ex.: sem lactose, escrever &quot;Parabéns, Ana&quot;, menos açúcar…"></textarea>
            </div>
            <button class="btn btn-solid theme-primary btn-lg w-100">Adicionar ao carrinho</button>
          </form>

          ${admin ? '<button type="button" class="btn btn-outline theme-primary mt-5" id="editar">✏️ Editar este doce</button>' : ''}
        </div>
      </div>`;

    const quantidade = document.getElementById('quantidade');
    const limitar = (n) => Math.min(999, Math.max(1, Math.trunc(n) || 1));
    conteudo.querySelectorAll('[data-passo]').forEach((botao) => botao.addEventListener('click', () => {
      quantidade.value = limitar(Number(quantidade.value) + Number(botao.dataset.passo));
    }));
    document.getElementById('form-pedido').addEventListener('submit', (evento) => {
      evento.preventDefault();
      App.carrinho.adicionar(doce.id, limitar(Number(quantidade.value)), document.getElementById('observacoes').value.trim());
      aviso('Adicionado ao carrinho.', { html: '<a href="/carrinho">Ver carrinho</a>' });
    });
    document.getElementById('editar')?.addEventListener('click', editar);
  }

  function editar() {
    conteudo.innerHTML = `
      <form class="painel-edicao" id="form-edicao">
        <h1 class="fs-xl mb-5">Editando: ${esc(doce.nome)}</h1>
        <div class="row g-5">
          <div class="col-12 md:col-5">
            <div id="previa">${fotoHtml(doce, 'grande')}</div>
            <label class="form-label mt-4" for="foto">Foto</label>
            <input class="form-control" id="foto" type="file" accept="image/jpeg,image/png,image/webp">
            ${doce.imagem ? '<label class="d-flex gap-2 align-items-center mt-3"><input type="checkbox" id="remover-foto"> Remover a foto atual</label>' : ''}
          </div>
          <div class="col-12 md:col-7">
            <div class="mb-4"><label class="form-label" for="nome">Nome</label>
              <input class="form-control" id="nome" maxlength="80" required value="${esc(doce.nome)}"></div>
            <div class="row g-4 mb-4">
              <div class="col-5"><label class="form-label" for="preco">Preço (R$)</label>
                <input class="form-control" id="preco" inputmode="decimal" required value="${(doce.preco / 100).toFixed(2).replace('.', ',')}"></div>
              <div class="col-7"><label class="form-label" for="unidade">Vendido por</label>
                <input class="form-control" id="unidade" maxlength="40" value="${esc(doce.unidade)}" placeholder="unidade, caixa com 6, kg…"></div>
            </div>
            <div class="mb-4"><label class="form-label" for="descricao">Descrição</label>
              <textarea class="form-control" id="descricao" rows="6" maxlength="1000">${esc(doce.descricao)}</textarea></div>
            <div class="mb-4"><label class="form-label" for="emoji">Emoji (aparece quando não há foto)</label>
              <input class="form-control" id="emoji" maxlength="8" value="${esc(doce.emoji)}" style="max-width: 6rem"></div>
            <label class="d-flex gap-2 align-items-center mb-5">
              <input type="checkbox" id="disponivel" ${doce.disponivel ? 'checked' : ''}> Disponível para os clientes
            </label>
            <div class="d-flex flex-wrap gap-3">
              <button class="btn btn-solid theme-primary">Salvar</button>
              <button type="button" class="btn btn-outline theme-primary" id="cancelar">Cancelar</button>
            </div>
          </div>
        </div>
      </form>`;

    const campo = (id) => document.getElementById(id);
    let novaFoto = null;
    campo('foto').addEventListener('change', async () => {
      const arquivo = campo('foto').files[0];
      if (!arquivo) return;
      try {
        novaFoto = await App.reduzirImagem(arquivo);
        campo('previa').innerHTML = `<div class="foto grande"><img src="${novaFoto}" alt="Prévia da nova foto"></div>`;
      } catch {
        aviso('Não consegui ler essa imagem. Tente outra.', { erro: true });
      }
    });
    campo('cancelar').addEventListener('click', mostrar);
    campo('form-edicao').addEventListener('submit', async (evento) => {
      evento.preventDefault();
      const preco = App.lerPreco(campo('preco').value);
      if (preco === null) return aviso('Preço inválido. Use o formato 12,50.', { erro: true });
      try {
        doce = await api(`/api/doces/${doce.id}`, { metodo: 'PUT', corpo: {
          nome: campo('nome').value, preco, unidade: campo('unidade').value, descricao: campo('descricao').value,
          emoji: campo('emoji').value, disponivel: campo('disponivel').checked,
        } });
        if (novaFoto) doce = await api(`/api/doces/${doce.id}/imagem`, { metodo: 'PUT', corpo: { imagem: novaFoto } });
        else if (campo('remover-foto')?.checked) doce = await api(`/api/doces/${doce.id}/imagem`, { metodo: 'PUT', corpo: { imagem: '' } });
        mostrar();
        aviso('Alterações salvas.');
      } catch (erro) {
        aviso(erro.message, { erro: true });
      }
    });
  }

  if (admin && new URLSearchParams(location.search).has('editar')) editar();
  else mostrar();
});
