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
- [ ] Envie mensagens nos dois sentidos. Reconecte e confirme que as mensagens
      antigas são apagadas.
- [ ] Interrompa a rede brevemente e restabeleça a conexão. Confira a recuperação;
      depois saia da sala e confirme que microfone e capturas são encerrados.
- [ ] Copie um convite nos clientes web e desktop e abra-o no outro dispositivo.
- [ ] Confira a página inicial e a sala no celular e no desktop, incluindo foco de
      teclado, controles legíveis e mensagens de erro de permissão.
- [ ] Para uma release, instale e abra os builds NSIS no Windows e AppImage no Linux;
      confira as atualizações separadamente dos ZIPs portáteis.

Conectividade que exige relay TURN ainda não é suportada. Registre essa restrição
de rede separadamente de uma regressão.
