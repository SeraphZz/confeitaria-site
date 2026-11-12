'use strict';
// Minha conta: dados do cliente e histórico de pedidos.

App.pronto.then(async ({ loja, admin, cliente, catalogo }) => {
  if (admin) return location.replace('/admin');
  if (!cliente) return location.replace('/login');
  const { esc, brl, dataBr, api, aviso, STATUS } = App;
  document.title = `Minha conta · ${loja.nome}`;

  const pedidos = await api('/api/conta/pedidos');
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
        ${pedidos.length ? pedidos.map((p) => `
          <article class="pedido">
            <div class="pedido-topo">
              <div><strong>Pedido nº ${p.numero}</strong> <span class="selo${['entregue', 'cancelado'].includes(p.status) ? ' cinza' : ''}">${STATUS[p.status]}</span>
                <div class="suave fs-sm">feito em ${dataBr(p.criadoEm)} · ${p.entrega.tipo === 'entrega' ? 'entrega' : 'retirada'} em ${dataBr(p.entrega.data)}</div></div>
              <strong>${brl(p.total)}</strong>
            </div>
            <ul>${p.itens.map((i) => `<li>${i.quantidade}× ${esc(i.nome)}${i.observacoes ? ` <em>(${esc(i.observacoes)})</em>` : ''}</li>`).join('')}</ul>
          </article>`).join('')
        : `<p class="suave">Você ainda não fez pedidos.</p><a class="btn btn-solid theme-primary" href="/">Escolher ${esc(App.minusculas(catalogo.nomePlural))}</a>`}
      </div>
    </div>`;

  const campo = (id) => document.getElementById(id);
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
