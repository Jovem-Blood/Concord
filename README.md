# Concord

Aplicativo Windows pequeno para compartilhar telas em uma sala privada. O Electron cuida da interface e da captura; o LiveKit transporta vídeo e áudio opcional; a conversa de voz continua no aplicativo que o grupo já usa.

## O que já está no MVP

- criação e entrada por código de sala com 8 caracteres não ambíguos;
- seleção própria de monitores e janelas, com miniaturas;
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

- Windows 11 x64 para o aplicativo;
- Node.js 22.12 ou mais recente;
- pnpm 10;
- Docker Desktop para executar o LiveKit localmente.

## Desenvolvimento

```powershell
Copy-Item .env.example .env
pnpm install
docker compose --env-file .env -f infra/docker-compose.yml up --build
pnpm dev
```

O app abre pelo Electron Forge. Para testar com duas instâncias na mesma máquina, execute uma segunda cópia empacotada; para a validação real, use dois computadores e siga [o checklist](docs/manual-test-checklist.md).

Variáveis do servidor:

| Variável | Uso |
|---|---|
| `LIVEKIT_URL` | URL enviada ao cliente, `ws://` local ou `wss://` em produção |
| `LIVEKIT_API_KEY` | chave somente do servidor |
| `LIVEKIT_API_SECRET` | segredo somente do servidor |
| `ALLOWED_ORIGINS` | origens web adicionais separadas por vírgula |
| `PORT` | porta da API, padrão `3001` |

Para apontar o desktop a outra API, crie `apps/desktop/.env.local` com `VITE_TOKEN_SERVER_URL=https://api.example.com` antes do build. O segredo LiveKit nunca entra no pacote Electron.

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

## Segurança

O renderer usa `nodeIntegration: false`, `contextIsolation: true`, `sandbox: true` e uma Content Security Policy. O preload expõe somente três operações de captura. Cada seleção fica vinculada à janela que a solicitou, expira em dez segundos e é consumida uma única vez. Navegações e novas janelas são bloqueadas.

## Produção

Veja [infra/README.md](infra/README.md). O LiveKit deve rodar em uma VM com acesso UDP/TCP apropriado; um proxy HTTP sozinho não transporta ICE, mídia ou TURN.

## Próxima fase

Áudio de um processo específico no Windows fica fora do MVP. A evolução recomendada é um helper nativo isolado usando WASAPI Process Loopback (`VIRTUAL_AUDIO_DEVICE_PROCESS_LOOPBACK`) para incluir o jogo e excluir Discord ou outros aplicativos.
