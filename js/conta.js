'use strict';
// Minha conta: dados do cliente e histórico de pedidos.

App.pronto.then(async ({ loja, admin, cliente, catalogo, statusPedidos }) => {
  if (admin) return location.replace('/admin');
  if (!cliente) return location.replace('/login');
  const { esc, brl, dataBr, api, aviso, STATUS } = App;
  document.title = `Minha conta · ${loja.nome}`;

  // O histórico vem uma página por vez, do pedido mais novo para o mais antigo.
  let historico = await api('/api/conta/pedidos');
  // Pedido que já terminou (entregue, cancelado...) aparece com o selo apagado.
  const emAberto = (status) => statusPedidos.find((s) => s.id === status)?.tipo === 'aberto';
  const quando = (iso) => new Date(iso).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' });
  const pedidoHtml = (p) => `
          <article class="pedido">
            <div class="pedido-topo">
              <div><strong>Pedido nº ${p.numero}</strong> <span class="selo${emAberto(p.status) ? '' : ' cinza'}">${esc(STATUS[p.status] || p.status)}</span>
                <div class="suave fs-sm">feito em ${dataBr(p.criadoEm)} · ${p.entrega.tipo === 'entrega' ? 'entrega' : 'retirada'} em ${dataBr(p.entrega.data)}</div></div>
              <strong>${brl(p.total)}</strong>
            </div>
            <ul>${p.itens.map((i) => `<li>${i.quantidade}× ${esc(i.nome + App.opcoesTexto(i.variacao, i.adicionais))}${i.observacoes ? ` <em>(${esc(i.observacoes)})</em>` : ''}</li>`).join('')}</ul>
            ${p.historico.length ? `<details class="mt-3"><summary class="suave fs-sm">Andamento do pedido</summary>
              <ol class="andamento">
                <li><span class="suave">${quando(p.criadoEm)}</span> Pedido feito</li>
                ${p.historico.map((h) => `<li><span class="suave">${quando(h.em)}</span> ${esc(h.nome)}</li>`).join('')}
              </ol></details>` : ''}
          </article>`;
  document.getElementById('conteudo').innerHTML = `
    <div class="d-flex flex-wrap justify-content-between align-items-center gap-3 mb-5">
      <h1 class="secao-titulo mb-0">Minha conta</h1>
      <button type="button" class="btn btn-outline theme-primary btn-sm" id="sair-conta">Sair</button>
    </div>
    <div class="row g-7">
      <div class="col-12 lg:col-5">
        <form class="painel" id="form-conta">
          <h2 class="fs-lg mb-4">Meus dados</h2>
          <p class="suave fs-sm">E-mail: ${esc(cliente.email)}</p>
          <div class="mb-4"><label class="form-label" for="nome">Nome</label>
            <input class="form-control" id="nome" maxlength="80" required value="${esc(cliente.nome)}"></div>
          <div class="mb-4"><label class="form-label" for="telefone">WhatsApp com DDD</label>
            <input class="form-control" id="telefone" type="tel" data-mascara="telefone" inputmode="numeric" required value="${App.formatarTelefone(cliente.telefone)}"></div>
          <fieldset class="mb-5">
            <legend class="form-label">Endereço para entregas</legend>
            ${App.enderecoHtml(cliente.endereco)}
          </fieldset>
          <details class="mb-5">
            <summary>Trocar senha</summary>
            <div class="mt-3 mb-4"><label class="form-label" for="senha-atual">Senha atual</label>
              <input class="form-control" id="senha-atual" type="password" autocomplete="current-password"></div>
            <div><label class="form-label" for="senha-nova">Nova senha (mínimo 8 caracteres)</label>
              <input class="form-control" id="senha-nova" type="password" minlength="8" autocomplete="new-password"></div>
          </details>
          <button class="btn btn-solid theme-primary">Salvar</button>
        </form>
      </div>
      <div class="col-12 lg:col-7">
        <h2 class="fs-lg mb-4">Meus pedidos</h2>
        ${historico.itens.length
          ? `<div id="meus-pedidos">${historico.itens.map(pedidoHtml).join('')}</div>
        <button type="button" class="btn btn-outline theme-primary" id="mais-pedidos" ${historico.pagina >= historico.paginas ? 'hidden' : ''}>Ver pedidos mais antigos</button>`
          : `<p class="suave">Você ainda não fez pedidos.</p><a class="btn btn-solid theme-primary" href="/">Escolher ${esc(App.minusculas(catalogo.nomePlural))}</a>`}
      </div>
    </div>`;

  const campo = (id) => document.getElementById(id);
  campo('mais-pedidos')?.addEventListener('click', async () => {
    try {
      historico = await api(`/api/conta/pedidos?pagina=${historico.pagina + 1}`);
      campo('meus-pedidos').insertAdjacentHTML('beforeend', historico.itens.map(pedidoHtml).join(''));
      campo('mais-pedidos').hidden = historico.pagina >= historico.paginas;
    } catch (erro) {
      aviso(erro.message, { erro: true });
    }
  });
  App.ligarMascaras(campo('form-conta'));
  campo('sair-conta').addEventListener('click', App.sair);
  campo('form-conta').addEventListener('submit', async (evento) => {
    evento.preventDefault();
    try {
      await api('/api/conta', { metodo: 'PUT', corpo: {
        nome: campo('nome').value, telefone: campo('telefone').value, endereco: App.lerEndereco(campo('form-conta')),
        senhaAtual: campo('senha-atual').value, novaSenha: campo('senha-nova').value,
      } });
      campo('senha-atual').value = campo('senha-nova').value = '';
      aviso('Dados salvos.');
    } catch (erro) {
      aviso(erro.message, { erro: true });
    }
  });
}).catch((erro) => App.aviso(erro.message, { erro: true }));
