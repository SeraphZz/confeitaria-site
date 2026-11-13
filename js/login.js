'use strict';
// Login único: clientes entram com e-mail; a loja, com o usuário dela.

App.pronto.then(({ admin, cliente }) => {
  // ?voltar=carrinho traz o cliente de volta ao carrinho depois de entrar.
  const voltar = new URLSearchParams(location.search).get('voltar') === 'carrinho' ? '/carrinho' : '/';
  if (admin) return location.replace('/admin');
  if (cliente) return location.replace(voltar);
  if (voltar === '/carrinho') document.getElementById('elo-cadastro').href = '/cadastro?voltar=carrinho';

  const erro = document.getElementById('erro');
  document.getElementById('form-login').addEventListener('submit', async (evento) => {
    evento.preventDefault();
    erro.hidden = true;
    try {
      const { tipo } = await App.api('/api/login', { metodo: 'POST', corpo: {
        usuario: document.getElementById('usuario').value, senha: document.getElementById('senha').value,
      } });
      location.href = tipo === 'admin' ? '/admin' : voltar;
    } catch (e) {
      erro.textContent = e.message;
      erro.hidden = false;
    }
  });
});
