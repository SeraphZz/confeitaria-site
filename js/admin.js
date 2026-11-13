'use strict';
// Painel da loja: resumo com gráficos, pedidos, clientes, produtos e configurações.

App.pronto.then(async ({ loja, admin, catalogo, atendimento, modulos }) => {
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
          ${p.itens.map((i) => `<li>${i.quantidade}× ${esc(i.nome + App.opcoesTexto(i.variacao, i.adicionais))} — ${brl(i.precoUnit * i.quantidade)}${i.observacoes ? `<br><em>Alterações: ${esc(i.observacoes)}</em>` : ''}</li>`).join('')}
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
  let categorias = [];

  async function carregarProdutos() {
    const [produtos, lista] = await Promise.all([api('/api/produtos'), api('/api/categorias')]);
    categorias = lista;
    const seletorCategoria = (d) => (categorias.length ? `
        <select class="form-control" data-categoria="${d.id}" aria-label="Categoria de ${esc(d.nome)}" style="width: auto; max-width: 12rem">
          <option value="">Sem categoria</option>
          ${categorias.map((c) => `<option value="${c.id}"${c.id === d.categoriaId ? ' selected' : ''}>${esc(c.nome)}</option>`).join('')}
        </select>` : '');
    el('lista-categorias').innerHTML = categorias.length ? categorias.map((c, i) => `
      <div class="linha-produto">
        <input class="form-control nome" data-nome-categoria="${c.id}" maxlength="40" required value="${esc(c.nome)}" aria-label="Nome da categoria ${esc(c.nome)}">
        <button type="button" class="btn btn-outline theme-primary btn-sm" data-mover="${i}" data-passo="-1" aria-label="Subir ${esc(c.nome)}" ${i === 0 ? 'disabled' : ''}>↑</button>
        <button type="button" class="btn btn-outline theme-primary btn-sm" data-mover="${i}" data-passo="1" aria-label="Descer ${esc(c.nome)}" ${i === categorias.length - 1 ? 'disabled' : ''}>↓</button>
        <button type="button" class="botao-texto" data-excluir-categoria="${c.id}" data-nome="${esc(c.nome)}">Excluir</button>
      </div>`).join('') : '<p class="suave mb-0">Nenhuma categoria criada.</p>';
    // Estoque (recurso opcional): produto simples é ajustado aqui mesmo; com variações, na tela de edição.
    const campoEstoque = (d) => (!modulos.estoque ? '' : d.variacoes.length
      ? `<span class="suave fs-sm">Estoque: ${esc(d.variacoes.map((v) => `${v.nome} ${v.estoque ?? '∞'}`).join(' · '))}</span>`
      : `<label class="d-flex gap-2 align-items-center fs-sm">Estoque
          <input class="form-control" type="number" min="0" max="999999" step="1" data-estoque="${d.id}" value="${d.estoque ?? ''}" placeholder="∞" style="width: 5.5rem"></label>`);
    el('lista-produtos').innerHTML = produtos.length ? produtos.map((d) => `
      <div class="linha-produto">
        <span class="nome">${esc(d.emoji)} ${esc(d.nome)} <span class="suave fw-normal">· ${App.precoVitrine(d)}</span>
          ${d.esgotado ? '<span class="selo cinza">Esgotado</span>' : ''}</span>
        ${campoEstoque(d)}
        ${seletorCategoria(d)}
        <label class="d-flex gap-2 align-items-center fs-sm"><input type="checkbox" data-disponivel="${d.id}" ${d.disponivel ? 'checked' : ''}> Disponível</label>
        <a class="btn btn-outline theme-primary btn-sm" href="/produto/${esc(d.slug)}?editar">Editar</a>
        <button type="button" class="botao-texto" data-excluir="${d.id}" data-nome="${esc(d.nome)}">Excluir</button>
      </div>`).join('') : '<p class="suave mb-0">Nada cadastrado ainda.</p>';
  }

  el('lista-produtos').addEventListener('change', async (evento) => {
    const { disponivel, categoria, estoque } = evento.target.dataset;
    try {
      if (estoque) {
        const valor = evento.target.value.trim();
        await api(`/api/produtos/${estoque}`, { metodo: 'PUT', corpo: { estoque: valor === '' ? null : Number(valor) } });
        await carregarProdutos(); // o selo "Esgotado" depende do novo número
        aviso(valor === '' ? 'Estoque sem controle.' : 'Estoque atualizado.');
      } else if (disponivel) {
        await api(`/api/produtos/${disponivel}`, { metodo: 'PUT', corpo: { disponivel: evento.target.checked } });
        aviso(evento.target.checked ? 'Visível para os clientes.' : 'Oculto para os clientes.');
      } else if (categoria) {
        await api(`/api/produtos/${categoria}`, { metodo: 'PUT', corpo: { categoriaId: evento.target.value } });
        aviso('Categoria alterada.');
      }
    } catch (erro) {
      tratarErro(erro);
      carregarProdutos().catch(tratarErro); // a tela volta a mostrar o que está gravado
    }
  });

  // ---- categorias
  // Depois de cada alteração a aba é recarregada: a lista de categorias também aparece em cada produto.
  async function alterarCategorias(pedido, mensagem) {
    try {
      await pedido();
      await carregarProdutos();
      if (mensagem) aviso(mensagem);
    } catch (erro) {
      tratarErro(erro);
      carregarProdutos().catch(tratarErro);
    }
  }

  el('form-nova-categoria').addEventListener('submit', (evento) => {
    evento.preventDefault();
    alterarCategorias(async () => {
      await api('/api/categorias', { metodo: 'POST', corpo: { nome: el('nova-categoria').value } });
      el('nova-categoria').value = '';
    }, 'Categoria criada.');
  });

  el('lista-categorias').addEventListener('change', (evento) => {
    const id = evento.target.dataset.nomeCategoria;
    if (id) alterarCategorias(() => api(`/api/categorias/${id}`, { metodo: 'PUT', corpo: { nome: evento.target.value } }), 'Nome alterado.');
  });

  el('lista-categorias').addEventListener('click', (evento) => {
    const { mover, passo, excluirCategoria, nome } = evento.target.dataset;
    if (mover !== undefined) {
      const ids = categorias.map((c) => c.id);
      const de = Number(mover), para = de + Number(passo);
      [ids[de], ids[para]] = [ids[para], ids[de]];
      alterarCategorias(() => api('/api/categorias/ordem', { metodo: 'PUT', corpo: { ids } }));
    } else if (excluirCategoria && confirm(`Excluir a categoria "${nome}"? Os itens dela continuam cadastrados, sem categoria.`)) {
      alterarCategorias(() => api(`/api/categorias/${excluirCategoria}`, { metodo: 'DELETE' }), 'Categoria excluída.');
    }
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
  const CAMPOS_LOJA = ['nome', 'slogan', 'whatsapp', 'instagram', 'email', 'endereco', 'cidade'];
  let dadosLoja = loja;

  const CAMPOS_CATALOGO = ['nomeSingular', 'nomePlural', 'emojiPadrao'];

  async function carregarConfig() {
    for (const campo of CAMPOS_LOJA) el(`loja-${campo}`).value = dadosLoja[campo] || '';
    el('loja-whatsapp').value = App.formatarTelefone(dadosLoja.whatsapp);
    for (const campo of CAMPOS_CATALOGO) el(`catalogo-${campo}`).value = catalogo[campo] || '';
    for (const nome of MODULOS) el(`modulos-${nome}`).checked = modulos[nome];
    await carregarAtendimento();
  }

  // ---- recursos opcionais do catálogo (variações, adicionais e estoque)
  const MODULOS = ['variacoes', 'adicionais', 'estoque'];
  el('form-modulos').addEventListener('submit', async (evento) => {
    evento.preventDefault();
    try {
      await api('/api/configuracoes/modulos', { metodo: 'PUT', corpo: Object.fromEntries(MODULOS.map((nome) => [nome, el(`modulos-${nome}`).checked])) });
      location.reload(); // os recursos mudam várias telas do painel: recarregar atualiza tudo de uma vez
    } catch (erro) { tratarErro(erro); }
  });

  // ---- horários, fuso e formas de receber o pedido
  const CAMPOS_DIA = ['abre', 'fecha', 'abre2', 'fecha2'];
  // Os quatro fusos do Brasil; um valor diferente já gravado (loja fora do país) entra na lista como está.
  const FUSOS = [
    ['America/Noronha', 'Fernando de Noronha (1 hora à frente de Brasília)'],
    ['America/Sao_Paulo', 'Horário de Brasília'],
    ['America/Manaus', 'Amazonas, Mato Grosso, Mato Grosso do Sul, Rondônia e Roraima (1 hora atrás)'],
    ['America/Rio_Branco', 'Acre (2 horas atrás de Brasília)'],
  ];
  let dadosAtendimento = atendimento;

  function ajustarDia(i) {
    for (const campo of CAMPOS_DIA) el(`dia-${i}-${campo}`).disabled = !el(`dia-${i}-aberto`).checked;
  }

  async function carregarAtendimento() {
    const { operacao } = await api('/api/configuracoes');
    const fusos = FUSOS.some(([id]) => id === operacao.fusoHorario) ? FUSOS : [...FUSOS, [operacao.fusoHorario, operacao.fusoHorario]];
    el('operacao-fusoHorario').innerHTML = fusos.map(([id, nome]) => `<option value="${esc(id)}">${esc(nome)}</option>`).join('');
    el('operacao-fusoHorario').value = operacao.fusoHorario;

    dadosAtendimento.horarios.forEach((dia, i) => {
      el(`dia-${i}-aberto`).checked = dia.aberto;
      for (const campo of CAMPOS_DIA) el(`dia-${i}-${campo}`).value = dia[campo];
      ajustarDia(i);
    });
    el('atendimento-exibirHorarios').checked = dadosAtendimento.exibirHorarios;
    el('atendimento-observacaoHorarios').value = dadosAtendimento.observacaoHorarios;
    el('retirada-ativa').checked = dadosAtendimento.retirada.ativa;
    el('retirada-instrucoes').value = dadosAtendimento.retirada.instrucoes;
    el('entrega-ativa').checked = dadosAtendimento.entrega.ativa;
    el('entrega-taxa').value = dadosAtendimento.entrega.taxa;
    el('entrega-instrucoes').value = dadosAtendimento.entrega.instrucoes;
  }

  for (let i = 0; i < 7; i++) el(`dia-${i}-aberto`).addEventListener('change', () => ajustarDia(i));

  el('form-atendimento').addEventListener('submit', async (evento) => {
    evento.preventDefault();
    try {
      dadosAtendimento = await api('/api/configuracoes/atendimento', { metodo: 'PUT', corpo: {
        horarios: Array.from({ length: 7 }, (_, i) => ({
          aberto: el(`dia-${i}-aberto`).checked,
          ...Object.fromEntries(CAMPOS_DIA.map((campo) => [campo, el(`dia-${i}-${campo}`).value])),
        })),
        exibirHorarios: el('atendimento-exibirHorarios').checked,
        observacaoHorarios: el('atendimento-observacaoHorarios').value,
        retirada: { ativa: el('retirada-ativa').checked, instrucoes: el('retirada-instrucoes').value },
        entrega: { ativa: el('entrega-ativa').checked, taxa: el('entrega-taxa').value, instrucoes: el('entrega-instrucoes').value },
      } });
      await api('/api/configuracoes/operacao', { metodo: 'PUT', corpo: { fusoHorario: el('operacao-fusoHorario').value } });
      await carregarAtendimento();
      aviso('Horários e formas de receber salvos.');
    } catch (erro) { tratarErro(erro); }
  });

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
  // Tudo o que se altera aqui fica como rascunho: quem está no painel já vê o site com as alterações (prévia),
  // e os clientes só veem depois de Publicar.
  // Cor vazia significa "usar a cor padrão do sistema"; o seletor de cor do navegador sempre mostra alguma, por isso
  // o valor de verdade fica em `cores` e o seletor só reflete.
  const COR_PADRAO = { corPrincipal: '#b8436a', corSecundaria: '#f8dde2' };
  const IMAGENS_TEMA = {
    logo: { maximo: 600, png: true },
    favicon: { maximo: 192, png: true },
    banner: { maximo: 1600, png: false },
  };
  let aparencia = null;            // { publicado, rascunho } vindo do servidor
  let fontesCarregadas = false;
  const cores = { corPrincipal: '', corSecundaria: '' };
  const emEdicao = () => aparencia.rascunho || aparencia.publicado; // o que os campos mostram

  function mostrarCor(campo) {
    el(`tema-${campo}`).value = cores[campo] || COR_PADRAO[campo];
    el(`tema-${campo}-nota`).textContent = cores[campo] ? cores[campo] : 'cor padrão';
  }

  function mostrarImagem(qual) {
    const caminho = emEdicao()[qual];
    el(`previa-${qual}`).innerHTML = caminho ? `<img src="${esc(caminho)}" alt="">` : '<span class="suave fs-sm">Nenhuma imagem enviada.</span>';
    el(`remover-${qual}`).hidden = !caminho;
  }

  function mostrarAparencia() {
    const pendente = Boolean(aparencia.rascunho);
    el('tema-pendente').hidden = !pendente;
    el('tema-em-dia').hidden = pendente;
    el('tema-fonteTitulos').value = emEdicao().fonteTitulos;
    for (const campo of Object.keys(cores)) { cores[campo] = emEdicao()[campo]; mostrarCor(campo); }
    for (const qual of Object.keys(IMAGENS_TEMA)) mostrarImagem(qual);
  }

  async function carregarAparencia() {
    const resposta = await api('/api/tema');
    if (!fontesCarregadas) {
      el('tema-fonteTitulos').innerHTML = resposta.fontes.map((f) => `<option value="${esc(f.id)}">${esc(f.nome)}</option>`).join('');
      fontesCarregadas = true;
    }
    aparencia = { publicado: resposta.publicado, rascunho: resposta.rascunho };
    mostrarAparencia();
  }

  // As cores e a letra valem para a página inteira: recarregar mostra a prévia (ou o resultado) de uma vez.
  // `mudou` evita recarregar quando o servidor concluiu que nada mudou.
  async function enviarAparencia(pedido, { mensagem }) {
    if (!aparencia) return; // a aba ainda está carregando
    try {
      const antes = JSON.stringify(aparencia);
      aparencia = await pedido();
      if (JSON.stringify(aparencia) === antes) { mostrarAparencia(); return aviso('Nada mudou.'); }
      sessionStorage.setItem('aviso-aparencia', mensagem);
      location.reload();
    } catch (erro) { tratarErro(erro); }
  }
  // Depois de recarregar, conta o que aconteceu.
  const avisoPendente = sessionStorage.getItem('aviso-aparencia');
  if (avisoPendente) { sessionStorage.removeItem('aviso-aparencia'); aviso(avisoPendente); }

  for (const campo of Object.keys(cores)) {
    el(`tema-${campo}`).addEventListener('input', (evento) => { cores[campo] = evento.target.value; mostrarCor(campo); });
    el(`tema-${campo}-padrao`).addEventListener('click', () => { cores[campo] = ''; mostrarCor(campo); });
  }

  el('form-tema').addEventListener('submit', (evento) => {
    evento.preventDefault();
    enviarAparencia(() => api('/api/tema/rascunho', { metodo: 'PUT', corpo: { ...cores, fonteTitulos: el('tema-fonteTitulos').value } }),
      { mensagem: 'Prévia atualizada. Só você está vendo; publique quando estiver do seu gosto.' });
  });

  el('tema-publicar').addEventListener('click', () => {
    if (!confirm('Publicar a nova aparência? Todos os clientes passam a ver o site assim.')) return;
    enviarAparencia(() => api('/api/tema/publicar', { metodo: 'POST', corpo: {} }), { mensagem: 'Aparência publicada. Seus clientes já veem o site assim.' });
  });

  el('tema-descartar').addEventListener('click', () => {
    if (!confirm('Descartar as alterações? A aparência volta a ser a que está publicada.')) return;
    enviarAparencia(() => api('/api/tema/rascunho', { metodo: 'DELETE' }), { mensagem: 'Alterações descartadas.' });
  });

  for (const [qual, opcoes] of Object.entries(IMAGENS_TEMA)) {
    el(`arquivo-${qual}`).addEventListener('change', (evento) => {
      const arquivo = evento.target.files[0];
      if (!arquivo) return;
      enviarAparencia(async () => {
        const imagem = await App.reduzirImagem(arquivo, opcoes).catch(() => { throw new Error('Não consegui ler essa imagem. Tente outra.'); });
        return api(`/api/tema/rascunho/imagem/${qual}`, { metodo: 'PUT', corpo: { imagem } });
      }, { mensagem: 'Imagem adicionada à prévia. Só você está vendo; publique quando estiver do seu gosto.' });
      evento.target.value = '';
    });
    el(`remover-${qual}`).addEventListener('click', () => {
      enviarAparencia(() => api(`/api/tema/rascunho/imagem/${qual}`, { metodo: 'PUT', corpo: { imagem: '' } }),
        { mensagem: 'Imagem removida da prévia. Publique para valer para os clientes.' });
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
