# Infraestrutura

A mídia usa Cloudflare Realtime Serverless SFU. Não há servidor de mídia local, hostname de signaling separado nem portas de entrada UDP para WebRTC no host do Concord. A API Fastify mantém presença e autoriza operações; o cliente negocia WebRTC diretamente com a Cloudflare.

Execute todos os comandos Compose abaixo na raiz do projeto. O Compose carrega o `.env` da raiz automaticamente.

## Desenvolvimento

1. Copie `.env.example` para `.env`, preservando uma configuração existente.
2. Crie um aplicativo em Cloudflare → Realtime → Serverless SFU e preencha `CLOUDFLARE_SFU_APP_ID` e `CLOUDFLARE_SFU_APP_SECRET`.
3. Na raiz do projeto, execute `docker compose up --build`.
4. Abra `http://localhost:4173`; a API fica em `http://localhost:3001`.

Sem Docker: `pnpm dev:server` carrega o `.env` da raiz; em outro terminal, execute `pnpm dev:web` ou `pnpm dev:desktop`. O SFU é remoto mesmo em desenvolvimento. Testes unitários não precisam de credenciais.

## Produção com Caddy

1. Aponte `concord.example.com` para o host da aplicação.
2. Opcionalmente execute `./scripts/setup-self-host.sh concord.example.com` para preparar arquivos novos. O script recusa sobrescrever arquivos existentes; `--force` substitui ambos e apaga suas credenciais anteriores.
3. Preencha as credenciais SFU no `.env`. Copie `infra/Caddyfile.example` para `infra/Caddyfile` e ajuste o domínio.
4. Na raiz do projeto, execute `docker compose -f docker-compose.production.yml up -d --build`.
5. Configure `VITE_TOKEN_SERVER_URL` e `VITE_WEB_APP_URL` em `apps/desktop/.env.local` e execute `pnpm make` com Node 24 LTS para um build local. Releases oficiais são gerados por tags `vX.Y.Z`; o workflow injeta `https://concord.opeixoto.com` nos clientes Windows e Linux.

Somente o Caddy publica portas de entrada `80/TCP`, `443/TCP` e, opcionalmente, `443/UDP` para HTTP/3. As portas `3001` e `4173` ficam em loopback. A API precisa de saída HTTPS para `rtc.live.cloudflare.com`; os clientes precisam alcançar a rede WebRTC da Cloudflare. Não é necessário encaminhar portas do roteador para mídia.

## Cloudflare Tunnel

Você também pode expor apenas HTTPS pelo Tunnel:

```yaml
ingress:
  - hostname: concord.example.com
    path: ^/(health|v1/.*)$
    service: http://localhost:3001
  - hostname: concord.example.com
    service: http://localhost:4173
  - service: http_status:404
```

Nesse caso, suba somente os serviços de aplicação:

```sh
docker compose -f docker-compose.production.yml up -d --build token-server web
```

Se `cloudflared` estiver em outro contêiner na mesma rede, use `http://token-server:3001` e `http://web:4173`. O Tunnel transporta a API e os arquivos web; a mídia vai do cliente para a Cloudflare sem passar pelo host Concord. Não faça cache de `/v1/*`.

## Presença, segurança e operação

- Execute **uma única instância da API**. As salas, tokens e publicações ficam em memória. Para múltiplas réplicas, será preciso implementar armazenamento/coordenação compartilhados (por exemplo, Durable Objects).
- Reiniciar a API encerra as sessões de sala: os usuários precisam entrar novamente. O SFU é serverless; a API de presença permanece hospedada pelo projeto.
- O acesso continua baseado em posse do código da sala; não há contas ou controle de acesso individual.
- Tokens aleatórios duram até duas horas (ou o TTL TURN, se menor); a API armazena somente seus hashes. Credenciais vencidas exigem nova entrada.
- O cliente atualiza presença a cada três segundos. Após dois minutos sem atividade, a API remove o participante e tenta fechar suas faixas. Abas suspensas pelo sistema podem precisar entrar novamente.
- Limite da aplicação: 16 participantes por sala, uma tela e uma faixa de áudio por participante. Não é um limite da Cloudflare.
- Todas as operações de mídia exigem token. A API restringe publicação à sessão do solicitante e assinatura às faixas publicadas na mesma sala.
- O segredo SFU e o token permanente TURN ficam somente no `.env` do servidor. Nunca use prefixo `VITE_` para eles. Não registre SDP nem cabeçalhos de autorização.
- `/health` confirma que a API está ativa, mas não testa credenciais nem conectividade de mídia. Faça o teste entre dois clientes após configurar as credenciais.

## TURN opcional

`CLOUDFLARE_TURN_KEY_ID` e `CLOUDFLARE_TURN_API_TOKEN` habilitam credenciais temporárias para redes restritivas. Sem eles, o cliente usa STUN e conecta diretamente ao SFU. URLs TURN na porta 53 são descartadas. Um erro ao gerar credenciais impede a entrada em vez de omitir silenciosamente o relay configurado.

## Migração de uma instalação anterior

Adicione as duas variáveis SFU ao `.env` existente e preserve URLs públicas e configurações TURN. Recompile e atualize a API, o web e o Electron juntos: o protocolo de sala mudou. Após validar vídeo e áudio em redes distintas, remova o contêiner antigo de mídia e suas regras de firewall/DNS. Não apague arquivos antigos de configuração ou segredos antes de concluir a validação e o plano de retorno.

Referências: [API SFU](https://developers.cloudflare.com/realtime/sfu/https-api/), [sessões e faixas](https://developers.cloudflare.com/realtime/sfu/sessions-tracks/), [conexão](https://developers.cloudflare.com/realtime/sfu/connection/).
