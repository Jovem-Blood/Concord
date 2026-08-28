# Infraestrutura

## Desenvolvimento local

1. Copie `../.env.example` para `../.env`.
2. Na raiz, execute `docker compose --env-file .env -f infra/docker-compose.yml up --build`.
3. O LiveKit ficará em `ws://localhost:7880`, a API em `http://localhost:3001` e o cliente web em `http://localhost:4173`.

O `node_ip` do arquivo local anuncia `127.0.0.1` para que o ICE funcione através das portas publicadas pelo Docker Desktop. Não reutilize esse arquivo em produção.

As credenciais do exemplo são públicas e servem somente para desenvolvimento local.

## VM de produção

O LiveKit precisa receber WebRTC diretamente. Use uma VM Linux com IP público e libere:

- `443/TCP` para HTTPS/WSS no Caddy;
- `7881/TCP` para ICE/TCP;
- `3478/UDP` para TURN/UDP;
- `50000-60000/UDP` para mídia WebRTC.

Passos:

1. Aponte `livekit.example.com` e `concord.example.com` para a VM. Domínios separados simplificam o proxy de signaling e das rotas web.
2. Execute `./scripts/setup-self-host.sh concord.example.com livekit.example.com`. Use `--force` somente para substituir uma configuração existente.
3. Copie `livekit.production.example.yaml` para `livekit.production.yaml` e ajuste o domínio TURN.
4. Copie `Caddyfile.example` para `Caddyfile` e ajuste os domínios.
5. Execute `docker compose --env-file .env -f infra/docker-compose.production.yml up -d --build`.

O script cria dois arquivos privados, ignorados pelo Git:

- `.env`, usado pelo LiveKit e pelo servidor de tokens;
- `apps/desktop/.env.local`, usado durante o build do Electron.

O Compose também constrói o cliente web com `PUBLIC_APP_URL`. Execute `pnpm make` novamente sempre que a URL pública mudar para atualizar os links copiados pelo Electron.

### Cloudflare Tunnel

Com Cloudflare Tunnel, mantenha um hostname para o aplicativo e outro para o signaling LiveKit. Encaminhe as rotas da API antes da rota geral do cliente web:

```yaml
ingress:
  - hostname: concord.example.com
    path: ^/(health|v1/.*)$
    service: http://127.0.0.1:3001
  - hostname: concord.example.com
    service: http://127.0.0.1:4173
  - hostname: livekit.example.com
    service: http://127.0.0.1:7880
  - service: http_status:404
```

Nesse caso, o Caddy não é necessário. Inicie apenas os outros serviços:

```sh
docker compose --env-file .env -f infra/docker-compose.production.yml up -d --build livekit token-server web
```

O `cloudflared` precisa executar na mesma máquina ou ter uma rota de rede para essas portas. O Tunnel encaminha HTTPS e signaling WebSocket, mas não transporta ICE, TURN ou mídia WebRTC; mantenha `7881/TCP`, `3478/UDP` e `50000-60000/UDP` acessíveis diretamente.

O Caddy termina TLS para signaling e para a API. Os fluxos ICE/TURN continuam chegando diretamente ao LiveKit; não tente encaminhá-los por um proxy HTTP. Se a VM ou provedor usar NAT, valide o IP anunciado pelo LiveKit e as regras do firewall antes do teste externo.
