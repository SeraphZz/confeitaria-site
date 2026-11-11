# Site da confeitaria

Site com cardápio de doces, página "Sobre", carrinho com reserva de pedidos e painel da confeiteira (pedidos + gráficos de receita). Frontend em Bootstrap, backend em Node puro — **sem dependências, não precisa de `npm install`**.

## Como rodar

Requer [Node.js](https://nodejs.org) 18 ou mais novo.

```
node server.js
```

Abra http://localhost:3000. Na primeira execução o terminal mostra o usuário (`confeiteira`) e uma **senha inicial aleatória** — entre em `/login` e troque em Painel > Configurações.

Variáveis opcionais: `PORT` (porta), `ADMIN_PASSWORD` (define a senha inicial em vez de sortear), `DATA_DIR` (pasta dos dados), `NODE_ENV=production` (cookie de sessão só por HTTPS).

**Perdeu a senha da confeiteira (acesso de admin)?** Pare o servidor e rode `node scripts/senha-admin.js` (sorteia e mostra uma senha nova) ou `node scripts/senha-admin.js "MinhaSenha123"` (define a que você quiser). Depois suba o servidor de novo.

Para ver o painel com dados de exemplo: pare o servidor, rode `node scripts/demo.js` e suba de novo. `node scripts/demo.js --limpar` remove os pedidos de exemplo.

## O que a confeiteira consegue fazer logada

- **Editar um doce na própria página dele** (botão "Editar este doce"): nome, preço, descrição, foto, disponibilidade.
- Criar, ocultar e excluir doces em Painel > Doces.
- Editar a página Sobre (história e trajetória) no próprio lugar.
- Ver os pedidos por pessoa em Painel > Clientes (total gasto, quantidade e histórico de cada cliente).
- Acompanhar pedidos e mudar o status (Novo → Confirmado → Em produção → Pronto → Entregue / Cancelado).
- Ver receita por dia, ticket médio e doces que mais renderam (7, 30 ou 90 dias).
- Trocar nome da loja, WhatsApp, Instagram, e-mail e senha em Configurações.

## Contas de clientes

O botão **Entrar** do cabeçalho leva a um login único: clientes entram com o e-mail; a confeiteira, com o usuário `confeiteira`. O cliente cria a própria conta em `/cadastro`, passa a ter os dados preenchidos no carrinho e vê o histórico em `/conta`. **Só clientes logados enviam pedidos**: quem não entrou monta o carrinho normalmente e é convidado a entrar ou criar conta na hora de enviar.

## CEP e telefone

Os campos de telefone têm máscara `(11) 99999-9999`. No endereço (cadastro, conta e entrega no carrinho), ao digitar o CEP o navegador consulta a API pública do [ViaCEP](https://viacep.com.br) e preenche rua, bairro, cidade e UF; se o CEP não existir ou a consulta falhar, a pessoa preenche à mão. A consulta sai do navegador do cliente direto para o ViaCEP (é o único endereço externo liberado na política de segurança do site).

## Esqueci minha senha (envio de e-mail por SMTP)

Em `/esqueci-senha` o cliente informa o e-mail e recebe um link (válido por 30 minutos, uso único) para criar uma nova senha. O envio usa SMTP, configurado por variáveis de ambiente:

| Variável | Para quê |
|---|---|
| `SMTP_HOST` | servidor do provedor, ex.: `smtp.gmail.com` |
| `SMTP_PORT` | `465` (padrão, TLS direto) ou `587` (STARTTLS) |
| `SMTP_USER` / `SMTP_PASS` | usuário e senha da conta de envio |
| `SMTP_FROM` | endereço do remetente (padrão: o `SMTP_USER`) |
| `SITE_URL` | endereço público do site, usado no link do e-mail, ex.: `https://www.minhaloja.com.br` |

Exemplo no PowerShell (Gmail exige uma ["senha de app"](https://myaccount.google.com/apppasswords), não a senha normal da conta):

```
$env:SMTP_HOST = "smtp.gmail.com"
$env:SMTP_USER = "loja@gmail.com"
$env:SMTP_PASS = "senha-de-app"
$env:SITE_URL  = "https://www.minhaloja.com.br"
node server.js
```

**Sem SMTP configurado**, rodando localmente, o link de redefinição é impresso no terminal do servidor em vez de enviado — serve para testar. Em produção (`NODE_ENV=production`) nada é impresso: configure o SMTP.

A senha da **confeiteira** não é recuperada por e-mail (a conta dela não tem e-mail): ela troca em Painel > Configurações.

## Estrutura

```
server.js        API + servidor de arquivos
email.js         envio de e-mail por SMTP (esqueci minha senha)
seed.js          conteúdo inicial (só usado na 1ª execução)
pages/           HTML de cada página
css/site.css     identidade visual (rosa #f8dde2) — o resto de css/ é o Bootstrap
js/app.js        código compartilhado (API, carrinho, cabeçalho/rodapé)
js/*.js          um arquivo por página
data/            criado ao rodar: db.json (dados) e uploads/ (fotos) — faça backup desta pasta
```

## Limites conhecidos (de propósito, para manter simples)

- Os dados ficam em um arquivo JSON: ótimo para uma confeitaria, não para milhares de pedidos por dia. Rode **uma única instância** do servidor.
- Sessões ficam em memória: reiniciar o servidor desloga a confeiteira.
- Não há pagamento online: o pedido é uma reserva, confirmada pelo WhatsApp.
- Ao publicar na internet, coloque atrás de HTTPS (ex.: proxy do provedor de hospedagem) e use `NODE_ENV=production`.
