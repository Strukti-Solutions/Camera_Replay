# Validação na câmera real

Data: 17/10/2026  Câmera: Inova KV-20158  Comando: `py -m replay_worker.smoke --sn <SN> --wait 45`

| Item | Medido | Esperado / ação se diferente |
|---|---|---|
| Relay conecta e fica `online` | online | Se não, anotar o `erro=` |
| fps real | 10 | Usar este valor em `fps` do `h264_to_mp4` |
| Bitrate (Mbps) | 0,14 | Base para o custo de banda 24 h por câmera |
| Intervalo entre keyframes (s) | ~4 | Ideal ~2 s (clipe de 30 a ~32 s); obrigatório < 10 s |
| 1 fatia por quadro (premissa de `split_access_units`) | | Se o clipe sair com imagem quebrada, tratar multi-fatia |
| Duração do clipe (s) | 31,6 | 30 a 32 s |
| Sessão cai sozinha? Depois de quanto tempo | | Define a frequência de reconexão |
| App iCSee aberto derruba o worker? | | Registrar como limitação |
| Latência do relay (s): tempo entre um evento visível e o quadro chegar ao anel | | Cortar até pressed_at + latência no loop de produção |
| Qualidade visual do MP4 (sem distorção, velocidade natural) | MP4 1080p decodifica sem erros | Se rápido/lento, ajustar fps |
| Tamanho do anel (MB) em 40 s | 0,7 | Base de RAM por câmera |

## Câmera Corredor — 17/11/2026

Câmera: Corredor (iCSee/Xiongmai, conta do `config.py`). Captura contínua pelo relay com `CameraCapture` + `Ring` + `process_job` (fila em memória e pasta local, sem Postgres nem R2), corte disparado sob comando.

Status na nuvem no dia: Corredor e fogão a lenha `Online`; Varanda `Offline`.

| Item | Medido | Observação |
|---|---|---|
| Relay conecta e fica `online` | online em ~10 s | Sem erro |
| fps real | 9 a 10 | Igual à Inova |
| Bitrate (Mbps) | 0,86 a 1,36 | Bem acima dos 0,14 da Inova; refazer a conta de banda |
| Intervalo entre keyframes (s) | ~4 | < 10 s |
| Duração do clipe (s) | 32,1 e 30,1 | Primeiro corte 0,1 s acima do teto de 32 s |
| Corte pega o momento pedido | Sim | Ação feita antes do "corta" apareceu no fim do clipe |
| Qualidade visual do MP4 | 1080p, 10 fps, decodifica sem erros, velocidade natural | Conferido pelo dono do projeto |
| Tamanho do clipe | 4,0 e 4,9 MB | Base de armazenamento no R2 |
| Tamanho do anel (MB) em 40 s | 3,9 | Base de RAM por câmera |

Ficou de fora deste teste: fluxo de ponta a ponta (botão → API → fila Postgres → R2 → página do QR), sessão longa e reconexão, app iCSee aberto ao mesmo tempo, várias câmeras no mesmo worker e medida da latência do relay (`RELAY_LAG_S`).

Observações da máquina de bancada: o `py` não estava no PATH (Python em `%LOCALAPPDATA%\Programs\Python\Python312`) e o ffmpeg não estava instalado; o primeiro corte falhou com `ffmpeg não encontrado` até ele ser posto no PATH do processo.
