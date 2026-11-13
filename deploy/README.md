# Publicar em uma máquina Ubuntu (Oracle Cloud Always Free)

Os comandos abaixo rodam **dentro da máquina**, por SSH. Troque `SEU-DOMINIO` e `SEU-USUARIO` onde aparecerem.

## 1. Instalar Node, Caddy e Git

```
sudo apt update && sudo apt upgrade -y
curl -fsSL https://deb.nodesource.com/setup_26.x | sudo -E bash -
sudo apt install -y nodejs caddy git
node -v
```

O `node -v` precisa mostrar 24 ou mais novo.

## 2. Liberar as portas 80 e 443 no firewall da máquina

As imagens Ubuntu da Oracle bloqueiam tudo menos o SSH, mesmo com a porta liberada no painel:

```
sudo iptables -I INPUT 6 -m state --state NEW -p tcp --dport 80 -j ACCEPT
sudo iptables -I INPUT 6 -m state --state NEW -p tcp --dport 443 -j ACCEPT
sudo netfilter-persistent save
```

## 3. Baixar o site

```
sudo useradd --system --home /opt/confeitaria --shell /usr/sbin/nologin confeitaria
sudo git clone https://github.com/SEU-USUARIO/confeitaria-site.git /opt/confeitaria
```

Se o repositório for privado, o Git pede usuário e um token de acesso do GitHub no lugar da senha.

## 4. Configurar

```
sudo cp /opt/confeitaria/deploy/confeitaria.env.exemplo /etc/confeitaria.env
sudo chmod 600 /etc/confeitaria.env
sudo nano /etc/confeitaria.env
```

Preencha o domínio, a senha inicial e os dados de e-mail.

## 5. Ligar o site como serviço

```
sudo cp /opt/confeitaria/deploy/confeitaria.service /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable --now confeitaria
sudo systemctl status confeitaria
curl -s localhost:3000/api/produtos | head -c 100
```

O `curl` precisa devolver a lista de produtos. Os dados ficam em `/var/lib/confeitaria`.

## 6. HTTPS com o Caddy

```
sudo cp /opt/confeitaria/deploy/Caddyfile /etc/caddy/Caddyfile
sudo nano /etc/caddy/Caddyfile
sudo systemctl reload caddy
```

Com o domínio já apontando para o IP da máquina, o site abre em `https://SEU-DOMINIO` em menos de um minuto.

## 7. Backup diário

```
sudo crontab -u confeitaria -e
```

Adicione a linha (todo dia às 3h):

```
0 3 * * * cd /opt/confeitaria && DATA_DIR=/var/lib/confeitaria /usr/bin/node scripts/backup.js
```

Cada cópia é uma pasta em `/var/lib/confeitaria/backups` com o banco (`loja.db`) e as fotos (`uploads/`). O script guarda as 14 mais recentes e apaga as mais antigas; para guardar mais, acrescente `--manter 30` ao fim da linha. Baixe uma cópia para o seu computador de vez em quando: se a máquina se perder, as cópias que estão nela se perdem junto.

## Atualizar o site depois

```
cd /opt/confeitaria && sudo git pull && sudo systemctl restart confeitaria
```

## Ver o que está acontecendo

```
sudo journalctl -u confeitaria -n 50
sudo journalctl -u caddy -n 50
```
