# Infraestrutura

## Desenvolvimento local

1. Copie `../.env.example` para `../.env`.
2. Na raiz, execute `docker compose --env-file .env -f infra/docker-compose.yml up --build`.
3. O LiveKit ficará em `ws://localhost:7880` e a API de tokens em `http://localhost:3001`.

As credenciais do exemplo são públicas e servem somente para desenvolvimento local.

## VM de produção

O LiveKit precisa receber WebRTC diretamente. Use uma VM Linux com IP público e libere:

- `443/TCP` para HTTPS/WSS no Caddy;
- `7881/TCP` para ICE/TCP;
- `3478/UDP` para TURN/UDP;
- `50000-60000/UDP` para mídia WebRTC.

Passos:

1. Aponte `livekit.example.com` e `api.example.com` para a VM.
2. Copie `livekit.production.example.yaml` para `livekit.production.yaml` e ajuste os domínios.
3. Copie `Caddyfile.example` para `Caddyfile` e ajuste os domínios.
4. Crie `.env` com chaves longas e aleatórias. Use `LIVEKIT_URL=wss://livekit.example.com`.
5. Execute `docker compose --env-file .env -f infra/docker-compose.production.yml up -d --build`.

O Caddy termina TLS para signaling e para a API. Os fluxos ICE/TURN continuam chegando diretamente ao LiveKit; não tente encaminhá-los por um proxy HTTP. Se a VM ou provedor usar NAT, valide o IP anunciado pelo LiveKit e as regras do firewall antes do teste externo.
