# Concord

Cliente web e aplicativo Windows para compartilhar telas em salas privadas. Ambos usam o mesmo renderer Vue, com mídia no **Cloudflare Realtime Serverless SFU** e sinalização autorizada pela API Fastify do projeto.

## Recursos

- Criação e entrada por código, links de convite e botão **Copiar link**.
- Web e Electron assistindo e transmitindo na mesma sala.
- Captura nativa do navegador; seleção de monitores/janelas com miniaturas no Windows.
- Perfis `1080p30` para movimento e `1080p15` para texto.
- Áudio de sistema opcional, desligado por padrão.
- Até 16 participantes por sala, com várias telas simultâneas, foco e lista de participantes.
- Reconexão com nova sessão SFU, republicação da captura ainda ativa e reassinatura das telas remotas.
- Encerramento da captura ao parar, sair ou perder a sessão de sala.
- Instalador Squirrel e pacote ZIP para Windows x64.

Não há microfone, câmera, chat, contas, gravação ou integração com Discord. Acesso à sala é por posse do código/link.

## Desenvolvimento

Requisitos: Node.js 22.12+ (use **Node 24 LTS** para empacotar Windows), pnpm 10 e um aplicativo Cloudflare Realtime SFU. O Electron requer Windows 11 x64; a captura web requer navegador com `getDisplayMedia` e HTTPS, exceto em localhost.

1. Copie `.env.example` para `.env` **se não houver configuração existente**.
2. No painel Cloudflare → Realtime → Serverless SFU, crie um aplicativo e preencha `CLOUDFLARE_SFU_APP_ID` e `CLOUDFLARE_SFU_APP_SECRET` no `.env`.
3. Instale dependências e inicie a API:

```powershell
pnpm install
pnpm dev:server
```

Em outro terminal, execute `pnpm dev:web` (web em `http://localhost:5173`) ou `pnpm dev:desktop`. A API carrega automaticamente o `.env` da raiz. Um convite como `http://localhost:5173/ABCD2345` prepara a entrada na sala.

Com Docker, execute `docker compose --env-file .env -f infra/docker-compose.yml up --build` e abra `http://localhost:4173`. Não há SFU local: mesmo em desenvolvimento, a mídia usa a Cloudflare. Testes unitários usam um SFU simulado e não exigem credenciais.

## Configuração

| Variável | Uso |
|---|---|
| `CLOUDFLARE_SFU_APP_ID` | Identificador do aplicativo SFU, obrigatório no servidor |
| `CLOUDFLARE_SFU_APP_SECRET` | Segredo do aplicativo SFU, somente no servidor |
| `ALLOWED_ORIGINS` | Origens web permitidas, separadas por vírgula |
| `PORT` | Porta da API, padrão `3001` |
| `PUBLIC_APP_URL` | URL pública do web usada pelo Compose |
| `PUBLIC_TOKEN_SERVER_URL` | URL pública da API incorporada ao build web pelo Compose |
| `CLOUDFLARE_TURN_KEY_ID` | Chave TURN opcional para redes restritivas |
| `CLOUDFLARE_TURN_API_TOKEN` | Token privado para gerar credenciais TURN temporárias |
| `CLOUDFLARE_TURN_TTL_SECONDS` | Validade TURN em segundos, padrão `7200`, máximo `172800` |
| `VITE_TOKEN_SERVER_URL` | URL da API em `apps/desktop/.env.local`, incorporada ao cliente |
| `VITE_WEB_APP_URL` | Base dos convites copiados pelo Electron |

Nunca coloque segredos em variáveis `VITE_`. A API emite um token opaco por participante e entrega somente credenciais ICE temporárias ao cliente. Sem TURN configurado, usa STUN da Cloudflare; com TURN, conexões diretas continuam permitidas. O áudio de captura web depende do navegador, sistema e fonte; quando não há áudio disponível, o vídeo continua com um aviso.

## Arquitetura e limites

O SFU fornece sessões e faixas, não salas. A API mantém presença em memória, valida tokens e autoriza publicação/assinatura dentro da sala. O cliente usa `RTCPeerConnection`, negocia ofertas/respostas pela API e atualiza a presença a cada três segundos. A mídia vai diretamente à Cloudflare.

Execute uma única instância da API. Reinícios exigem que os usuários entrem novamente; múltiplas réplicas precisam de coordenação compartilhada. Sessões de sala duram até duas horas e expiram após dois minutos sem atividade. O servidor tenta encerrar as faixas abandonadas. A mídia é serverless; a API de presença continua sendo um serviço do projeto.

As operações SDP são serializadas. Em falhas transitórias, o cliente tenta reconstruir a sessão e manter a captura existente. Expiração de token ou falhas persistentes encerram a captura e exigem nova entrada. Esta implementação usa uma camada de vídeo com limites de bitrate por perfil; não reproduz o simulcast/adaptive stream automático do SDK anterior.

## Verificações e builds

```powershell
pnpm typecheck
pnpm test
pnpm lint
pnpm build
pnpm make
```

O build web fica em `apps/desktop/dist-web`; instalador e ZIP em `apps/desktop/out/make`. O instalador MVP não é assinado e pode acionar o SmartScreen. A [lista de testes manuais](docs/manual-test-checklist.md) cobre o teste entre computadores e redes diferentes.

## Segurança e produção

Electron mantém `nodeIntegration: false`, `contextIsolation: true`, `sandbox: true` e CSP. O preload expõe somente operações de captura; seleções são vinculadas à janela, expiram em dez segundos e são consumidas uma vez. O web usa `getDisplayMedia` mediante ação do usuário.

Veja [infra/README.md](infra/README.md) para Caddy, Cloudflare Tunnel e migração da instalação existente. Só a API e os arquivos web precisam ser hospedados. Não há portas de entrada para mídia no host Concord. Recompile os clientes e atualize a API juntos, pois o protocolo de sala mudou.

Documentação de referência: [Cloudflare SFU HTTPS API](https://developers.cloudflare.com/realtime/sfu/https-api/).

Áudio de um processo específico no Windows permanece fora do MVP; a evolução prevista é um helper isolado com WASAPI Process Loopback.
