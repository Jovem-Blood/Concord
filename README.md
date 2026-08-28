# Concord

Cliente web sem instalação e aplicativo Windows para compartilhar telas em uma sala privada. Os dois usam o mesmo renderer Vue e o mesmo serviço LiveKit; somente a seleção da fonte de captura muda entre o navegador e o Electron.

## O que já está no MVP

- criação e entrada por código de sala com 8 caracteres não ambíguos;
- links de convite em `/:roomCode`, com entrada pelo navegador e botão **Copiar link**;
- clientes web e desktop assistindo e transmitindo na mesma sala;
- seleção própria de monitores e janelas, com miniaturas;
- seletor seguro nativo do navegador no cliente web;
- perfis `1080p30` para movimento e `1080p15` para texto;
- áudio de sistema opcional e desligado por padrão;
- vários participantes transmitindo ao mesmo tempo;
- lista de participantes, foco em um stream e estado de reconexão;
- encerramento idempotente ao parar, fechar a fonte ou perder a track;
- API Fastify com validação, rate limit e JWT LiveKit de duas horas;
- LiveKit local e modelo de implantação em VM com Docker Compose;
- instalador Squirrel e pacote ZIP para Windows x64.

Não há integração com Discord, microfone, câmera, chat, contas, gravação ou telemetria.

## Requisitos

- Windows 11 x64 para o aplicativo Electron;
- navegador recente com `getDisplayMedia`; o compartilhamento web exige HTTPS, exceto em `localhost`;
- Node.js 22.12 ou mais recente;
- pnpm 10;
- Docker Desktop para executar o LiveKit localmente.

## Desenvolvimento

```powershell
Copy-Item .env.example .env
pnpm install
docker compose --env-file .env -f infra/docker-compose.yml up --build
```

O cliente web fica em `http://localhost:4173`. Para desenvolvimento com recarregamento automático, mantenha LiveKit e a API ativos e execute `pnpm dev:web`; para abrir o Electron, execute `pnpm dev:desktop`.

Um link como `http://localhost:4173/ABCD2345` prepara a entrada nessa sala. Depois de entrar, qualquer participante web ou desktop pode assistir e transmitir. No navegador, áudio de sistema é uma capacidade opcional: depende do navegador, sistema operacional e tipo de fonte escolhido. Abas do navegador costumam oferecer o suporte mais consistente.

Variáveis do servidor:

| Variável | Uso |
|---|---|
| `LIVEKIT_URL` | URL enviada ao cliente, `ws://` local ou `wss://` em produção |
| `LIVEKIT_API_KEY` | chave somente do servidor |
| `LIVEKIT_API_SECRET` | segredo somente do servidor |
| `ALLOWED_ORIGINS` | origens web adicionais separadas por vírgula |
| `PUBLIC_APP_URL` | URL pública do cliente web usada pelo Compose |
| `PUBLIC_TOKEN_SERVER_URL` | URL pública da API incorporada ao build web |
| `CLOUDFLARE_TURN_KEY_ID` | identificador privado da chave do Cloudflare Realtime TURN |
| `CLOUDFLARE_TURN_API_TOKEN` | token privado usado pelo servidor para gerar credenciais TURN temporárias |
| `CLOUDFLARE_TURN_TTL_SECONDS` | validade das credenciais TURN, padrão `7200`, máximo `172800` |
| `PORT` | porta da API, padrão `3001` |
| `VITE_TOKEN_SERVER_URL` | URL pública da API embutida nos clientes |
| `VITE_WEB_APP_URL` | base usada pelo Electron ao copiar links de convite |

Para preparar uma instalação self-hosted, execute `./scripts/setup-self-host.sh concord.example.com livekit.example.com`. O script gera chaves seguras em `.env` e configura `apps/desktop/.env.local` antes do build. O segredo LiveKit nunca entra no navegador nem no pacote Electron.

### Cloudflare Realtime TURN

Quando `CLOUDFLARE_TURN_KEY_ID` e `CLOUDFLARE_TURN_API_TOKEN` estão configurados, cada chamada válida a `/v1/join` gera credenciais TURN temporárias no servidor e as entrega ao `livekit-client` como `RTCConfiguration.iceServers`. O token permanente da Cloudflare permanece somente no token-server. As URLs alternativas na porta 53 são removidas para evitar timeouts em navegadores.

O desenvolvimento local não precisa dessas variáveis: os testes usam uma resposta Cloudflare simulada. O TURN é usado como fallback (`iceTransportPolicy: all`), portanto conexões diretas continuam preferidas quando disponíveis.

## Verificações

```powershell
pnpm typecheck
pnpm test
pnpm lint
pnpm build
```

## Build Windows

```powershell
pnpm make
```

Os artefatos ficam em `apps/desktop/out/make`. O instalador não é assinado no MVP e pode acionar o aviso do Windows SmartScreen. Assinatura de código deve ser adicionada antes de uma distribuição mais ampla.

## Build web

```powershell
pnpm build:web
```

Os arquivos estáticos ficam em `apps/desktop/dist-web`. O contêiner `web` gera e publica esse build automaticamente na porta `4173`, com fallback para rotas de convite.

## Segurança

No Electron, o renderer usa `nodeIntegration: false`, `contextIsolation: true`, `sandbox: true` e uma Content Security Policy. O preload expõe somente três operações de captura. Cada seleção fica vinculada à janela que a solicitou, expira em dez segundos e é consumida uma única vez. Navegações e novas janelas são bloqueadas.

No navegador, a captura usa diretamente `getDisplayMedia` e sempre exige uma ação do usuário. A permissão não é persistida e a página não recebe uma lista prévia de janelas ou monitores. Em produção, publique o cliente exclusivamente por HTTPS.

## Produção

Veja [infra/README.md](infra/README.md). O LiveKit deve rodar em uma VM com acesso UDP/TCP apropriado; um proxy HTTP sozinho não transporta ICE, mídia ou TURN.

## Próxima fase

Áudio de um processo específico no Windows fica fora do MVP. A evolução recomendada é um helper nativo isolado usando WASAPI Process Loopback (`VIRTUAL_AUDIO_DEVICE_PROCESS_LOOPBACK`) para incluir o jogo e excluir Discord ou outros aplicativos.
