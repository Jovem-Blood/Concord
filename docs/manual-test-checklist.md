# Checklist de teste em dois computadores

Registre data, versão do instalador e rede usada em cada execução.

## Fluxos obrigatórios

- [ ] A cria a sala, B entra e ambos aparecem na lista.
- [ ] A compartilha o monitor; B recebe vídeo; A para; o vídeo some em B.
- [ ] A compartilha uma janela e fecha essa janela; os dois clientes voltam ao estado inativo.
- [ ] A e B compartilham ao mesmo tempo; C assiste aos dois streams.
- [ ] A rede é interrompida brevemente; a interface mostra reconexão e volta sem reiniciar.
- [ ] Cancelar o seletor não mostra erro e permite tentar novamente.
- [ ] Com áudio desligado, nenhum áudio remoto toca.
- [ ] Com áudio ligado no Windows, B escuta o sistema e o áudio para junto com o vídeo.

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
