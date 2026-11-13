# Loja online com pedidos

Site de pedidos para pequenos negócios (confeitarias, restaurantes, lojas): catálogo de produtos, página "Sobre", carrinho com reserva de pedidos e painel da loja (pedidos + gráficos de receita). Cada estabelecimento tem a própria instalação e o próprio banco. A loja de exemplo criada na primeira execução é uma confeitaria. Frontend em Bootstrap, backend em Node puro — **sem dependências, não precisa de `npm install`**.

## Como rodar

Requer [Node.js](https://nodejs.org) 24 ou mais novo (o banco usa o SQLite que vem dentro do Node).

```
node server.js
```

Abra http://localhost:3000. Na primeira execução o terminal mostra o usuário (`confeiteira`) e uma **senha inicial aleatória** — entre em `/login` e troque em Painel > Configurações. Essa primeira conta tem o perfil Administrador; as demais pessoas da equipe são criadas por ela em Painel > Equipe.

Variáveis opcionais: `PORT` (porta), `ADMIN_PASSWORD` (define a senha inicial em vez de sortear), `DATA_DIR` (pasta dos dados), `NODE_ENV=production` (cookie de sessão só por HTTPS e cabeçalho HSTS), `BACKUP_MANTER` (quantas cópias de segurança guardar).

**Perdeu a senha de acesso ao painel?** Rode `node scripts/senha-admin.js` (sorteia e mostra uma senha nova para o Administrador) ou `node scripts/senha-admin.js "MinhaSenha123"` (define a que você quiser). Para outra pessoa da equipe: `node scripts/senha-admin.js --usuario maria`. O script reativa a conta, desloga quem estava nela e deixa a troca anotada no registro de atividades. Funciona com o servidor ligado.

Para ver o painel com dados de exemplo: rode `node scripts/demo.js`. `node scripts/demo.js --limpar` remove os pedidos de exemplo.

## Banco de dados e backup

Os dados ficam em um banco SQLite, o arquivo `data/loja.db`. As fotos ficam em `data/uploads/`.

- **Backup:** `node scripts/backup.js` grava uma cópia completa em `data/backups/loja-AAAA-MM-DD-HHMMSS/`: o banco (`loja.db`) e as fotos (`uploads/`). Pode rodar com o site no ar. Para gravar em outro lugar, passe a pasta: `node scripts/backup.js D:\copias`. Guarde cópias fora do servidor.
- **Rotação:** o script guarda as 14 cópias mais recentes e apaga as mais antigas. Para mudar: `node scripts/backup.js --manter 30` (ou a variável `BACKUP_MANTER`); `--manter 0` nunca apaga. Só são apagadas as cópias criadas pelo próprio script; as cópias `antes-da-migracao-...` que o servidor faz ao atualizar o banco ficam onde estão.
- **Restaurar:** pare o servidor, copie o `loja.db` e a pasta `uploads/` da cópia para dentro de `data/` e suba de novo.
- **Vinha da versão com `db.json`?** Não precisa fazer nada: na primeira execução o servidor copia tudo para o `loja.db` e renomeia o arquivo antigo para `db.json.migrado`, que fica guardado.

## O que a loja consegue fazer logada

- **Editar um produto na própria página dele** (botão "Editar"): nome, preço, descrição, foto, categoria, disponibilidade.
- Criar, ocultar e excluir produtos no Painel, na aba que leva o nome escolhido pela loja (Doces, Pratos, Produtos...).
- Organizar os produtos em categorias (Bolos, Bebidas...), na mesma aba: criar, renomear, ordenar e excluir. Com categorias, a página inicial separa os produtos em grupos, na ordem escolhida, com botões para filtrar; sem nenhuma, fica uma lista só. Excluir uma categoria não apaga os produtos dela.
- Ligar recursos opcionais em Configurações: **variações** (o mesmo produto em opções com preço próprio), **adicionais** (extras somados ao preço) e **estoque** (ver abaixo).
- Editar a página Sobre (história e trajetória) no próprio lugar.
- Ver os pedidos por pessoa em Painel > Clientes (total gasto, quantidade e histórico de cada cliente).
- Acompanhar pedidos e mudar o status (Novo → Confirmado → Em produção → Pronto → Entregue / Cancelado).
- Ver receita por dia, ticket médio e produtos que mais renderam (7, 30 ou 90 dias).
- Trocar nome da loja, contatos, endereço, horários, formas de entrega, senha e o nome dado aos produtos em Configurações.
- Dar acesso ao painel a outras pessoas, cada uma com o próprio usuário e só com as permissões do perfil dela (Equipe), e ver quem fez o quê (Atividade).
- Mudar cores, letra dos títulos, logotipo e banner em Aparência, vendo como fica antes de publicar.

## Contas de clientes

O botão **Entrar** do cabeçalho leva a um login único: clientes entram com o e-mail; cada pessoa da equipe da loja, com o próprio usuário (ver "Equipe, perfis e permissões"). O cliente cria a própria conta em `/cadastro`, passa a ter os dados preenchidos no carrinho e vê o histórico em `/conta`. **Só clientes logados enviam pedidos**: quem não entrou monta o carrinho normalmente e é convidado a entrar ou criar conta na hora de enviar.

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

A senha de quem é da **equipe da loja** não é recuperada por e-mail (essas contas não têm e-mail): cada um troca a própria em Painel > Configurações, quem gerencia a equipe define uma nova em Painel > Equipe, e em último caso há o `node scripts/senha-admin.js`.

## Estrutura

```
server.js        ponto de entrada: sobe o servidor e encaminha cada pedido para a rota certa
src/ambiente.js  tudo o que vem de variáveis de ambiente (porta, endereço do site, proxy)
src/rotas/       rotas da API por assunto: contas.js, catalogo.js, pedidos.js, loja.js
src/configuracoes.js  configurações da loja: padrões, validação e o que é público (ver abaixo)
src/tema.js      transforma as escolhas de aparência no CSS servido em /tema.css
src/aparencia.js rascunho, publicação e descarte do tema
src/atendimento.js  horários de funcionamento e formas de receber o pedido
src/catalogo.js  recursos opcionais do catálogo: variações, adicionais e estoque
src/permissoes.js  lista de permissões da equipe e como se calcula o que cada pessoa pode fazer
src/equipe.js    regras para criar e alterar pessoas e perfis
src/auditoria.js registro de atividades da equipe
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
| `loja` | nome, slogan, WhatsApp, Instagram, e-mail, endereço, cidade | qualquer visitante |
| `sobre` | texto, trajetória e foto da página Sobre | qualquer visitante |
| `catalogo` | como a loja chama o que vende (ex.: Doce / Doces, Prato / Pratos) e o ícone de itens sem foto | qualquer visitante |
| `tema` | cores, letra dos títulos, logotipo, ícone da aba e banner (versão publicada) | qualquer visitante |
| `temaRascunho` | alterações de aparência ainda não publicadas | só o painel |
| `atendimento` | horários de funcionamento e formas de receber o pedido (retirada, entrega) | qualquer visitante |
| `modulos` | recursos opcionais ligados: variações, adicionais, estoque | qualquer visitante |
| `operacao` | fuso horário da loja | só o painel |

O painel lê as seções editáveis em `GET /api/configuracoes` e grava uma seção em `PUT /api/configuracoes/<seção>`. Para criar uma configuração nova, acrescente o campo em `padrao` e em `validar` na seção certa; instalações antigas recebem o valor padrão sem precisar de migração.

**Aparência (Painel > Aparência).** A loja escolhe a cor principal (botões, links, preços), a cor secundária (cabeçalho e rodapé), a letra dos títulos e envia logotipo, ícone da aba e banner da página inicial.

- **Ver antes de publicar.** Tudo o que se altera na aba fica como rascunho. Quem está logado no painel passa a ver o site inteiro com a nova aparência (a faixa do topo avisa que é uma prévia); os clientes continuam vendo a versão publicada. Na própria aba há os botões **Publicar para os clientes** e **Descartar alterações**.
- O rascunho fica no banco (configuração `temaRascunho`), então sobrevive a reinícios do servidor e vale para qualquer pessoa logada no painel. As regras estão em `src/aparencia.js`. Uma imagem só é apagada do disco quando nem o tema publicado nem o rascunho a usam mais.
- `css/site.css` traz o visual padrão em variáveis; o servidor gera `/tema.css`, carregado depois dele em todas as páginas, trocando só essas variáveis. Sem nada configurado, `/tema.css` vem vazio e o site fica com o visual padrão.
- O sistema ajusta a legibilidade sozinho: se a cor principal for clara demais para texto, links e preços usam um tom mais escuro dela; se a cor secundária for escura, o texto do cabeçalho e do rodapé fica branco.
- As letras são fontes que já vêm nos aparelhos (nada é baixado de outros sites). A lista fica em `src/tema.js`.
- Imagens: JPG, PNG ou WebP, até 2 MB (o navegador reduz antes de enviar). Ficam em `data/uploads/`, junto com as fotos dos produtos.
- Nenhum texto digitado vai direto para o CSS: cores só no formato `#rrggbb`, fonte só da lista, endereços de imagem só os gerados pelo servidor.

**Horários, entrega e retirada (Painel > Configurações).**

- **Horários de funcionamento:** um período por dia e, para quem fecha no meio do dia, um segundo (ex.: almoço e jantar). Aparecem no rodapé do site só depois que a loja marca "Mostrar os horários"; dias seguidos com o mesmo horário são agrupados ("Seg a Sex: 9h às 18h"). São informativos: não bloqueiam pedidos fora do horário.
- **Como o cliente recebe o pedido:** a loja liga ou desliga retirada e entrega (ao menos uma fica ligada) e escreve as informações de cada uma, além do texto da taxa de entrega. O carrinho só oferece o que está ligado, e o servidor recusa pedido em uma forma desligada.
- **Endereço da loja:** opcional; quando preenchido, aparece no rodapé.
- As regras ficam em `src/atendimento.js`.

**Recursos opcionais (Painel > Configurações > Recursos opcionais).** Vêm desligados; cada loja liga só o que usa. Depois de ligar, os campos aparecem na tela de edição de cada produto.

- **Variações:** o mesmo produto em opções com preço próprio (Pequeno, Médio, Grande). Produto com variações exige que o cliente escolha uma, e o preço dela vale no lugar do preço do produto; na vitrine aparece "a partir de". Até 20 por produto.
- **Adicionais:** extras que o cliente pode marcar (calda, embalagem para presente), somados ao preço. Até 30 por produto.
- **Estoque:** quantidade disponível de cada produto, ou de cada variação quando o produto tem variações. Vazio = sem controle. Cada pedido diminui o estoque; se não houver o bastante, o pedido inteiro é recusado e o cliente vê quanto resta. Em zero, o produto aparece como esgotado. Cancelar um pedido devolve a quantidade; reabrir um pedido cancelado tira de novo (e é recusado se não houver mais). Na aba de produtos dá para ajustar o estoque direto na lista.
- O pedido guarda uma cópia do que foi escolhido (variação, adicionais e preço): mudar o produto depois não altera pedidos antigos.
- Desligar um recurso esconde os dados dele e faz os pedidos novos ignorá-lo, mas nada é apagado: religar traz tudo de volta.
- As regras ficam em `src/catalogo.js`; preços e nomes das escolhas saem sempre do banco, nunca do que o navegador envia.

**Fuso horário.** A data mínima dos pedidos ("de hoje em diante") e os dias do resumo seguem o fuso da loja, não o do servidor. O padrão é `America/Sao_Paulo`. Para uma loja em outro fuso, escolha em Painel > Configurações > Horários de funcionamento (a lista traz os quatro fusos do Brasil).

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

## Equipe, perfis e permissões

Cada pessoa da equipe entra no painel com o próprio usuário e senha (Painel > Equipe). O que ela pode fazer vem do **perfil** dela, com **ajustes individuais** por cima.

- **Permissões.** A lista é fixa e fica em `src/permissoes.js`: ver o resumo, ver pedidos, alterar pedidos, ver clientes, editar o catálogo, editar a página Sobre, mudar a aparência, alterar configurações, gerenciar a equipe e ver o registro de atividades. Cada rota do painel declara a permissão que exige (o 4º item da rota, em `src/rotas/`); o servidor confere em todo pedido. Sem login a resposta é 401; com login e sem a permissão, 403. As telas só escondem o que a pessoa não pode usar: quem decide é o servidor.
- **Perfis.** Um perfil é um conjunto de permissões. O **Administrador** é fixo: tem sempre todas (inclusive as que forem criadas depois) e não pode ser alterado nem excluído. A instalação traz dois perfis de exemplo, Atendimento e Catálogo, que podem ser alterados ou apagados. Perfil em uso não é excluído.
- **Ajustes individuais.** Para uma pessoa específica dá para liberar uma permissão que o perfil não tem ou bloquear uma que ele tem.
- **Ninguém concede o que não possui.** Quem gerencia a equipe só cria ou altera pessoas e perfis dentro das permissões que ele mesmo tem, e não mexe em quem pode mais do que ele (nem para tirar permissões ou trocar a senha). Ninguém altera o próprio perfil, os próprios ajustes ou se desativa. A loja nunca fica sem ao menos um Administrador ativo. As regras ficam em `src/equipe.js`.
- **Efeito imediato.** Mudar o perfil ou os ajustes vale no pedido seguinte da pessoa, sem novo login. Desativar alguém ou definir uma senha nova para ele desloga a pessoa na hora. Não há exclusão de pessoas, só desativação, para o registro de atividades continuar dizendo quem fez o quê.
- **Sessões.** Ficam no banco (tabela `sessoes`), com validade de 12 horas, então reiniciar o servidor não desloga ninguém. O banco guarda só o SHA-256 do token do cookie: quem ler o banco ou um backup não consegue entrar como ninguém.
- **Loja que já existia:** a conta de acesso anterior vira o primeiro Administrador, com o mesmo usuário e a mesma senha.

## Registro de atividades

Painel > Atividade mostra o que a equipe fez: quem entrou (e as tentativas recusadas em contas da equipe), e tudo o que foi criado, alterado ou excluído, com data, pessoa, alvo e um resumo do que mudou (por exemplo, o status de um pedido de "Novo" para "Confirmado").

- O servidor registra sozinho toda rota que altera dados quando quem chama é da equipe; uma rota nova já nasce registrada. Ações de clientes e visitantes não entram.
- Senhas e o conteúdo enviado nunca são gravados; só o que cada rota escolhe anotar (`src/auditoria.js`).
- A tabela `auditoria` é só de inserção: gatilhos do próprio banco recusam alterar, apagar ou substituir uma linha, e não existe rota para isso. Quem tem acesso ao arquivo do banco ainda poderia remover os gatilhos de propósito; a proteção é contra engano e contra qualquer caminho pelo site.
- O registro guarda o nome e o usuário de quem fez, copiados na hora: continua legível se a pessoa mudar de nome ou for desativada.
- Não há limpeza automática: o registro cresce com o uso (uma linha pequena por ação).

## Segurança

- **Pedidos vindos de outro site são recusados.** Tudo o que altera dados (login, pedido, cadastro, painel) só é aceito se saiu de uma página do próprio site: o servidor confere o cabeçalho `Origin` (ou `Sec-Fetch-Site`) contra o endereço pelo qual o pedido chegou e contra o `SITE_URL`. Isso impede que uma página qualquer, aberta no navegador de quem está logado, aja em nome dessa pessoa. Atrás de um proxy que troque o cabeçalho `Host`, configure o `SITE_URL` com o endereço público.
- **HTTPS obrigatório em produção.** Com `NODE_ENV=production`, todas as respostas levam `Strict-Transport-Security` (um ano): depois da primeira visita, o navegador só acessa o site por HTTPS.
- **Limite de tentativas por IP e por conta.** Além do limite por IP, cada conta (clientes e painel) aceita 10 erros de senha em 15 minutos, somando todos os IPs; depois disso fica bloqueada por 15 minutos, mesmo para a senha certa. Acertar a senha zera a contagem. A contagem fica em memória: reiniciar o servidor libera na hora.
- **Listas paginadas.** Pedidos e clientes do painel vêm 30 por vez, e o histórico do cliente, 20 por vez ("Carregar mais"). O filtro de status e a busca de clientes são feitos no servidor.
- Senhas com hash e sal, sessão em cookie `HttpOnly` e `SameSite=Lax`, política de conteúdo (CSP) sem scripts de fora, e preços sempre calculados no servidor.

## Limites conhecidos (de propósito, para manter simples)

- O banco é SQLite, um arquivo no disco do servidor: a hospedagem precisa ter disco persistente. Rode **uma única instância** do servidor.
- Os limites de tentativas ficam em memória: reiniciar o servidor zera as contagens (as sessões, não: elas ficam no banco).
- Não há pagamento online: o pedido é uma reserva, confirmada pelo WhatsApp.
- Ao publicar na internet, coloque atrás de HTTPS (ex.: proxy do provedor de hospedagem) e use `NODE_ENV=production` e `TRUST_PROXY=1`. O `TRUST_PROXY=1` faz o limite de tentativas de login contar pelo IP de cada visitante, e não pelo IP do proxy; não ligue se o servidor ficar exposto direto, sem proxy.
