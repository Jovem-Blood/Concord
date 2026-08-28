# Infraestrutura

## Desenvolvimento local

1. Copie `../.env.example` para `../.env`.
2. Na raiz, execute `docker compose --env-file .env -f infra/docker-compose.yml up --build`.
3. O LiveKit ficará em `ws://localhost:7880`, a API em `http://localhost:3001` e o cliente web em `http://localhost:4173`.

O `node_ip` do arquivo local anuncia `127.0.0.1` para que o ICE funcione através das portas publicadas pelo Docker Desktop. Não reutilize esse arquivo em produção.

As credenciais do exemplo são públicas e servem somente para desenvolvimento local.

## Servidor de produção

O Compose de produção usa a rede bridge do Docker e publica portas explicitamente. Isso funciona tanto em uma VM Linux quanto em um servidor caseiro; `network_mode: host` não é necessário.

O LiveKit precisa receber WebRTC diretamente. No firewall e, para um servidor caseiro, no redirecionamento de portas do roteador, libere:

- `443/TCP` para HTTPS/WSS no Caddy;
- `7881/TCP` para ICE/TCP;
- `3478/UDP` para TURN/UDP;
- `7882/UDP` para mídia WebRTC;
- `30000-30100/UDP` para relay TURN.

O exemplo usa a porta UDP multiplexada `7882`, evitando encaminhar a faixa ICE de milhares de portas. O TURN ainda usa uma faixa pequena própria para relay. Preserve os mesmos números nas portas externas e internas do roteador.

Passos:

1. Aponte `livekit.example.com` e `concord.example.com` para o servidor. Domínios separados simplificam o proxy de signaling e das rotas web.
2. Execute `./scripts/setup-self-host.sh concord.example.com livekit.example.com`. Use `--force` somente para substituir uma configuração existente.
3. Copie `livekit.production.example.yaml` para `livekit.production.yaml`. Ajuste `turn.example.com` para um hostname DNS-only apontando ao IP público do servidor.
4. Copie `Caddyfile.example` para `Caddyfile` e ajuste os domínios.
5. Execute `docker compose --env-file .env -f infra/docker-compose.production.yml up -d --build`.

O script cria dois arquivos privados, ignorados pelo Git:

- `.env`, usado pelo LiveKit e pelo servidor de tokens;
- `apps/desktop/.env.local`, usado durante o build do Electron.

O Compose constrói o cliente web com `PUBLIC_APP_URL` e `PUBLIC_TOKEN_SERVER_URL`. Essas variáveis são incorporadas ao JavaScript durante o build: depois de alterá-las, execute novamente com `--build`. Execute `pnpm make` sempre que a URL pública mudar para atualizar também o Electron.

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

O Compose publica `7880`, `3001` e `4173` apenas em `127.0.0.1`, então essa configuração funciona diretamente quando o `cloudflared` roda no host. Se ele estiver em outro contêiner, conecte-o à mesma rede Compose e use `http://livekit:7880`, `http://token-server:3001` e `http://web:4173` como origens.

O Tunnel encaminha HTTPS e signaling WebSocket, mas não transporta ICE, TURN ou mídia WebRTC. Encaminhe diretamente no roteador `7881/TCP`, `7882/UDP`, `3478/UDP` e `30000-30100/UDP` para o servidor. O hostname TURN deve ficar como **DNS only** no Cloudflare; a nuvem laranja e o Tunnel não encaminham TURN/UDP.

Se a operadora usa CGNAT, o redirecionamento de portas do roteador não torna o servidor alcançável. Nesse caso, solicite um IPv4 público à operadora ou hospede um TURN em uma máquina com IP público.

### Diagnóstico de conexão

- `POST /join` com status `200` confirma que o navegador alcançou a API de tokens.
- WebSocket do LiveKit com status `101` confirma que o signaling atravessou o proxy ou Tunnel.
- Os quadros ilegíveis mostrados pelo navegador são protobuf binário normal, não mojibake.
- Se houver `101` e a sala cair logo depois, verifique os candidatos ICE, `use_external_ip`, firewall e redirecionamento das portas `7881/TCP`, `7882/UDP`, `3478/UDP` e `30000-30100/UDP`.

O Caddy termina TLS para signaling e para a API. Os fluxos ICE/TURN continuam chegando diretamente ao LiveKit; não tente encaminhá-los por um proxy HTTP. Se o servidor usar NAT, valide o IP anunciado pelo LiveKit e as regras do firewall antes do teste externo.
