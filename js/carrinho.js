'use strict';
// Carrinho + formulário de reserva do pedido.

App.pronto.then(async ({ loja, admin, cliente, catalogo }) => {
  const { esc, brl, api, aviso, carrinho, fotoHtml, minusculas } = App;
  const plural = esc(minusculas(catalogo.nomePlural));
  const conteudo = document.getElementById('conteudo');
  document.title = `Carrinho · ${loja.nome}`;

  const produtos = new Map((await api('/api/produtos')).map((p) => [p.id, p]));
  // Tira do carrinho o que deixou de existir ou ficou indisponível.
  const validos = carrinho.itens().filter((i) => produtos.has(i.produtoId));
  if (validos.length !== carrinho.itens().length) carrinho.salvar(validos);

  const hoje = new Date();
  const hojeIso = `${hoje.getFullYear()}-${String(hoje.getMonth() + 1).padStart(2, '0')}-${String(hoje.getDate()).padStart(2, '0')}`;
  // Cliente logado: os dados do cadastro já vêm preenchidos (e ainda podem ser ajustados neste pedido).
  const rascunho = {
    nome: cliente?.nome || '', telefone: App.formatarTelefone(cliente?.telefone), endereco: cliente?.endereco || {},
    tipo: 'retirada', data: '', observacoes: '',
  };

  // Pedido só com login: quem não entrou vê este convite no lugar do formulário (o carrinho fica guardado).
  const convite = admin ? `
    <div class="painel">
      <h2 class="fs-lg mb-2">Reservar pedido</h2>
      <p class="suave mb-0">Pedidos são feitos por contas de clientes. Para testar, saia do painel e entre como cliente.</p>
    </div>` : `
    <div class="painel">
      <h2 class="fs-lg mb-2">Falta pouco!</h2>
      <p class="suave">Para enviar o pedido, entre na sua conta ou crie uma. Leva um minuto, e seus dados ficam salvos para as próximas encomendas. Seu carrinho continua aqui.</p>
      <div class="d-flex flex-wrap gap-3">
        <a class="btn btn-solid theme-primary" href="/login?voltar=carrinho">Entrar</a>
        <a class="btn btn-outline theme-primary" href="/cadastro?voltar=carrinho">Criar conta</a>
      </div>
    </div>`;

  function total(itens) {
    return itens.reduce((s, i) => s + produtos.get(i.produtoId).preco * i.quantidade, 0);
  }

  function desenhar() {
    const itens = carrinho.itens();
    if (!itens.length) {
      conteudo.innerHTML = `<p class="suave">Seu carrinho está vazio.</p><a class="btn btn-solid theme-primary" href="/">Escolher ${plural}</a>`;
      return;
    }
    conteudo.innerHTML = `
      <div class="row g-7">
        <div class="col-12 lg:col-7">
          ${itens.map((item, i) => {
            const d = produtos.get(item.produtoId);
            return `
            <div class="item-carrinho">
              ${fotoHtml(d)}
              <div>
                <a class="fw-semibold" href="/produto/${esc(d.slug)}">${esc(d.nome)}</a>
                <div class="suave fs-sm">${brl(d.preco)} / ${esc(d.unidade)}</div>
                ${item.observacoes ? `<div class="fs-sm mt-1"><strong>Alterações:</strong> ${esc(item.observacoes)}</div>` : ''}
              </div>
              <div class="lado">
                <strong>${brl(d.preco * item.quantidade)}</strong>
                <div class="qtd">
                  <button type="button" data-i="${i}" data-passo="-1" aria-label="Diminuir">−</button>
                  <input type="number" min="1" max="999" value="${item.quantidade}" data-i="${i}" aria-label="Quantidade de ${esc(d.nome)}">
                  <button type="button" data-i="${i}" data-passo="1" aria-label="Aumentar">+</button>
                </div>
                <button type="button" class="botao-texto" data-remover="${i}">Remover</button>
              </div>
            </div>`;
          }).join('')}
          <div class="total-linha mt-5"><span>Total</span><span>${brl(total(itens))}</span></div>
        </div>

        <div class="col-12 lg:col-5">
          ${!cliente ? convite : `
          <form class="painel" id="form-pedido">
            <h2 class="fs-lg mb-2">Reservar pedido</h2>
            <p class="suave fs-sm mb-4">Você não paga nada agora. A confeiteira confirma o pedido e combina o pagamento pelo WhatsApp.</p>
            <div class="mb-4"><label class="form-label" for="nome">Seu nome</label>
              <input class="form-control" id="nome" maxlength="80" required autocomplete="name" value="${esc(rascunho.nome)}"></div>
            <div class="mb-4"><label class="form-label" for="telefone">WhatsApp com DDD</label>
              <input class="form-control" id="telefone" type="tel" data-mascara="telefone" inputmode="numeric" required autocomplete="tel" placeholder="(11) 99999-9999" value="${esc(rascunho.telefone)}"></div>
            <div class="mb-4"><label class="form-label" for="data">Para quando?</label>
              <input class="form-control" id="data" type="date" required min="${hojeIso}" value="${esc(rascunho.data)}"></div>
            <fieldset class="mb-4">
              <legend class="form-label">Como prefere receber?</legend>
              <label class="d-flex gap-2 align-items-center mb-1"><input type="radio" name="tipo" value="retirada" ${rascunho.tipo === 'retirada' ? 'checked' : ''}> Retirar com a confeiteira</label>
              <label class="d-flex gap-2 align-items-center"><input type="radio" name="tipo" value="entrega" ${rascunho.tipo === 'entrega' ? 'checked' : ''}> Entrega (taxa a combinar)</label>
            </fieldset>
            <fieldset class="mb-4" id="grupo-endereco" ${rascunho.tipo === 'entrega' ? '' : 'hidden disabled'}>
              <legend class="form-label">Endereço de entrega</legend>
              ${App.enderecoHtml(rascunho.endereco, { obrigatorio: true })}
            </fieldset>
            <div class="mb-5"><label class="form-label" for="observacoes">Observações do pedido (opcional)</label>
              <textarea class="form-control" id="observacoes" rows="2" maxlength="500">${esc(rascunho.observacoes)}</textarea></div>
            <button class="btn btn-solid theme-primary btn-lg w-100" id="enviar">Enviar pedido</button>
          </form>`}
        </div>
      </div>`;
  }

  // Guarda o que já foi digitado no formulário antes de redesenhar a lista de itens.
  function guardarRascunho() {
    const form = document.getElementById('form-pedido');
    if (!form) return;
    for (const campo of ['nome', 'telefone', 'data', 'observacoes']) rascunho[campo] = document.getElementById(campo).value;
    rascunho.endereco = App.lerEndereco(form);
    rascunho.tipo = form.elements.tipo.value;
  }

  function alterarItem(indice, mudar) {
    guardarRascunho();
    const itens = carrinho.itens();
    mudar(itens, indice);
    carrinho.salvar(itens);
    desenhar();
  }

  App.ligarMascaras(conteudo); // vale também depois que a lista é redesenhada

  conteudo.addEventListener('click', (evento) => {
    const alvo = evento.target;
    if (alvo.dataset.passo) {
      alterarItem(Number(alvo.dataset.i), (itens, i) => {
        itens[i].quantidade = Math.min(999, Math.max(1, itens[i].quantidade + Number(alvo.dataset.passo)));
      });
    } else if (alvo.dataset.remover) {
      alterarItem(Number(alvo.dataset.remover), (itens, i) => itens.splice(i, 1));
    }
  });

  conteudo.addEventListener('change', (evento) => {
    const alvo = evento.target;
    if (alvo.type === 'number' && alvo.dataset.i) {
      alterarItem(Number(alvo.dataset.i), (itens, i) => {
        itens[i].quantidade = Math.min(999, Math.max(1, Math.trunc(Number(alvo.value)) || 1));
      });
    } else if (alvo.name === 'tipo') {
      const entrega = alvo.value === 'entrega';
      // Fieldset desativado não é validado: os campos obrigatórios do endereço só valem na entrega.
      document.getElementById('grupo-endereco').hidden = !entrega;
      document.getElementById('grupo-endereco').disabled = !entrega;
    }
  });

  conteudo.addEventListener('submit', async (evento) => {
    evento.preventDefault();
    guardarRascunho();
    const botao = document.getElementById('enviar');
    botao.disabled = true;
    try {
      const itens = carrinho.itens();
      const pedido = await api('/api/pedidos', { metodo: 'POST', corpo: {
        cliente: { nome: rascunho.nome, telefone: rascunho.telefone },
        entrega: { tipo: rascunho.tipo, data: rascunho.data, endereco: rascunho.endereco },
        observacoes: rascunho.observacoes, itens,
      } });
      carrinho.salvar([]);
      const mensagem = `Olá! Acabei de fazer o pedido nº ${pedido.numero} pelo site (${brl(pedido.total)}). Meu nome é ${rascunho.nome}.`;
      conteudo.innerHTML = `
        <div class="painel text-center" style="max-width: 34rem; margin: 0 auto">
          <div style="font-size: 3rem" aria-hidden="true">🎉</div>
          <h2 class="mb-2">Pedido nº ${pedido.numero} recebido!</h2>
          <p>Total: <strong>${brl(pedido.total)}</strong>. A confeiteira vai entrar em contato pelo WhatsApp para confirmar e combinar o pagamento.</p>
          <div class="d-flex flex-wrap gap-3 justify-content-center">
            ${loja.whatsapp ? `<a class="btn btn-solid theme-primary" href="${esc(App.linkWhats(loja.whatsapp, mensagem))}" target="_blank" rel="noopener">Avisar pelo WhatsApp</a>` : ''}
            ${cliente ? '<a class="btn btn-outline theme-primary" href="/conta">Ver meus pedidos</a>' : ''}
            <a class="btn btn-outline theme-primary" href="/">Voltar para ${plural}</a>
          </div>
        </div>`;
    } catch (erro) {
      botao.disabled = false;
      aviso(erro.message, { erro: true });
    }
  });

  desenhar();
}).catch((erro) => App.aviso(erro.message, { erro: true }));
