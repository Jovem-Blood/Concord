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
