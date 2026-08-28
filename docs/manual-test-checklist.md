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
- [ ] A rede é interrompida brevemente; a interface mostra reconexão e volta sem reiniciar.
- [ ] Cancelar o seletor não mostra erro e permite tentar novamente.
- [ ] Cancelar o seletor nativo do navegador volta ao estado inativo sem erro permanente.
- [ ] Com áudio desligado, nenhum áudio remoto toca.
- [ ] Com áudio ligado no Windows, B escuta o sistema e o áudio para junto com o vídeo.
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
