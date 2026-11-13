# Atraso acumulado do relay — diagnóstico RETIRADO

Data: 12–13/11/2026. Frente: `captura` (`worker/`). **Status: descartado, nada a implementar.**

## O que parecia (bancada de 12/11)

Na câmera Varanda, a hora gravada na imagem (OSD) e o carimbo XM dos I-frames (cabeçalho
`00 00 01 FC`, hora local com resolução de 1 s) ficavam cada vez mais atrás da hora de chegada no
worker: ~0,24 s por segundo, até dezenas de segundos. Os clipes do ponta a ponta pareciam terminar
17–30 s antes do aperto. Daí a hipótese de uma fila crescendo no relay ou na câmera.

## O que é de verdade (13/11)

**O relógio da Varanda é que anda errado, não o vídeo.** Experimento decisivo
(`sonda_fila_ou_relogio`, só leitura): conexão A recebe o vídeo; conexão B consulta a hora da
câmera (`OPTimeQuery`) a cada 3 s, ao mesmo tempo.

| t (s) | atraso contra o relógio do início | atraso contra o relógio lido na hora |
|---|---|---|
| 1 | 0,4 | 0,2 |
| 41 | 9,2 | 0,4 |
| 105 | 23,1 | 1,4 |
| 113 | −3,9 (o relógio saltou para frente) | −0,1 |

- Durante a transmissão o relógio da Varanda perde ~0,25 s por segundo e depois se corrige
  aos saltos. Sem vídeo, perde menos (~3 s em 90 s). O relógio da Fogão é estável.
- O atraso real da entrega fica em **0–1,6 s** o tempo todo. O `RELAY_LAG_S` fixo está certo.
- O OSD da imagem usa o mesmo relógio: medir o clipe pela hora gravada na imagem engana nesta câmera.

## Decisão

- A correção implementada (estimador por carimbo, consulta de hora, reconexão por atraso) foi
  **revertida antes de qualquer commit**. Ela piorava os clipes: compensava um atraso que não existe
  e, no salto do relógio, media atraso negativo.
- O worker continua cortando pela hora de chegada, que é a referência correta.
- Validação de clipe em bancada: medir pela hora de chegada / evento físico na cena, nunca pelo OSD.
- Pendência para o dono: câmeras com relógio instável (NTP) devem ser revisadas na instalação. Não
  afeta o corte, só a hora mostrada na imagem.
