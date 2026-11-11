'use strict';
// Página aberta pelo link do e-mail: o token vem depois do "#" no endereço.

App.pronto.then(({ loja }) => {
  document.title = `Nova senha · ${loja.nome}`;
  const token = location.hash.slice(1);
  history.replaceState(null, '', location.pathname); // tira o token da barra de endereço e do histórico

  const conteudo = document.getElementById('conteudo');
  conteudo.style.maxWidth = '28rem';
  if (!/^[0-9a-f]{64}$/.test(token)) {
    conteudo.innerHTML = `
      <h1 class="secao-titulo">Link inválido</h1>
      <p>Este link está incompleto ou já foi aberto. <a href="/esqueci-senha">Peça um novo link</a>.</p>`;
    return;
  }

  conteudo.innerHTML = `
    <h1 class="secao-titulo">Criar nova senha</h1>
    <form class="painel" id="form-redefinir">
      <div class="mb-4"><label class="form-label" for="senha">Nova senha (mínimo 8 caracteres)</label>
        <input class="form-control" id="senha" type="password" minlength="8" required autocomplete="new-password"></div>
      <div class="mb-5"><label class="form-label" for="confirma">Repita a nova senha</label>
        <input class="form-control" id="confirma" type="password" minlength="8" required autocomplete="new-password"></div>
      <button class="btn btn-solid theme-primary w-100">Salvar nova senha</button>
    </form>`;

  document.getElementById('form-redefinir').addEventListener('submit', async (evento) => {
    evento.preventDefault();
    const senha = document.getElementById('senha').value;
    if (senha !== document.getElementById('confirma').value) return App.aviso('As duas senhas não são iguais.', { erro: true });
    try {
      await App.api('/api/senha/redefinir', { metodo: 'POST', corpo: { token, senha } });
      conteudo.innerHTML = `
        <h1 class="secao-titulo">Senha alterada</h1>
        <p>Pronto! Agora é só entrar com a nova senha.</p>
        <a class="btn btn-solid theme-primary" href="/login">Entrar</a>`;
    } catch (erro) {
      App.aviso(erro.message, { erro: true });
    }
  });
});
