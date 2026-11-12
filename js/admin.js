'use strict';
// Painel da loja: resumo com gráficos, pedidos, clientes, produtos e configurações.

App.pronto.then(async ({ loja, admin, catalogo, tema }) => {
  if (!admin) return location.replace('/login');
  const { esc, brl, dataBr, api, aviso, minusculas } = App;
  const el = (id) => document.getElementById(id);
  document.title = `Painel · ${loja.nome}`;

  const STATUS = App.STATUS;
  // Os gráficos usam as cores do tema da loja (variáveis de css/site.css, trocadas por /tema.css).
  const corDoTema = (variavel) => getComputedStyle(document.documentElement).getPropertyValue(variavel).trim();
  const COR = corDoTema('--destaque');
  const COR_FORTE = corDoTema('--destaque-escuro');
  const COR_TEXTO = corDoTema('--tinta-suave');
  const COR_GRADE = corDoTema('--marca');

  // ------------------------------------------------------------ abas
  const ABAS = ['resumo', 'pedidos', 'clientes', 'produtos', 'aparencia', 'config'];
  const carregar = { resumo: carregarResumo, pedidos: carregarPedidos, clientes: carregarClientes, produtos: carregarProdutos, aparencia: carregarAparencia, config: carregarConfig };

  // A loja escolhe como chamar o que vende (doces, pratos, produtos...): os textos do painel seguem essa escolha.
  document.querySelector('[data-aba=produtos]').textContent = catalogo.nomePlural;
  el('titulo-grafico-produtos').textContent = `${catalogo.nomePlural} que mais renderam`;
  el('titulo-novo-produto').textContent = `Adicionar ${minusculas(catalogo.nomeSingular)}`;

  function abrirAba() {
    const pedida = location.hash.slice(1) === 'doces' ? 'produtos' : location.hash.slice(1); // #doces: endereço antigo da aba
    const aba = ABAS.includes(pedida) ? pedida : 'resumo';
    for (const nome of ABAS) {
      el(`aba-${nome}`).hidden = nome !== aba;
      document.querySelector(`[data-aba=${nome}]`).setAttribute('aria-selected', nome === aba);
    }
    carregar[aba]().catch(tratarErro);
  }
  document.querySelectorAll('[data-aba]').forEach((b) => b.addEventListener('click', () => { location.hash = b.dataset.aba; }));
  window.addEventListener('hashchange', abrirAba);

  function tratarErro(erro) {
    if (erro.status === 401) return location.replace('/login');
    aviso(erro.message, { erro: true });
  }

  // ------------------------------------------------------------ resumo
  let dias = 30;
  const graficos = {};

  function desenharBarras(id, { rotulos, valores, horizontal = false, titulos = rotulos, extra = () => '' }) {
    graficos[id]?.destroy();
    const eixoValor = { beginAtZero: true, grid: { color: COR_GRADE }, border: { display: false },
      ticks: { color: COR_TEXTO, maxTicksLimit: 5, callback: (v) => brl(v * 100).replace(',00', '') } };
    const eixoCategoria = { grid: { display: false }, border: { color: COR_GRADE },
      ticks: { color: COR_TEXTO, maxRotation: 0, autoSkipPadding: 12 } };
    graficos[id] = new Chart(el(id), {
      type: 'bar',
      data: { labels: rotulos, datasets: [{ data: valores.map((v) => v / 100), backgroundColor: COR, hoverBackgroundColor: COR_FORTE, borderRadius: 4, maxBarThickness: 36 }] },
      options: {
        indexAxis: horizontal ? 'y' : 'x', responsive: true, maintainAspectRatio: false,
        scales: horizontal ? { x: eixoValor, y: eixoCategoria } : { x: eixoCategoria, y: eixoValor },
        plugins: {
          legend: { display: false },
          tooltip: { displayColors: false, callbacks: {
            title: (itens) => titulos[itens[0].dataIndex],
            label: (item) => brl(valores[item.dataIndex]),
            afterLabel: (item) => extra(item.dataIndex),
          } },
        },
      },
    });
  }

  async function carregarResumo() {
    document.querySelectorAll('#periodo button').forEach((b) => b.setAttribute('aria-pressed', Number(b.dataset.dias) === dias));
    const r = await api(`/api/dashboard?dias=${dias}`);
    el('alerta-senha').hidden = !r.senhaInicial;

    const { receita, receitaAnterior, pedidos, ticketMedio, emAberto } = r.kpis;
    let comparacao = 'sem pedidos no período anterior';
    if (receitaAnterior > 0) {
      const variacao = Math.round(((receita - receitaAnterior) / receitaAnterior) * 100);
      comparacao = `${variacao >= 0 ? '▲' : '▼'} ${Math.abs(variacao)}% vs. ${dias} dias anteriores`;
    }
    const kpi = (rotulo, valor, nota = '') =>
      `<div class="kpi"><div class="rotulo">${rotulo}</div><div class="valor">${valor}</div><div class="nota">${nota}</div></div>`;
    el('kpis').innerHTML =
      kpi(`Receita (${dias} dias)`, brl(receita), comparacao) +
      kpi('Pedidos', pedidos, r.status.cancelado ? `${r.status.cancelado} cancelado(s) fora da conta` : '') +
      kpi('Ticket médio', brl(ticketMedio)) +
      kpi('Em aberto agora', emAberto, r.status.novo ? `<a href="#pedidos">${r.status.novo} novo(s) para confirmar</a>` : 'aguardando produção ou entrega');

    desenharBarras('grafico-receita', {
      rotulos: r.serie.map((d) => dataBr(d.data).slice(0, 5)),
      titulos: r.serie.map((d) => dataBr(d.data)),
      valores: r.serie.map((d) => d.receita),
      extra: (i) => `${r.serie[i].pedidos} pedido(s)`,
    });
    const comVenda = r.serie.filter((d) => d.pedidos > 0).reverse();
    el('tabela-receita').innerHTML = comVenda.length ? `
      <table class="tabela-simples"><thead><tr><th>Dia</th><th>Pedidos</th><th>Receita</th></tr></thead><tbody>
        ${comVenda.map((d) => `<tr><td>${dataBr(d.data)}</td><td>${d.pedidos}</td><td>${brl(d.receita)}</td></tr>`).join('')}
      </tbody></table>` : '<p class="suave fs-sm mb-0">Nenhuma venda no período.</p>';

    desenharBarras('grafico-produtos', {
      horizontal: true,
      rotulos: r.topProdutos.map((d) => (d.nome.length > 18 ? d.nome.slice(0, 17) + '…' : d.nome)),
      titulos: r.topProdutos.map((d) => d.nome),
      valores: r.topProdutos.map((d) => d.receita),
      extra: (i) => `${r.topProdutos[i].quantidade} vendido(s)`,
    });
    el('tabela-produtos').innerHTML = r.topProdutos.length ? `
      <table class="tabela-simples"><thead><tr><th>${esc(catalogo.nomeSingular)}</th><th>Qtd.</th><th>Receita</th></tr></thead><tbody>
        ${r.topProdutos.map((d) => `<tr><td>${esc(d.nome)}</td><td>${d.quantidade}</td><td>${brl(d.receita)}</td></tr>`).join('')}
      </tbody></table>` : '<p class="suave fs-sm mb-0">Nenhuma venda no período.</p>';
  }

  el('periodo').addEventListener('click', (evento) => {
    if (!evento.target.dataset.dias) return;
    dias = Number(evento.target.dataset.dias);
    carregarResumo().catch(tratarErro);
  });

  // ------------------------------------------------------------ pedidos
  let pedidos = [];
  el('filtro-status').innerHTML =
    '<option value="abertos">Em aberto</option><option value="todos">Todos</option>' +
    Object.entries(STATUS).map(([v, r]) => `<option value="${v}">${r}</option>`).join('');

  function desenharPedidos() {
    const filtro = el('filtro-status').value;
    const visiveis = pedidos.filter((p) =>
      filtro === 'todos' || p.status === filtro || (filtro === 'abertos' && !['entregue', 'cancelado'].includes(p.status)));
    el('lista-pedidos').innerHTML = visiveis.length ? visiveis.map((p) => `
      <article class="pedido${p.status === 'novo' ? ' status-novo' : ''}">
        <div class="pedido-topo">
          <div>
            <strong>Pedido nº ${p.numero}</strong> · ${esc(p.cliente.nome)}
            <div class="suave fs-sm">feito em ${new Date(p.criadoEm).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' })}</div>
          </div>
          <div class="d-flex align-items-center gap-3">
            <strong>${brl(p.total)}</strong>
            <select class="form-control" data-pedido="${p.id}" aria-label="Status do pedido ${p.numero}" style="width: auto">
              ${Object.entries(STATUS).map(([v, r]) => `<option value="${v}"${v === p.status ? ' selected' : ''}>${r}</option>`).join('')}
            </select>
          </div>
        </div>
        <ul>
          ${p.itens.map((i) => `<li>${i.quantidade}× ${esc(i.nome)} — ${brl(i.precoUnit * i.quantidade)}${i.observacoes ? `<br><em>Alterações: ${esc(i.observacoes)}</em>` : ''}</li>`).join('')}
        </ul>
        <div class="fs-sm mt-3">
          <strong>${p.entrega.tipo === 'entrega' ? 'Entrega' : 'Retirada'} em ${dataBr(p.entrega.data)}</strong>${p.entrega.endereco ? ` · ${esc(p.entrega.endereco)}` : ''}
          · <a href="${App.linkWhats(p.cliente.telefone)}" target="_blank" rel="noopener">WhatsApp ${App.formatarTelefone(p.cliente.telefone)}</a>
          ${p.observacoes ? `<div class="mt-1"><strong>Obs.:</strong> ${esc(p.observacoes)}</div>` : ''}
        </div>
      </article>`).join('') : '<p class="suave">Nenhum pedido aqui por enquanto.</p>';
  }

  async function carregarPedidos() {
    pedidos = await api('/api/pedidos');
    desenharPedidos();
  }

  el('filtro-status').addEventListener('change', desenharPedidos);
  el('lista-pedidos').addEventListener('change', async (evento) => {
    const id = evento.target.dataset.pedido;
    if (!id) return;
    try {
      const atualizado = await api(`/api/pedidos/${id}`, { metodo: 'PATCH', corpo: { status: evento.target.value } });
      pedidos = pedidos.map((p) => (p.id === id ? atualizado : p));
      desenharPedidos();
      aviso(`Pedido nº ${atualizado.numero}: ${STATUS[atualizado.status]}.`);
    } catch (erro) {
      tratarErro(erro);
      desenharPedidos();
    }
  });

  // ------------------------------------------------------------ clientes (pedidos por pessoa)
  let pessoas = [];

  function desenharClientes() {
    const busca = el('busca-cliente').value.trim().toLowerCase();
    const visiveis = pessoas.filter((p) => !busca || `${p.nome} ${p.telefone} ${p.email}`.toLowerCase().includes(busca));
    el('lista-clientes').innerHTML = visiveis.length ? visiveis.map((p) => `
      <details class="pedido">
        <summary class="pedido-topo">
          <div>
            <strong>${esc(p.nome)}</strong>
            <span class="selo${p.cadastrado ? '' : ' cinza'}">${p.cadastrado ? 'Cadastrado' : 'Sem cadastro'}</span>
            <div class="suave fs-sm">${App.formatarTelefone(p.telefone)}${p.email ? ` · ${esc(p.email)}` : ''}</div>
          </div>
          <div class="text-end">
            <strong>${brl(p.total)}</strong>
            <div class="suave fs-sm">${p.quantidade} pedido(s)${p.ultimoPedido ? ` · último em ${dataBr(p.ultimoPedido)}` : ''}</div>
          </div>
        </summary>
        ${p.pedidos.length ? `
        <table class="tabela-simples mt-3"><thead><tr><th>Pedido</th><th>Itens</th><th>Status</th><th>Total</th></tr></thead><tbody>
          ${p.pedidos.map((x) => `<tr><td>nº ${x.numero}<br><span class="suave">${dataBr(x.criadoEm)}</span></td><td>${esc(x.itens)}</td><td>${STATUS[x.status]}</td><td>${brl(x.total)}</td></tr>`).join('')}
        </tbody></table>` : '<p class="suave fs-sm mt-3 mb-0">Ainda não fez pedidos.</p>'}
      </details>`).join('') : '<p class="suave">Ninguém encontrado.</p>';
  }

  async function carregarClientes() {
    pessoas = await api('/api/clientes');
    desenharClientes();
  }
  el('busca-cliente').addEventListener('input', desenharClientes);

  // ------------------------------------------------------------ produtos
  async function carregarProdutos() {
    const produtos = await api('/api/produtos');
    el('lista-produtos').innerHTML = produtos.length ? produtos.map((d) => `
      <div class="linha-produto">
        <span class="nome">${esc(d.emoji)} ${esc(d.nome)} <span class="suave fw-normal">· ${brl(d.preco)}</span></span>
        <label class="d-flex gap-2 align-items-center fs-sm"><input type="checkbox" data-disponivel="${d.id}" ${d.disponivel ? 'checked' : ''}> Disponível</label>
        <a class="btn btn-outline theme-primary btn-sm" href="/produto/${esc(d.slug)}?editar">Editar</a>
        <button type="button" class="botao-texto" data-excluir="${d.id}" data-nome="${esc(d.nome)}">Excluir</button>
      </div>`).join('') : '<p class="suave mb-0">Nada cadastrado ainda.</p>';
  }

  el('lista-produtos').addEventListener('change', async (evento) => {
    const id = evento.target.dataset.disponivel;
    if (!id) return;
    try {
      await api(`/api/produtos/${id}`, { metodo: 'PUT', corpo: { disponivel: evento.target.checked } });
      aviso(evento.target.checked ? 'Visível para os clientes.' : 'Oculto para os clientes.');
    } catch (erro) { tratarErro(erro); }
  });

  el('lista-produtos').addEventListener('click', async (evento) => {
    const { excluir, nome } = evento.target.dataset;
    if (!excluir || !confirm(`Excluir "${nome}"? Os pedidos antigos continuam guardados.`)) return;
    try {
      await api(`/api/produtos/${excluir}`, { metodo: 'DELETE' });
      await carregarProdutos();
    } catch (erro) { tratarErro(erro); }
  });

  el('form-novo-produto').addEventListener('submit', async (evento) => {
    evento.preventDefault();
    const preco = App.lerPreco(el('novo-preco').value);
    if (preco === null) return aviso('Preço inválido. Use o formato 12,50.', { erro: true });
    try {
      const produto = await api('/api/produtos', { metodo: 'POST', corpo: { nome: el('novo-nome').value, preco } });
      location.href = `/produto/${produto.slug}?editar`;
    } catch (erro) { tratarErro(erro); }
  });

  // ------------------------------------------------------------ configurações
  const CAMPOS_LOJA = ['nome', 'slogan', 'whatsapp', 'instagram', 'email', 'cidade'];
  let dadosLoja = loja;

  const CAMPOS_CATALOGO = ['nomeSingular', 'nomePlural', 'emojiPadrao'];

  async function carregarConfig() {
    for (const campo of CAMPOS_LOJA) el(`loja-${campo}`).value = dadosLoja[campo] || '';
    el('loja-whatsapp').value = App.formatarTelefone(dadosLoja.whatsapp);
    for (const campo of CAMPOS_CATALOGO) el(`catalogo-${campo}`).value = catalogo[campo] || '';
  }

  el('form-catalogo').addEventListener('submit', async (evento) => {
    evento.preventDefault();
    try {
      await api('/api/configuracoes/catalogo', { metodo: 'PUT', corpo: Object.fromEntries(CAMPOS_CATALOGO.map((c) => [c, el(`catalogo-${c}`).value])) });
      location.reload(); // os nomes aparecem no menu, nas abas e nos títulos: recarregar atualiza tudo de uma vez
    } catch (erro) { tratarErro(erro); }
  });

  App.ligarMascaras(el('form-loja'));
  el('form-loja').addEventListener('submit', async (evento) => {
    evento.preventDefault();
    try {
      dadosLoja = await api('/api/loja', { metodo: 'PUT', corpo: Object.fromEntries(CAMPOS_LOJA.map((c) => [c, el(`loja-${c}`).value])) });
      await carregarConfig();
      aviso('Dados salvos.');
    } catch (erro) { tratarErro(erro); }
  });

  // ------------------------------------------------------------ aparência (tema da loja)
  // Cor vazia significa "usar a cor padrão do sistema"; o seletor de cor do navegador sempre mostra alguma, por isso
  // o valor de verdade fica em `cores` e o seletor só reflete.
  const COR_PADRAO = { corPrincipal: '#b8436a', corSecundaria: '#f8dde2' };
  const IMAGENS_TEMA = {
    logo: { maximo: 600, png: true },
    favicon: { maximo: 192, png: true },
    banner: { maximo: 1600, png: false },
  };
  let temaAtual = tema;
  const cores = { corPrincipal: tema.corPrincipal, corSecundaria: tema.corSecundaria };
  let aparenciaPronta = false;

  function mostrarCor(campo) {
    el(`tema-${campo}`).value = cores[campo] || COR_PADRAO[campo];
    el(`tema-${campo}-nota`).textContent = cores[campo] ? cores[campo] : 'cor padrão';
  }

  function mostrarImagem(qual) {
    const caminho = temaAtual[qual];
    el(`previa-${qual}`).innerHTML = caminho ? `<img src="${esc(caminho)}" alt="">` : '<span class="suave fs-sm">Nenhuma imagem enviada.</span>';
    el(`remover-${qual}`).hidden = !caminho;
  }

  async function carregarAparencia() {
    if (!aparenciaPronta) {
      const { fontes } = await api('/api/tema/opcoes');
      el('tema-fonteTitulos').innerHTML = fontes.map((f) => `<option value="${esc(f.id)}">${esc(f.nome)}</option>`).join('');
      aparenciaPronta = true;
    }
    el('tema-fonteTitulos').value = temaAtual.fonteTitulos;
    for (const campo of Object.keys(cores)) mostrarCor(campo);
    for (const qual of Object.keys(IMAGENS_TEMA)) mostrarImagem(qual);
  }

  for (const campo of Object.keys(cores)) {
    el(`tema-${campo}`).addEventListener('input', (evento) => { cores[campo] = evento.target.value; mostrarCor(campo); });
    el(`tema-${campo}-padrao`).addEventListener('click', () => { cores[campo] = ''; mostrarCor(campo); });
  }

  el('form-tema').addEventListener('submit', async (evento) => {
    evento.preventDefault();
    try {
      await api('/api/configuracoes/tema', { metodo: 'PUT', corpo: { ...cores, fonteTitulos: el('tema-fonteTitulos').value } });
      location.reload(); // as cores valem para a página inteira: recarregar aplica tudo de uma vez
    } catch (erro) { tratarErro(erro); }
  });

  for (const [qual, opcoes] of Object.entries(IMAGENS_TEMA)) {
    el(`arquivo-${qual}`).addEventListener('change', async (evento) => {
      const arquivo = evento.target.files[0];
      if (!arquivo) return;
      try {
        const imagem = await App.reduzirImagem(arquivo, opcoes).catch(() => { throw new Error('Não consegui ler essa imagem. Tente outra.'); });
        temaAtual = await api(`/api/tema/imagem/${qual}`, { metodo: 'PUT', corpo: { imagem } });
        mostrarImagem(qual);
        aviso('Imagem salva. Recarregue a página para ver no site.');
      } catch (erro) { tratarErro(erro); }
      evento.target.value = '';
    });
    el(`remover-${qual}`).addEventListener('click', async () => {
      try {
        temaAtual = await api(`/api/tema/imagem/${qual}`, { metodo: 'PUT', corpo: { imagem: '' } });
        mostrarImagem(qual);
        aviso('Imagem removida.');
      } catch (erro) { tratarErro(erro); }
    });
  }

  el('form-senha').addEventListener('submit', async (evento) => {
    evento.preventDefault();
    try {
      await api('/api/senha', { metodo: 'PUT', corpo: { atual: el('senha-atual').value, nova: el('senha-nova').value } });
      evento.target.reset();
      el('alerta-senha').hidden = true;
      aviso('Senha alterada.');
    } catch (erro) { tratarErro(erro); }
  });

  abrirAba();
});
