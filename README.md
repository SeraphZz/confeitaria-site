# Loja online com pedidos

Site de pedidos para pequenos negócios (confeitarias, restaurantes, lojas): catálogo de produtos, página "Sobre", carrinho com reserva de pedidos e painel da loja (pedidos + gráficos de receita). Cada estabelecimento tem a própria instalação e o próprio banco. A loja de exemplo criada na primeira execução é uma confeitaria. Frontend em Bootstrap, backend em Node puro — **sem dependências, não precisa de `npm install`**.

## Como rodar

Requer [Node.js](https://nodejs.org) 24 ou mais novo (o banco usa o SQLite que vem dentro do Node).

```
node server.js
```

Abra http://localhost:3000. Na primeira execução o terminal mostra o usuário (`confeiteira`) e uma **senha inicial aleatória** — entre em `/login` e troque em Painel > Configurações.

Variáveis opcionais: `PORT` (porta), `ADMIN_PASSWORD` (define a senha inicial em vez de sortear), `DATA_DIR` (pasta dos dados), `NODE_ENV=production` (cookie de sessão só por HTTPS).

**Perdeu a senha de acesso ao painel?** Rode `node scripts/senha-admin.js` (sorteia e mostra uma senha nova) ou `node scripts/senha-admin.js "MinhaSenha123"` (define a que você quiser). Funciona com o servidor ligado.

Para ver o painel com dados de exemplo: rode `node scripts/demo.js`. `node scripts/demo.js --limpar` remove os pedidos de exemplo.

## Banco de dados e backup

Os dados ficam em um banco SQLite, o arquivo `data/loja.db`. As fotos ficam em `data/uploads/`.

- **Backup:** `node scripts/backup.js` grava uma cópia em `data/backups/` (ou na pasta que você passar: `node scripts/backup.js D:copias`). Pode rodar com o site no ar. Copie também a pasta `data/uploads/` e guarde as cópias fora do servidor.
- **Restaurar:** pare o servidor, troque `data/loja.db` pela cópia e suba de novo.
- **Vinha da versão com `db.json`?** Não precisa fazer nada: na primeira execução o servidor copia tudo para o `loja.db` e renomeia o arquivo antigo para `db.json.migrado`, que fica guardado.

## O que a loja consegue fazer logada

- **Editar um produto na própria página dele** (botão "Editar"): nome, preço, descrição, foto, disponibilidade.
- Criar, ocultar e excluir produtos no Painel, na aba que leva o nome escolhido pela loja (Doces, Pratos, Produtos...).
- Editar a página Sobre (história e trajetória) no próprio lugar.
- Ver os pedidos por pessoa em Painel > Clientes (total gasto, quantidade e histórico de cada cliente).
- Acompanhar pedidos e mudar o status (Novo → Confirmado → Em produção → Pronto → Entregue / Cancelado).
- Ver receita por dia, ticket médio e produtos que mais renderam (7, 30 ou 90 dias).
- Trocar nome da loja, WhatsApp, Instagram, e-mail, senha e o nome dado aos produtos em Configurações.

## Contas de clientes

O botão **Entrar** do cabeçalho leva a um login único: clientes entram com o e-mail; a loja, com o usuário `confeiteira` (nome fixo por enquanto; as contas individuais de funcionários chegam em uma etapa futura). O cliente cria a própria conta em `/cadastro`, passa a ter os dados preenchidos no carrinho e vê o histórico em `/conta`. **Só clientes logados enviam pedidos**: quem não entrou monta o carrinho normalmente e é convidado a entrar ou criar conta na hora de enviar.

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

A senha do **painel da loja** não é recuperada por e-mail (essa conta não tem e-mail): troque em Painel > Configurações ou com `node scripts/senha-admin.js`.

## Estrutura

```
server.js        ponto de entrada: sobe o servidor e encaminha cada pedido para a rota certa
src/ambiente.js  tudo o que vem de variáveis de ambiente (porta, endereço do site, proxy)
src/rotas/       rotas da API por assunto: contas.js, catalogo.js, pedidos.js, loja.js
src/configuracoes.js  configurações da loja: padrões, validação e o que é público (ver abaixo)
src/*.js         sessão, senhas, validação, datas, regras de pedidos, imagens e arquivos estáticos
banco.js         camada de dados (SQLite): todas as consultas
migracoes/       estrutura das tabelas, em arquivos numerados (ver abaixo)
email.js         envio de e-mail por SMTP (esqueci minha senha)
seed.js          conteúdo inicial (só usado na 1ª execução)
pages/           HTML de cada página
css/site.css     identidade visual (rosa #f8dde2) — o resto de css/ é o Bootstrap
js/app.js        código compartilhado (API, carrinho, cabeçalho/rodapé)
js/*.js          um arquivo por página
scripts/         senha-admin.js, backup.js e demo.js
testes/          testes automáticos (npm test)
data/            criado ao rodar: loja.db (banco) e uploads/ (fotos) — faça backup desta pasta
```

## Configurações da loja

Tudo o que é próprio de um estabelecimento fica no banco (tabela `config`) e passa por um módulo só, `src/configuracoes.js`. Cada seção declara os valores padrão, a validação e quem pode ver:

| Seção | Conteúdo | Quem recebe |
|---|---|---|
| `loja` | nome, slogan, WhatsApp, Instagram, e-mail, cidade | qualquer visitante |
| `sobre` | texto, trajetória e foto da página Sobre | qualquer visitante |
| `catalogo` | como a loja chama o que vende (ex.: Doce / Doces, Prato / Pratos) e o ícone de itens sem foto | qualquer visitante |
| `operacao` | fuso horário da loja | só o painel |
| `admin` | conta de acesso ao painel | ninguém (nunca sai do servidor) |

O painel lê as seções editáveis em `GET /api/configuracoes` e grava uma seção em `PUT /api/configuracoes/<seção>`. Para criar uma configuração nova, acrescente o campo em `padrao` e em `validar` na seção certa; instalações antigas recebem o valor padrão sem precisar de migração.

**Fuso horário.** A data mínima dos pedidos ("de hoje em diante") e os dias do resumo seguem o fuso da loja, não o do servidor. O padrão é `America/Sao_Paulo`. Para uma loja em outro fuso (ex.: `America/Manaus`), grave `{"fusoHorario": "America/Manaus"}` em `/api/configuracoes/operacao`; o campo entra na tela de Configurações em uma etapa futura.

O que muda de um **servidor** para outro (porta, endereço público, proxy, SMTP) continua em variáveis de ambiente, lidas em `src/ambiente.js` e `email.js`.

## Endereços antigos

Até a versão anterior os produtos se chamavam "doces". Links já compartilhados no formato `/doce/nome-do-produto` continuam funcionando: o servidor redireciona para `/produto/nome-do-produto`. A API mudou de `/api/doces` para `/api/produtos`.

## Testes

```
npm test
```

Roda os testes de integração (não precisa instalar nada): cada arquivo de `testes/` sobe um servidor de verdade com um banco vazio em uma pasta temporária, então os dados de `data/` nunca são tocados. Rode antes e depois de qualquer alteração no código.

## Atualizações do banco (migrações)

A estrutura das tabelas fica em `migracoes/`, um arquivo numerado por mudança (`001-...`, `002-...`). O banco guarda o número da última aplicada; ao subir, o servidor aplica sozinho as que faltam.

- Antes de alterar um banco que já tem dados, o servidor grava uma cópia em `data/backups/antes-da-migracao-...db`.
- Cada migração vale por inteiro ou não vale: se falhar, é desfeita, o banco fica como estava e o servidor não sobe (a mensagem diz qual migração falhou).
- Se o banco for mais novo que o programa (alguém voltou o código para uma versão antiga), o servidor se recusa a subir em vez de arriscar os dados.
- Para criar uma migração, adicione um arquivo com o próximo número, no formato de `migracoes/001-esquema-inicial.js`. Nunca edite uma migração já publicada.

## Limites conhecidos (de propósito, para manter simples)

- O banco é SQLite, um arquivo no disco do servidor: a hospedagem precisa ter disco persistente. Rode **uma única instância** do servidor.
- Sessões ficam em memória: reiniciar o servidor desloga todo mundo.
- Não há pagamento online: o pedido é uma reserva, confirmada pelo WhatsApp.
- Ao publicar na internet, coloque atrás de HTTPS (ex.: proxy do provedor de hospedagem) e use `NODE_ENV=production` e `TRUST_PROXY=1`. O `TRUST_PROXY=1` faz o limite de tentativas de login contar pelo IP de cada visitante, e não pelo IP do proxy; não ligue se o servidor ficar exposto direto, sem proxy.
