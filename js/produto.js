'use strict';
// Página de um produto: o cliente escolhe quantidade/alterações; a loja logada edita tudo no próprio lugar.
// Variações, adicionais e estoque são recursos opcionais: só aparecem aqui se a loja ligou (Painel > Configurações).

App.pronto.then(async ({ loja, pode, catalogo, modulos }) => {
  const admin = pode('produtos.editar'); // quem pode editar o catálogo vê o botão Editar
  const { esc, brl, api, aviso, fotoHtml, minusculas } = App;
  const conteudo = document.getElementById('conteudo');
  const slug = location.pathname.split('/')[2];

  let produto;
  try {
    produto = await api(`/api/produtos/${slug}`);
  } catch (erro) {
    conteudo.innerHTML = `<p>${esc(erro.message)}</p><a class="btn btn-outline theme-primary" href="/">Ver ${esc(minusculas(catalogo.nomePlural))}</a>`;
    return;
  }

  function mostrar() {
    document.title = `${produto.nome} · ${loja.nome}`;
    const variacoesHtml = produto.variacoes.length ? `
            <fieldset class="mb-4">
              <legend class="form-label">Escolha uma opção</legend>
              ${produto.variacoes.map((v) => `
              <label class="opcao"><input type="radio" name="variacao" value="${esc(v.id)}" required ${v.estoque === 0 ? 'disabled' : ''}>
                <span>${esc(v.nome)}${v.estoque === 0 ? ' <span class="suave">(esgotado)</span>' : ''}</span><span class="valor">${brl(v.preco)}</span></label>`).join('')}
            </fieldset>` : '';
    const adicionaisHtml = produto.adicionais.length ? `
            <fieldset class="mb-4">
              <legend class="form-label">Adicionais (opcional)</legend>
              ${produto.adicionais.map((a) => `
              <label class="opcao"><input type="checkbox" name="adicional" value="${esc(a.id)}">
                <span>${esc(a.nome)}</span><span class="valor">${a.preco ? `+ ${brl(a.preco)}` : 'sem custo'}</span></label>`).join('')}
            </fieldset>` : '';

    conteudo.innerHTML = `
      <p><a href="/">← ${esc(catalogo.nomePlural)}</a></p>
      <div class="row g-7">
        <div class="col-12 md:col-6">${fotoHtml(produto, 'grande', { ampliar: true })}</div>
        <div class="col-12 md:col-6">
          ${produto.disponivel ? '' : '<p><span class="selo cinza">Oculto para clientes</span></p>'}
          ${produto.esgotado ? '<p><span class="selo cinza">Esgotado</span></p>' : ''}
          <h1 class="mb-2">${esc(produto.nome)}</h1>
          <p class="mb-4"><span class="preco-grande" id="preco-atual" aria-live="polite"></span> <span class="suave">/ ${esc(produto.unidade)}</span></p>
          <p class="pre-linha mb-6">${esc(produto.descricao)}</p>

          <form class="painel" id="form-pedido">
            ${variacoesHtml}
            ${adicionaisHtml}
            <div class="mb-4">
              <label class="form-label d-block" for="quantidade">Quantidade</label>
              <div class="qtd">
                <button type="button" data-passo="-1" aria-label="Diminuir">−</button>
                <input id="quantidade" type="number" min="1" max="999" value="1" inputmode="numeric" required>
                <button type="button" data-passo="1" aria-label="Aumentar">+</button>
              </div>
              <div class="suave fs-sm mt-1" id="nota-estoque" role="status"></div>
            </div>
            <div class="mb-5">
              <label class="form-label" for="observacoes">Alterações ou observações (opcional)</label>
              <textarea class="form-control" id="observacoes" rows="3" maxlength="300" placeholder="Ex.: preferências, restrições ou um recado"></textarea>
            </div>
            <button class="btn btn-solid theme-primary btn-lg w-100" ${produto.esgotado ? 'disabled' : ''}>${produto.esgotado ? 'Esgotado' : 'Adicionar ao carrinho'}</button>
          </form>

          ${admin ? `<button type="button" class="btn btn-outline theme-primary mt-5" id="editar">✏️ Editar ${esc(minusculas(catalogo.nomeSingular))}</button>` : ''}
        </div>
      </div>`;

    const form = document.getElementById('form-pedido');
    const quantidade = document.getElementById('quantidade');
    const limitar = (n) => Math.min(Number(quantidade.max), Math.max(1, Math.trunc(n) || 1));

    // O que está marcado agora no formulário.
    const escolhido = () => ({
      variacaoId: form.querySelector('input[name=variacao]:checked')?.value || '',
      adicionaisIds: [...form.querySelectorAll('input[name=adicional]:checked')].map((c) => c.value),
    });

    // Preço e limite de quantidade acompanham a variação e os adicionais marcados.
    function atualizar() {
      const item = escolhido();
      const escolhas = App.escolhasDoItem(produto, item); // null enquanto falta escolher a variação
      document.getElementById('preco-atual').textContent = escolhas ? brl(escolhas.precoUnit) : App.precoVitrine(produto);
      const estoque = escolhas?.variacao ? escolhas.variacao.estoque : produto.estoque; // null = sem limite
      quantidade.max = estoque ? Math.min(999, estoque) : 999;
      quantidade.value = limitar(Number(quantidade.value));
      document.getElementById('nota-estoque').textContent = estoque && estoque <= 5 ? `Restam ${estoque} no estoque.` : '';
    }
    form.addEventListener('change', atualizar);
    atualizar();

    conteudo.querySelectorAll('[data-passo]').forEach((botao) => botao.addEventListener('click', () => {
      quantidade.value = limitar(Number(quantidade.value) + Number(botao.dataset.passo));
    }));
    form.addEventListener('submit', (evento) => {
      evento.preventDefault();
      App.carrinho.adicionar(produto.id, limitar(Number(quantidade.value)), document.getElementById('observacoes').value.trim(), escolhido());
      aviso('Adicionado ao carrinho.', { html: '<a href="/carrinho">Ver carrinho</a>' });
    });
    document.getElementById('editar')?.addEventListener('click', abrirEdicao);
  }

  const abrirEdicao = () => editar().catch((erro) => aviso(erro.message, { erro: true }));

  // ---- edição pela loja
  const precoTexto = (centavos) => (centavos / 100).toFixed(2).replace('.', ',');

  // Uma linha da lista de variações ou de adicionais. `data-id` vazio = opção nova.
  function linhaOpcao(opcao = {}, comEstoque = false) {
    return `
      <div class="linha-opcao" data-id="${esc(opcao.id || '')}">
        <input class="form-control" data-campo="nome" maxlength="60" required placeholder="Nome" aria-label="Nome" value="${esc(opcao.nome || '')}">
        <input class="form-control" data-campo="preco" inputmode="decimal" required placeholder="Preço" aria-label="Preço (R$)" value="${opcao.preco == null ? '' : precoTexto(opcao.preco)}">
        ${comEstoque ? `<input class="form-control" data-campo="estoque" type="number" min="0" max="999999" step="1" placeholder="Estoque" aria-label="Estoque (vazio = sem controle)" value="${opcao.estoque ?? ''}">` : ''}
        <button type="button" class="botao-texto" data-remover-opcao>Remover</button>
      </div>`;
  }

  // "" -> null (sem controle); o servidor confere se é um número inteiro válido.
  const lerEstoque = (textoEstoque) => (textoEstoque.trim() === '' ? null : Number(textoEstoque));

  // Lê as linhas de uma lista de opções. Lança erro se algum preço estiver em formato inválido.
  function lerOpcoes(lista, comEstoque) {
    return [...lista.querySelectorAll('.linha-opcao')].map((linha) => {
      const valor = (nome) => linha.querySelector(`[data-campo=${nome}]`).value;
      const preco = App.lerPreco(valor('preco'));
      if (preco === null) throw new Error(`Preço inválido em "${valor('nome')}". Use o formato 12,50.`);
      return { id: linha.dataset.id || undefined, nome: valor('nome'), preco, ...(comEstoque ? { estoque: lerEstoque(valor('estoque')) } : {}) };
    });
  }

  async function editar() {
    const categorias = await api('/api/categorias');
    conteudo.innerHTML = `
      <form class="painel-edicao" id="form-edicao">
        <h1 class="fs-xl mb-5">Editando: ${esc(produto.nome)}</h1>
        <div class="row g-5">
          <div class="col-12 md:col-5">
            <div id="previa">${fotoHtml(produto, 'grande')}</div>
            <label class="form-label mt-4" for="foto">Foto</label>
            <input class="form-control" id="foto" type="file" accept="image/jpeg,image/png,image/webp">
            ${produto.imagem ? '<label class="d-flex gap-2 align-items-center mt-3"><input type="checkbox" id="remover-foto"> Remover a foto atual</label>' : ''}
          </div>
          <div class="col-12 md:col-7">
            <div class="mb-4"><label class="form-label" for="nome">Nome</label>
              <input class="form-control" id="nome" maxlength="80" required value="${esc(produto.nome)}"></div>
            <div class="row g-4 mb-4">
              <div class="col-5"><label class="form-label" for="preco">Preço (R$)</label>
                <input class="form-control" id="preco" inputmode="decimal" required value="${precoTexto(produto.preco)}"></div>
              <div class="col-7"><label class="form-label" for="unidade">Vendido por</label>
                <input class="form-control" id="unidade" maxlength="40" value="${esc(produto.unidade)}" placeholder="unidade, caixa com 6, kg…"></div>
            </div>
            <div class="mb-4"><label class="form-label" for="descricao">Descrição</label>
              <textarea class="form-control" id="descricao" rows="6" maxlength="1000">${esc(produto.descricao)}</textarea></div>
            ${categorias.length ? `
            <div class="mb-4"><label class="form-label" for="categoria">Categoria</label>
              <select class="form-control" id="categoria">
                <option value="">Sem categoria</option>
                ${categorias.map((c) => `<option value="${c.id}"${c.id === produto.categoriaId ? ' selected' : ''}>${esc(c.nome)}</option>`).join('')}
              </select></div>` : ''}
            ${modulos.variacoes ? `
            <fieldset class="mb-4">
              <legend class="form-label">Variações</legend>
              <p class="suave fs-sm mb-2">O mesmo item em opções com preço próprio (ex.: Pequeno, Médio, Grande). O cliente escolhe uma, e o preço dela vale no lugar do preço acima.${modulos.estoque ? ' O terceiro campo é o estoque de cada opção; vazio = sem controle.' : ''}</p>
              <div id="lista-variacoes">${produto.variacoes.map((v) => linhaOpcao(v, modulos.estoque)).join('')}</div>
              <button type="button" class="btn btn-outline theme-primary btn-sm" data-nova-opcao="lista-variacoes">+ Adicionar variação</button>
            </fieldset>` : ''}
            ${modulos.adicionais ? `
            <fieldset class="mb-4">
              <legend class="form-label">Adicionais</legend>
              <p class="suave fs-sm mb-2">Extras que o cliente pode marcar, somados ao preço (ex.: calda, embalagem para presente). Preço 0,00 = sem custo.</p>
              <div id="lista-adicionais">${produto.adicionais.map((a) => linhaOpcao(a)).join('')}</div>
              <button type="button" class="btn btn-outline theme-primary btn-sm" data-nova-opcao="lista-adicionais">+ Adicionar adicional</button>
            </fieldset>` : ''}
            ${modulos.estoque ? `
            <div class="mb-4" id="grupo-estoque"><label class="form-label" for="estoque">Estoque</label>
              <input class="form-control" id="estoque" type="number" min="0" max="999999" step="1" placeholder="Sem controle" value="${produto.estoque ?? ''}" style="max-width: 10rem">
              <div class="suave fs-sm mt-1">Deixe vazio para não controlar. Cada pedido diminui o estoque; em zero, o item aparece como esgotado.</div></div>` : ''}
            <div class="mb-4"><label class="form-label" for="emoji">Emoji (aparece quando não há foto)</label>
              <input class="form-control" id="emoji" maxlength="8" value="${esc(produto.emoji)}" style="max-width: 6rem"></div>
            <label class="d-flex gap-2 align-items-center mb-5">
              <input type="checkbox" id="disponivel" ${produto.disponivel ? 'checked' : ''}> Disponível para os clientes
            </label>
            <div class="d-flex flex-wrap gap-3">
              <button class="btn btn-solid theme-primary">Salvar</button>
              <button type="button" class="btn btn-outline theme-primary" id="cancelar">Cancelar</button>
            </div>
          </div>
        </div>
      </form>`;

    const campo = (id) => document.getElementById(id);
    const temVariacoes = () => Boolean(campo('lista-variacoes')?.querySelector('.linha-opcao'));
    // Com variações, o estoque é o de cada uma: o campo de estoque do produto sai da tela.
    const ajustarEstoque = () => { if (campo('grupo-estoque')) campo('grupo-estoque').hidden = temVariacoes(); };
    ajustarEstoque();

    campo('form-edicao').addEventListener('click', (evento) => {
      const { novaOpcao } = evento.target.dataset;
      if (novaOpcao) {
        campo(novaOpcao).insertAdjacentHTML('beforeend', linhaOpcao({}, novaOpcao === 'lista-variacoes' && modulos.estoque));
        campo(novaOpcao).lastElementChild.querySelector('input').focus();
      } else if ('removerOpcao' in evento.target.dataset) {
        evento.target.closest('.linha-opcao').remove();
      } else return;
      ajustarEstoque();
    });

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
        // Só vai para o servidor o que está na tela: campo de recurso desligado não é enviado, e o que estava
        // gravado continua como está.
        const corpo = {
          nome: campo('nome').value, preco, unidade: campo('unidade').value, descricao: campo('descricao').value,
          emoji: campo('emoji').value, disponivel: campo('disponivel').checked,
        };
        if (campo('categoria')) corpo.categoriaId = campo('categoria').value;
        if (modulos.variacoes) corpo.variacoes = lerOpcoes(campo('lista-variacoes'), modulos.estoque);
        if (modulos.adicionais) corpo.adicionais = lerOpcoes(campo('lista-adicionais'), false);
        if (modulos.estoque && !temVariacoes()) corpo.estoque = lerEstoque(campo('estoque').value);

        produto = await api(`/api/produtos/${produto.id}`, { metodo: 'PUT', corpo });
        if (novaFoto) produto = await api(`/api/produtos/${produto.id}/imagem`, { metodo: 'PUT', corpo: { imagem: novaFoto } });
        else if (campo('remover-foto')?.checked) produto = await api(`/api/produtos/${produto.id}/imagem`, { metodo: 'PUT', corpo: { imagem: '' } });
        mostrar();
        aviso('Alterações salvas.');
      } catch (erro) {
        aviso(erro.message, { erro: true });
      }
    });
  }

  if (admin && new URLSearchParams(location.search).has('editar')) abrirEdicao();
  else mostrar();
});
