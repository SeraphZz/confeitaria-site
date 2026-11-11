'use strict';
// Página "Sobre": história e trajetória. A confeiteira logada pode editar aqui mesmo.

App.pronto.then(({ loja, sobre: sobreInicial, admin }) => {
  const { esc, api, aviso } = App;
  const conteudo = document.getElementById('conteudo');
  let sobre = sobreInicial;

  function mostrar() {
    document.title = `Sobre · ${loja.nome}`;
    conteudo.innerHTML = `
      <div class="row g-7">
        <div class="col-12 md:col-6">
          ${sobre.imagem ? `<button type="button" class="retrato ampliar mb-5" data-ampliar aria-label="Ver a foto inteira">
            <img src="${esc(sobre.imagem)}" alt="Foto da confeiteira"></button>` : ''}
          <h1 class="mb-4">${esc(sobre.titulo)}</h1>
          <p class="pre-linha fs-md">${esc(sobre.texto)}</p>
          ${loja.whatsapp ? `<a class="btn btn-solid theme-primary mt-3" href="${App.linkWhats(loja.whatsapp)}" target="_blank" rel="noopener">Falar comigo no WhatsApp</a>` : ''}
        </div>
        <div class="col-12 md:col-6">
          <h2 class="secao-titulo">Trajetória</h2>
          <ol class="linha-tempo">
            ${sobre.trajetoria.map((t) => `
              <li><span class="ano">${esc(t.ano)}</span><h3>${esc(t.titulo)}</h3><p class="suave mb-0">${esc(t.texto)}</p></li>`).join('')}
          </ol>
        </div>
      </div>
      ${admin ? '<button type="button" class="btn btn-outline theme-primary mt-5" id="editar">✏️ Editar esta página</button>' : ''}`;
    document.getElementById('editar')?.addEventListener('click', editar);
  }

  function etapaHtml(t = { ano: '', titulo: '', texto: '' }) {
    return `
      <div class="painel mb-3 etapa">
        <div class="row g-3">
          <div class="col-4"><input class="form-control" data-campo="ano" maxlength="12" placeholder="Ano" aria-label="Ano" value="${esc(t.ano)}"></div>
          <div class="col-8"><input class="form-control" data-campo="titulo" maxlength="80" placeholder="Título" aria-label="Título" required value="${esc(t.titulo)}"></div>
          <div class="col-12"><textarea class="form-control" data-campo="texto" rows="2" maxlength="400" placeholder="O que aconteceu" aria-label="Texto">${esc(t.texto)}</textarea></div>
        </div>
        <button type="button" class="botao-texto mt-2" data-remover>Remover etapa</button>
      </div>`;
  }

  function editar() {
    conteudo.innerHTML = `
      <form class="painel-edicao" id="form-sobre">
        <h1 class="fs-xl mb-5">Editando a página Sobre</h1>
        <div class="mb-5">
          <div id="previa">${sobre.imagem ? `<div class="retrato mb-3"><img src="${esc(sobre.imagem)}" alt="Foto atual"></div>` : ''}</div>
          <label class="form-label" for="foto">Sua foto</label>
          <input class="form-control" id="foto" type="file" accept="image/jpeg,image/png,image/webp" style="max-width: 24rem">
          ${sobre.imagem ? '<label class="d-flex gap-2 align-items-center mt-3"><input type="checkbox" id="remover-foto"> Remover a foto atual</label>' : ''}
        </div>
        <div class="mb-4"><label class="form-label" for="titulo">Título</label>
          <input class="form-control" id="titulo" maxlength="80" required value="${esc(sobre.titulo)}"></div>
        <div class="mb-5"><label class="form-label" for="texto">Sua história</label>
          <textarea class="form-control" id="texto" rows="8" maxlength="5000">${esc(sobre.texto)}</textarea></div>
        <h2 class="fs-lg mb-3">Trajetória</h2>
        <div id="etapas">${sobre.trajetoria.map(etapaHtml).join('')}</div>
        <button type="button" class="btn btn-outline theme-primary btn-sm mb-5" id="nova-etapa">+ Adicionar etapa</button>
        <div class="d-flex flex-wrap gap-3">
          <button class="btn btn-solid theme-primary">Salvar</button>
          <button type="button" class="btn btn-outline theme-primary" id="cancelar">Cancelar</button>
        </div>
      </form>`;

    let novaFoto = null;
    document.getElementById('foto').addEventListener('change', async (evento) => {
      const arquivo = evento.target.files[0];
      if (!arquivo) return;
      try {
        novaFoto = await App.reduzirImagem(arquivo);
        document.getElementById('previa').innerHTML = `<div class="retrato mb-3"><img src="${novaFoto}" alt="Prévia da nova foto"></div>`;
      } catch {
        aviso('Não consegui ler essa imagem. Tente outra.', { erro: true });
      }
    });

    const etapas = document.getElementById('etapas');
    document.getElementById('nova-etapa').addEventListener('click', () => etapas.insertAdjacentHTML('beforeend', etapaHtml()));
    etapas.addEventListener('click', (evento) => {
      if (evento.target.matches('[data-remover]')) evento.target.closest('.etapa').remove();
    });
    document.getElementById('cancelar').addEventListener('click', mostrar);
    document.getElementById('form-sobre').addEventListener('submit', async (evento) => {
      evento.preventDefault();
      const trajetoria = [...etapas.querySelectorAll('.etapa')].map((el) => ({
        ano: el.querySelector('[data-campo=ano]').value,
        titulo: el.querySelector('[data-campo=titulo]').value,
        texto: el.querySelector('[data-campo=texto]').value,
      }));
      try {
        sobre = await api('/api/sobre', { metodo: 'PUT', corpo: {
          titulo: document.getElementById('titulo').value, texto: document.getElementById('texto').value, trajetoria,
        } });
        if (novaFoto) sobre = await api('/api/sobre/imagem', { metodo: 'PUT', corpo: { imagem: novaFoto } });
        else if (document.getElementById('remover-foto')?.checked) sobre = await api('/api/sobre/imagem', { metodo: 'PUT', corpo: { imagem: '' } });
        mostrar();
        aviso('Página atualizada.');
      } catch (erro) {
        aviso(erro.message, { erro: true });
      }
    });
  }

  mostrar();
});
