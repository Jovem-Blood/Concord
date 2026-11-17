# Verificação manual

[English](manual-test-checklist.md) | [Português do Brasil](manual-test-checklist.pt-BR.md)

Use dois clientes em dispositivos distintos, com salas de teste e suas próprias
credenciais SFU. Registre o commit, sistema operacional, versão do navegador ou
desktop e casos sem suporte no pull request. Os testes automatizados cobrem as
regras; estas verificações exercitam permissões, captura e conectividade reais.

- [ ] Crie uma sala e entre pelo segundo cliente usando o código e o link de convite.
- [ ] Ative e silencie cada microfone. Confira o áudio remoto e os indicadores de fala.
- [ ] Compartilhe uma tela ou janela, troque de fonte e encerre a captura tanto pelo
      aplicativo quanto pelo controle nativo do navegador. Confira a remoção dos
      vídeos remotos.
- [ ] Compartilhe pelos dois clientes simultaneamente e coloque cada vídeo em foco.
- [ ] Teste áudio do sistema quando a plataforma permitir; negue permissões e
      confira se o aplicativo orienta a recuperação sem iniciar uma captura indevida.
- [ ] Envie mensagens nos dois sentidos. Reconecte ou entre com outro cliente
      enquanto alguém permanece e confirme que o histórico volta sem duplicatas.
      Faça todos saírem, reutilize o código e confirme que o histórico está vazio.
- [ ] Interrompa um WebSocket enquanto alguém permanece. Confira o estado
      reconectando, mídia preservada, Enviar desativado com spinner, rascunho
      editável e recuperação silenciosa. O rascunho não deve ser enviado sozinho.
- [ ] Derrube a última conexão e volte em até 30 segundos. A identidade deve
      voltar, mas o histórico deve estar vazio. Texto com falha exige copiar para o rascunho.
- [ ] Perca uma confirmação de mensagem. Confira texto pendente, enviado uma vez,
      ou vermelho após 30 segundos; Reenviar não pode duplicar uma mensagem aceita.
- [ ] Confira nomes combinados ao digitar, sem indicador próprio, e limpeza após
      3 segundos parado, envio, rascunho vazio, fechamento do chat, página oculta e queda.
- [ ] Exceda o prazo de reconexão ou reinicie a API. A mídia deve parar e exigir
      entrada explícita. Recarregar não deve entrar automaticamente.
- [ ] Confira renovação automática das credenciais em uma sala com mais de duas horas.
- [ ] Repita os testes pelo Cloudflare Tunnel, somente com WebSocket. Um cliente
      antigo deve receber uma resposta exigindo atualização.
- [ ] Interrompa a rede brevemente e restabeleça a conexão. Confira a recuperação;
      depois saia da sala e confirme que microfone e capturas são encerrados.
- [ ] Copie um convite nos clientes web e desktop e abra-o no outro dispositivo.
- [ ] Confira a página inicial e a sala no celular e no desktop, incluindo foco de
      teclado, controles legíveis e mensagens de erro de permissão.
- [ ] Confira fullscreen no celular e tablet. Provoque notificações da sala e confirme
      que os toasts somem automaticamente e permitem clicar nos controles abaixo deles.
- [ ] Com o desenvolvimento desktop aberto, execute `pnpm build:web`; o resultado
      do build web não deve recarregar o desktop nem interromper a sessão ativa.
- [ ] Para uma release, instale e abra os builds NSIS no Windows e AppImage no Linux;
      confira as atualizações separadamente dos ZIPs portáteis.

Conectividade que exige relay TURN precisa de `CLOUDFLARE_TURN_KEY_ID` e
`CLOUDFLARE_TURN_API_TOKEN` juntos no servidor. Teste em redes diferentes e registre
se TURN está habilitado. Se ocorrer um timeout, registre `causeMessage` do console
local e os estados da conexão ICE; uma conexão posterior bem-sucedida não
estabelece a causa da falha anterior.

## Gameplay com movimento intenso

1. Use duas máquinas em redes diferentes. Registre o commit, o provedor retornado
   por `GET /v1/media/config`, a versão de cada cliente e a resolução selecionada.
   Faça uma rodada com Electron transmitindo para web e outra no sentido inverso.
2. Em 720p, reproduza 30 s de movimento leve e 60 s do mesmo replay com explosões
   e partículas. Em cada trecho, pressione Ctrl+Shift+D nas duas pontas durante
   o movimento. Guarde os arquivos por ponta e trecho e marque o instante de cada
   travada visível. Repita em 1080p. Use o mesmo replay para comparar versões.
3. Cada JSON contém duas amostras com cerca de 2 s de intervalo. Para o mesmo
   fluxo, divida a diferença dos contadores pelo intervalo de `timestamp` em
   segundos (o campo está em ms). Na origem use `media-source.frames`, no envio
   use `outbound-rtp.framesEncoded` e na recepção use `inbound-rtp.framesReceived`
   e `framesDecoded`. Registre também as dimensões RTP e o bitrate enviado
   (8 × diferença de `bytesSent` / segundos). Campos ausentes indicam medição
   indisponível. Após uma reconexão, inicie uma nova comparação.
4. Compare as variações de `framesDropped`, `freezeCount`, `totalFreezesDuration`
   e `packetsLost` no receptor com `qualityLimitationReason` no emissor e o RTT
   até o SFU (`currentRoundTripTime`, em segundos). Anote em qual etapa os FPS
   caíram primeiro. Os 30 FPS do seletor são o limite solicitado.
5. Repita com voz, áudio do sistema e uma segunda tela. Mude o foco, encerre uma
   tela e interrompa brevemente só a sinalização da sala. Confira a continuidade
   do outro vídeo e do áudio, a remoção da tela encerrada e a retomada do chat.
   Repita em uma instância de teste de cada provedor.

### Referência local de 17/11/2026

No Windows, dois peers WebRTC na mesma máquina usaram Electron 44.0.0,
Chromium 152.0.7977.54 e VP8. Um canvas desenhou 150 quadrados em movimento.
O ensaio usou `screenEncodings`, `motion`, `maintain-framerate` e o filtro de
estatísticas do cliente. Cada perfil negociou uma codificação sem RID.

| Fonte | Teto | Envio médio | FPS fonte / codificados / recebidos / decodificados | Resolução recebida ao fim |
| --- | --- | --- | --- | --- |
| 1280×720 | 2 Mb/s | 1,92 Mb/s | 30 / 30 / 30 / 30 | 1280×720 |
| 1920×1080 | 5 Mb/s | 3,11 Mb/s | 30 / 30 / 30 / 29,9 | 1920×1080 |

As médias cobrem 30 s após 3 s de aquecimento. Nesse intervalo, os contadores de
descartes, congelamentos e pacotes perdidos tiveram variação zero. Em uma execução
curta separada, ambos os perfis ainda entregavam 480×270 ao fim de 2 s de medição
com `qualityLimitationReason=bandwidth`. Captura de jogo, SFU e redes entre máquinas
ficam para o teste acima.
