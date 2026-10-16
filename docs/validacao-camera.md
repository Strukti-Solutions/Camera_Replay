# Validação na câmera real

Data: ____  Câmera: Inova KV-20158 (SN ____)  Comando: `py -m replay_worker.smoke --sn ____ --wait 45`

| Item | Medido | Esperado / ação se diferente |
|---|---|---|
| Relay conecta e fica `online` | | Se não, anotar o `erro=` |
| fps real | | Usar este valor em `fps` do `h264_to_mp4` |
| Bitrate (Mbps) | | Base para o custo de banda 24 h por câmera |
| Intervalo entre keyframes (s) | | Deve ser menor que 10 s para o anel de 40 s sempre ter keyframe |
| 1 fatia por quadro (premissa de `split_access_units`) | | Se o clipe sair com imagem quebrada, tratar multi-fatia |
| Duração do clipe (s) | | 30 a 32 s |
| Sessão cai sozinha? Depois de quanto tempo | | Define a frequência de reconexão |
| App iCSee aberto derruba o worker? | | Registrar como limitação |
