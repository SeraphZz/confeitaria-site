'use strict';
// Cadastro feito pelo próprio cliente.

App.pronto.then(({ loja, admin, cliente }) => {
  const voltar = new URLSearchParams(location.search).get('voltar') === 'carrinho' ? '/carrinho' : '/';
  if (admin) return location.replace('/admin');
  if (cliente) return location.replace('/conta');
  document.title = `Criar conta · ${loja.nome}`;

  const conteudo = document.getElementById('conteudo');
  conteudo.style.maxWidth = '30rem';
  conteudo.innerHTML = `
    <h1 class="secao-titulo">Criar conta</h1>
    <p class="suave">Com a conta, seus dados já vêm preenchidos a cada pedido e você acompanha o que já encomendou.</p>
    <form class="painel" id="form-cadastro">
      <div class="mb-4"><label class="form-label" for="nome">Nome</label>
        <input class="form-control" id="nome" maxlength="80" required autocomplete="name"></div>
      <div class="mb-4"><label class="form-label" for="email">E-mail</label>
        <input class="form-control" id="email" type="email" maxlength="120" required autocomplete="email"></div>
      <div class="mb-4"><label class="form-label" for="telefone">WhatsApp com DDD</label>
        <input class="form-control" id="telefone" type="tel" data-mascara="telefone" inputmode="numeric" required autocomplete="tel" placeholder="(11) 99999-9999"></div>
      <fieldset class="mb-4">
        <legend class="form-label">Endereço para entregas (opcional)</legend>
        <p class="suave fs-sm mb-3">Digite o CEP e o endereço é preenchido sozinho.</p>
        ${App.enderecoHtml()}
      </fieldset>
      <div class="mb-5"><label class="form-label" for="senha">Senha (mínimo 8 caracteres)</label>
        <input class="form-control" id="senha" type="password" minlength="8" required autocomplete="new-password"></div>
      <button class="btn btn-solid theme-primary w-100">Criar conta</button>
    </form>
    <p class="mt-5 text-center">Já tem conta? <a href="/login${voltar === '/carrinho' ? '?voltar=carrinho' : ''}">Entrar</a></p>`;

  App.ligarMascaras(conteudo);
  const campo = (id) => document.getElementById(id).value;
  document.getElementById('form-cadastro').addEventListener('submit', async (evento) => {
    evento.preventDefault();
    try {
      await App.api('/api/cadastro', { metodo: 'POST', corpo: {
        nome: campo('nome'), email: campo('email'), telefone: campo('telefone'), endereco: App.lerEndereco(conteudo), senha: campo('senha'),
      } });
      location.href = voltar;
    } catch (erro) {
      App.aviso(erro.message, { erro: true });
    }
  });
});
