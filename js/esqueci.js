'use strict';
// "Esqueci minha senha": pede o e-mail e dispara o link de redefinição.

App.pronto.then(({ loja }) => {
  document.title = `Esqueci minha senha · ${loja.nome}`;
  const conteudo = document.getElementById('conteudo');
  conteudo.style.maxWidth = '28rem';
  conteudo.innerHTML = `
    <h1 class="secao-titulo">Esqueci minha senha</h1>
    <form class="painel" id="form-esqueci">
      <p class="suave">Informe o e-mail da sua conta. Enviaremos um link para você criar uma nova senha.</p>
      <div class="mb-5"><label class="form-label" for="email">E-mail</label>
        <input class="form-control" id="email" type="email" maxlength="120" required autocomplete="email"></div>
      <button class="btn btn-solid theme-primary w-100" id="enviar">Enviar link</button>
    </form>
    <p class="mt-5 text-center"><a href="/login">Voltar para o login</a></p>`;

  document.getElementById('form-esqueci').addEventListener('submit', async (evento) => {
    evento.preventDefault();
    const botao = document.getElementById('enviar');
    botao.disabled = true;
    try {
      await App.api('/api/senha/esqueci', { metodo: 'POST', corpo: { email: document.getElementById('email').value } });
      // A mesma mensagem aparece exista a conta ou não: assim ninguém descobre quem é cliente.
      evento.target.innerHTML = `
        <h2 class="fs-lg mb-2">Confira seu e-mail</h2>
        <p class="mb-0">Se existir uma conta com esse endereço, o link para criar uma nova senha chega em instantes e vale por 30 minutos. Olhe também a caixa de spam.</p>`;
    } catch (erro) {
      botao.disabled = false;
      App.aviso(erro.message, { erro: true });
    }
  });
});
