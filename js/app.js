'use strict';
// Código compartilhado por todas as páginas: chamadas à API, carrinho, cabeçalho e rodapé.

const App = (() => {
  // Todo texto vindo do banco (nomes, descrições, dados de clientes) passa por aqui antes de virar HTML.
  function esc(valor) {
    return String(valor ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  }

  const formatoBrl = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' });
  const brl = (centavos) => formatoBrl.format(centavos / 100);

  // "12,50" -> 1250. Retorna null se não for um preço válido.
  function lerPreco(textoPreco) {
    const n = Number(String(textoPreco).trim().replace(/\./g, '').replace(',', '.'));
    return Number.isFinite(n) && n >= 0 ? Math.round(n * 100) : null;
  }

  function dataBr(iso) {
    const [a, m, d] = iso.slice(0, 10).split('-');
    return `${d}/${m}/${a}`;
  }

  async function api(caminho, { metodo = 'GET', corpo } = {}) {
    const resposta = await fetch(caminho, {
      method: metodo,
      headers: corpo ? { 'Content-Type': 'application/json' } : undefined,
      body: corpo ? JSON.stringify(corpo) : undefined,
    });
    const dados = await resposta.json().catch(() => ({}));
    if (!resposta.ok) {
      const erro = new Error(dados.erro || 'Algo deu errado. Tente novamente.');
      erro.status = resposta.status;
      throw erro;
    }
    return dados;
  }

  let avisoTimer;
  function aviso(mensagem, { erro = false, html = '' } = {}) {
    document.querySelector('.aviso')?.remove();
    const el = document.createElement('div');
    el.className = 'aviso' + (erro ? ' erro' : '');
    el.setAttribute('role', 'status');
    el.textContent = mensagem;
    if (html) el.insertAdjacentHTML('beforeend', html);
    document.body.append(el);
    clearTimeout(avisoTimer);
    avisoTimer = setTimeout(() => el.remove(), 4500);
  }

  // ---- carrinho (fica no navegador do cliente até o pedido ser enviado)
  const carrinho = {
    itens() {
      try {
        const itens = JSON.parse(localStorage.getItem('carrinho') || '[]');
        if (!Array.isArray(itens)) return [];
        // Carrinhos guardados antes de "doce" virar "produto" usam o campo antigo `doceId`.
        // Todo item sai daqui com `variacaoId` ('' = nenhuma) e `adicionaisIds` (lista), mesmo os guardados antes
        // de esses recursos existirem.
        return itens.map(({ doceId, ...item }) => ({
          ...item, produtoId: item.produtoId || doceId,
          variacaoId: typeof item.variacaoId === 'string' ? item.variacaoId : '',
          adicionaisIds: Array.isArray(item.adicionaisIds) ? item.adicionaisIds : [],
        }));
      } catch { return []; }
    },
    salvar(itens) {
      localStorage.setItem('carrinho', JSON.stringify(itens));
      atualizarContador();
    },
    // `variacaoId` e `adicionaisIds`: o que o cliente escolheu na página do produto (ver escolhasDoItem).
    adicionar(produtoId, quantidade, observacoes, { variacaoId = '', adicionaisIds = [] } = {}) {
      const itens = this.itens();
      // Mesmo produto com as mesmas escolhas e o mesmo recado soma na linha que já existe.
      const chave = (i) => JSON.stringify([i.produtoId, i.variacaoId, [...i.adicionaisIds].sort(), i.observacoes]);
      const novo = { produtoId, quantidade, observacoes, variacaoId, adicionaisIds };
      const igual = itens.find((i) => chave(i) === chave(novo));
      if (igual) igual.quantidade = Math.min(999, igual.quantidade + quantidade);
      else itens.push(novo);
      this.salvar(itens);
    },
    quantidadeTotal() { return this.itens().reduce((s, i) => s + i.quantidade, 0); },
  };

  // ---- variações e adicionais (recursos opcionais: as listas vêm vazias quando a loja não usa)

  // Confere as escolhas de um item do carrinho com o produto como ele está agora. Devolve a variação, os adicionais
  // e o preço de uma unidade — ou null, se alguma escolha deixou de existir (o servidor faz a mesma conferência).
  function escolhasDoItem(produto, item) {
    const variacao = produto.variacoes.find((v) => v.id === item.variacaoId) || null;
    if (produto.variacoes.length ? !variacao : item.variacaoId) return null;
    const adicionais = produto.adicionais.filter((a) => item.adicionaisIds.includes(a.id));
    if (adicionais.length !== new Set(item.adicionaisIds).size) return null;
    return { variacao, adicionais, precoUnit: (variacao ? variacao.preco : produto.preco) + adicionais.reduce((s, a) => s + a.preco, 0) };
  }

  // Texto (ainda sem escapar) das escolhas de um item: " (Grande) + Calda, Granulado". Serve para o carrinho e para
  // pedidos já feitos: `variacao` pode ser o nome ou o objeto; `adicionais`, objetos com `nome`.
  function opcoesTexto(variacao, adicionais = []) {
    const nome = variacao && typeof variacao === 'object' ? variacao.nome : variacao;
    return (nome ? ` (${nome})` : '') + (adicionais.length ? ` + ${adicionais.map((a) => a.nome).join(', ')}` : '');
  }

  // Preço na vitrine. Produto com variações de preços diferentes mostra "a partir de".
  function precoVitrine(produto) {
    if (!produto.variacoes.length) return brl(produto.preco);
    const precos = produto.variacoes.map((v) => v.preco);
    const menor = Math.min(...precos);
    return (menor === Math.max(...precos) ? '' : 'a partir de ') + brl(menor);
  }

  function atualizarContador() {
    const el = document.getElementById('contador-carrinho');
    if (!el) return;
    const n = carrinho.quantidadeTotal();
    el.textContent = n;
    el.hidden = n === 0;
  }

  // `ampliar: true` transforma a foto em um botão que abre a imagem inteira (ver visor, abaixo).
  function fotoHtml(produto, classe = '', { ampliar = false } = {}) {
    const img = `<img src="${esc(produto.imagem)}" alt="${esc(produto.nome)}" loading="lazy">`;
    const dentro = !produto.imagem ? `<span aria-hidden="true">${esc(produto.emoji)}</span>`
      : ampliar ? `<button type="button" class="ampliar" data-ampliar aria-label="Ver a foto inteira de ${esc(produto.nome)}">${img}</button>` : img;
    return `<div class="foto ${classe}">${dentro}</div>`;
  }

  // ---- visor: clique em qualquer [data-ampliar] abre a foto inteira, sem o corte da miniatura
  let visor;
  document.addEventListener('click', (evento) => {
    const img = evento.target.closest?.('[data-ampliar]')?.querySelector('img');
    if (!img) return;
    if (!visor) {
      visor = document.createElement('dialog');
      visor.className = 'visor';
      visor.innerHTML = '<img alt=""><button type="button" aria-label="Fechar">×</button>';
      visor.addEventListener('click', () => visor.close()); // clique em qualquer lugar (ou Esc) fecha
      document.body.append(visor);
    }
    const grande = visor.querySelector('img');
    grande.src = img.src;
    grande.alt = img.alt;
    visor.showModal();
  });

  // Reduz a foto no navegador (máx. 1200px, JPEG) para o envio ser rápido mesmo pelo celular.
  // `png: true` mantém o fundo transparente (logotipo, ícone); `maximo` é o maior lado, em pixels.
  async function reduzirImagem(arquivo, { maximo = 1200, png = false } = {}) {
    const bitmap = await createImageBitmap(arquivo);
    const escala = Math.min(1, maximo / Math.max(bitmap.width, bitmap.height));
    const canvas = document.createElement('canvas');
    canvas.width = Math.round(bitmap.width * escala);
    canvas.height = Math.round(bitmap.height * escala);
    canvas.getContext('2d').drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    return png ? canvas.toDataURL('image/png') : canvas.toDataURL('image/jpeg', 0.85);
  }

  function montarCabecalho({ loja, admin, usuario, cliente, catalogo, tema, previaTema }) {
    // Com logotipo enviado, ele aparece ao lado do nome; sem, fica o ícone padrão do catálogo.
    const simbolo = tema.logo
      ? `<img class="marca-logo" src="${esc(tema.logo)}" alt="">`
      : `<span class="marca-icone" aria-hidden="true">${esc(catalogo.emojiPadrao)} </span>`;
    const aqui = location.pathname;
    const elo = (href, rotulo, extra = '') =>
      `<a class="elo${aqui === href ? ' ativo' : ''}" href="${href}">${rotulo}${extra}</a>`;
    const faixa = admin ? `
      <div class="faixa-admin"><div class="container d-flex justify-content-between gap-4">
        <span>${previaTema
          ? 'Prévia da nova aparência: só você está vendo. <a href="/admin#aparencia">Publicar ou descartar</a>'
          : `Você entrou como ${esc(usuario.nome)}.`}</span>
        <span><a href="/admin">Painel</a> · <button type="button" id="sair">Sair</button></span>
      </div></div>` : '';
    document.getElementById('cabecalho').innerHTML = `${faixa}
      <header class="topo"><div class="container topo-linha">
        <a class="marca" href="/">${simbolo}${esc(loja.nome)}</a>
        <nav class="d-flex align-items-center" aria-label="Principal">
          ${elo('/', esc(catalogo.nomePlural))}${elo('/sobre', 'Sobre')}
          ${elo('/carrinho', 'Carrinho', '<span class="contador" id="contador-carrinho" hidden>0</span>')}
          ${admin ? '<a class="btn btn-solid theme-primary btn-sm botao-entrar" href="/admin">Painel</a>' : cliente
            ? elo('/conta', `Olá, ${esc(cliente.nome.split(' ')[0])}`)
            : '<a class="btn btn-solid theme-primary btn-sm botao-entrar" href="/login">Entrar</a>'}
        </nav>
      </div></header>`;
    document.getElementById('sair')?.addEventListener('click', sair);
    atualizarContador();
  }

  async function sair() {
    await api('/api/logout', { metodo: 'POST', corpo: {} });
    location.href = '/';
  }

  // "09:00" -> "9h"; "18:30" -> "18h30".
  function horaCurta(hora) {
    const [h, m] = hora.split(':');
    return `${Number(h)}h${m === '00' ? '' : m}`;
  }

  // Junta dias seguidos com o mesmo horário: ["Seg a Sex: 9h às 18h", "Sáb: 9h às 13h", "Dom: fechado"].
  function resumirHorarios(horarios) {
    const NOMES = ['Dom', 'Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb'];
    const descrever = (d) => (!d.aberto ? 'fechado'
      : `${horaCurta(d.abre)} às ${horaCurta(d.fecha)}${d.abre2 ? ` e ${horaCurta(d.abre2)} às ${horaCurta(d.fecha2)}` : ''}`);
    const grupos = [];
    for (const dia of [1, 2, 3, 4, 5, 6, 0]) { // a semana começa na segunda
      const texto = descrever(horarios[dia]);
      const ultimo = grupos.at(-1);
      if (ultimo && ultimo.texto === texto) { ultimo.fim = dia; ultimo.dias++; } else grupos.push({ inicio: dia, fim: dia, dias: 1, texto });
    }
    // Dois dias: "Ter e Qua"; três ou mais: "Seg a Sex".
    const periodo = (g) => (g.dias === 1 ? NOMES[g.inicio] : `${NOMES[g.inicio]} ${g.dias === 2 ? 'e' : 'a'} ${NOMES[g.fim]}`);
    return grupos.map((g) => `${periodo(g)}: ${g.texto}`);
  }

  function montarRodape({ loja, atendimento }) {
    const contatos = [
      loja.whatsapp && `<a href="${linkWhats(loja.whatsapp)}" target="_blank" rel="noopener">WhatsApp ${formatarTelefone(loja.whatsapp)}</a>`,
      loja.instagram && `<a href="https://instagram.com/${esc(loja.instagram)}" target="_blank" rel="noopener">@${esc(loja.instagram)}</a>`,
      loja.email && `<a href="mailto:${esc(loja.email)}">${esc(loja.email)}</a>`,
    ].filter(Boolean).join('');
    document.getElementById('rodape').innerHTML = `
      <footer class="rodape"><div class="container">
        <div class="marca mb-3">${esc(loja.nome)}</div>
        <div class="contatos mb-3">${contatos}</div>
        <div class="suave fs-sm">${esc([loja.endereco, loja.cidade].filter(Boolean).join(' · '))}</div>
        ${atendimento.exibirHorarios ? `
        <div class="suave fs-sm mt-3"><strong>Horários:</strong> ${resumirHorarios(atendimento.horarios).map(esc).join(' · ')}${
          atendimento.observacaoHorarios ? `<br>${esc(atendimento.observacaoHorarios)}` : ''}</div>` : ''}
      </div></footer>`;
  }

  // Cada página espera por isto antes de desenhar: traz dados da loja e quem está logado.
  const pronto = api('/api/site').then((site) => {
    // site.pode('produtos.editar'): se quem está logado é da equipe e tem a permissão. Serve para as telas mostrarem
    // só o que a pessoa consegue usar; quem decide de verdade é o servidor, em cada rota.
    site.pode = (permissao) => Boolean(site.usuario?.permissoes.includes(permissao));
    for (const s of site.statusPedidos) STATUS[s.id] = s.nome;
    montarCabecalho(site);
    montarRodape(site);
    return site;
  });
  pronto.catch(() => aviso('Não foi possível carregar o site. Recarregue a página.', { erro: true }));

  // ---- máscaras (telefone e CEP) e consulta de CEP no ViaCEP

  // "11987654321" -> "(11) 98765-4321". Aceita número salvo com 55 na frente.
  function formatarTelefone(valor) {
    let d = String(valor ?? '').replace(/\D/g, '');
    if (d.length > 11 && d.startsWith('55')) d = d.slice(2);
    d = d.slice(0, 11);
    if (d.length <= 2) return d.length ? `(${d}` : '';
    const meio = d.length > 10 ? 7 : 6; // celular tem 9 dígitos; fixo, 8
    return `(${d.slice(0, 2)}) ${d.slice(2, meio)}${d.length > meio ? `-${d.slice(meio)}` : ''}`;
  }

  function formatarCep(valor) {
    const d = String(valor ?? '').replace(/\D/g, '').slice(0, 8);
    return d.length > 5 ? `${d.slice(0, 5)}-${d.slice(5)}` : d;
  }

  const MASCARAS = { telefone: formatarTelefone, cep: formatarCep };

  // Link do WhatsApp: o código do país (55) entra aqui, não no campo que a pessoa digita.
  function linkWhats(numero, mensagem = '') {
    const d = String(numero ?? '').replace(/\D/g, '');
    return `https://wa.me/${d.length <= 11 ? '55' + d : d}${mensagem ? `?text=${encodeURIComponent(mensagem)}` : ''}`;
  }

  // Campos de endereço usados no cadastro, na conta e no carrinho. `obrigatorio` marca os campos exigidos na entrega.
  function enderecoHtml(endereco = {}, { obrigatorio = false } = {}) {
    const e = { ...endereco, cep: formatarCep(endereco.cep) };
    const req = obrigatorio ? 'required' : '';
    const campo = (nome, rotulo, classe, extra = '') => `
      <div class="${classe}"><label class="form-label" for="end-${nome}">${rotulo}</label>
        <input class="form-control" id="end-${nome}" data-endereco="${nome}" value="${esc(e[nome] || '')}" ${extra}></div>`;
    return `
      <div class="row g-4" data-grupo-endereco>
        ${campo('cep', 'CEP', 'col-6', `data-mascara="cep" inputmode="numeric" autocomplete="postal-code" placeholder="00000-000" ${req}`)}
        <div class="col-6 d-flex align-items-end"><span class="suave fs-sm" data-cep-status role="status"></span></div>
        ${campo('rua', 'Rua', 'col-12', `maxlength="120" autocomplete="address-line1" ${req}`)}
        ${campo('numero', 'Número', 'col-4', `maxlength="10" ${req}`)}
        ${campo('complemento', 'Complemento', 'col-8', 'maxlength="60" placeholder="Apto, bloco… (opcional)"')}
        ${campo('bairro', 'Bairro', 'col-12', 'maxlength="80"')}
        ${campo('cidade', 'Cidade', 'col-8', `maxlength="80" autocomplete="address-level2" ${req}`)}
        ${campo('uf', 'UF', 'col-4', `maxlength="2" autocomplete="address-level1" style="text-transform: uppercase" ${req}`)}
      </div>`;
  }

  function lerEndereco(container = document) {
    const e = {};
    container.querySelectorAll('[data-endereco]').forEach((el) => { e[el.dataset.endereco] = el.value.trim(); });
    return e;
  }

  async function consultarCep(campoCep) {
    const grupo = campoCep.closest('[data-grupo-endereco]');
    const status = grupo.querySelector('[data-cep-status]');
    const cep = campoCep.value.replace(/\D/g, '');
    status.textContent = 'Buscando endereço…';
    try {
      const resposta = await fetch(`https://viacep.com.br/ws/${cep}/json/`);
      const dados = await resposta.json();
      if (campoCep.value.replace(/\D/g, '') !== cep) return; // a pessoa já digitou outro CEP
      if (!resposta.ok || dados.erro) {
        status.textContent = 'CEP não encontrado. Confira ou preencha o endereço.';
        return;
      }
      // .value sempre trata o conteúdo como texto, então a resposta do ViaCEP não vira HTML.
      const preencher = { rua: dados.logradouro, bairro: dados.bairro, cidade: dados.localidade, uf: dados.uf };
      for (const [nome, valor] of Object.entries(preencher)) {
        if (valor) grupo.querySelector(`[data-endereco=${nome}]`).value = String(valor).slice(0, 120);
      }
      status.textContent = 'Endereço preenchido.';
      // CEP geral de cidade pequena não traz a rua: nesse caso o foco vai para ela.
      grupo.querySelector(`[data-endereco=${dados.logradouro ? 'numero' : 'rua'}]`).focus();
    } catch {
      status.textContent = 'Não foi possível consultar o CEP. Preencha o endereço.';
    }
  }

  // Liga máscaras e consulta de CEP para tudo que existir (ou vier a existir) dentro do container.
  function ligarMascaras(container) {
    const aplicar = (el) => { el.value = MASCARAS[el.dataset.mascara](el.value); };
    container.addEventListener('input', (evento) => {
      const el = evento.target;
      if (!el.dataset?.mascara) return;
      // Editando no meio do texto, só formata ao sair do campo: assim o cursor não pula para o fim.
      if (el.selectionStart === el.value.length) aplicar(el);
      if (el.dataset.mascara === 'cep' && el.value.replace(/\D/g, '').length === 8) { aplicar(el); consultarCep(el); }
    });
    container.addEventListener('focusout', (evento) => {
      if (evento.target.dataset?.mascara) aplicar(evento.target);
    });
  }

  // "Doces" -> "doces", para usar o nome que a loja escolheu no meio de uma frase ("Ver doces").
  const minusculas = (textoQualquer) => String(textoQualquer ?? '').toLocaleLowerCase('pt-BR');

  // Nome de cada status de pedido, pelo id. Os status são da loja (Painel > Configurações) e chegam com /api/site:
  // este objeto é preenchido antes de `pronto` avisar as páginas. A lista completa fica em `site.statusPedidos`.
  const STATUS = {};

  return {
    esc, brl, lerPreco, dataBr, api, aviso, carrinho, escolhasDoItem, opcoesTexto, precoVitrine, fotoHtml, reduzirImagem, sair, STATUS, pronto, minusculas, resumirHorarios,
    formatarTelefone, linkWhats, enderecoHtml, lerEndereco, ligarMascaras,
  };
})();
