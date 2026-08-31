# Checklist de teste em dois computadores

Registre data, versão do instalador e rede usada em cada execução.

Repita os cenários misturando os clientes: Electron → web, web → Electron e web → web. Participantes com o mesmo código ou link devem entrar na mesma sala.

## Fluxos obrigatórios

- [ ] A cria a sala, B entra e ambos aparecem na lista.
- [ ] Abrir `https://SEU_HOST/CODIGO` no navegador exibe o convite correto.
- [ ] **Copiar link** produz uma URL que abre a mesma sala em outro computador.
- [ ] A compartilha o monitor; B recebe vídeo; A para; o vídeo some em B.
- [ ] A compartilha uma janela e fecha essa janela; os dois clientes voltam ao estado inativo.
- [ ] A e B compartilham ao mesmo tempo; C assiste aos dois streams.
- [ ] B entra somente para assistir, sem permissão de captura, e recebe uma tela já publicada.
- [ ] Repetir iniciar/parar tela com e sem áudio; não devem sobrar telas congeladas nem áudio antigo.
- [ ] Entrar em outra sala não mostra participantes ou telas da primeira.
- [ ] A rede é interrompida brevemente; a interface mostra reconexão e volta sem reiniciar.
- [ ] Após reconectar, uma captura ainda ativa é republicada e as telas remotas voltam.
- [ ] Fechar o cliente sem sair remove sua presença em até dois minutos, mais o intervalo de atualização.
- [ ] Reiniciar a API encerra o acesso anterior e para a captura local; entrar novamente funciona.
- [ ] Cancelar o seletor não mostra erro e permite tentar novamente.
- [ ] Cancelar o seletor nativo do navegador volta ao estado inativo sem erro permanente.
- [ ] Com áudio desligado, nenhum áudio remoto toca.
- [ ] Com áudio ligado no Windows, B escuta o sistema e o áudio para junto com o vídeo.
- [ ] Se o navegador bloquear reprodução automática, **Ativar áudio** permite escutar o compartilhamento.
- [ ] Quando o navegador não oferece áudio para a fonte escolhida, o vídeo continua e a interface informa que está sem áudio.

## Qualidade

Teste `1080p15` e `1080p30`, anotando:

| Item | Computador A | Computador B |
|---|---:|---:|
| CPU do Electron | | |
| GPU | | |
| Upload/download | | |
| Tempo até o primeiro frame | | |
| Reconexões | | |

O teste fora da mesma LAN é obrigatório antes de distribuir o MVP.

## Cloudflare SFU

- [ ] `.env` tem `CLOUDFLARE_SFU_APP_ID` e `CLOUDFLARE_SFU_APP_SECRET` válidos; não há segredos no build web/Electron.
- [ ] `GET /health` informa `cloudflare-sfu`; isso não substitui o teste de mídia real.
- [ ] Rede restritiva com TURN configurado recebe vídeo/áudio; credenciais permanentes não aparecem nas respostas da API.
- [ ] Atualizar API, web e Electron juntos; clientes anteriores não usam o novo protocolo.
- [ ] Registrar resolução, frames recebidos/descartados e bitrate em WebRTC internals para os dois perfis.
