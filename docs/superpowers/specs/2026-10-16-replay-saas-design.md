# Replay para quadras: SaaS de captura e entrega de lances (design)

**Data:** 16/10/2026
**Status:** aguardando revisão do grupo
**Base:** `camera/` (cliente Xiongmai/iCSee), `docs/bancada/README.md` (envio ao R2) e `docs/superpowers/specs/2026-10-08-bancada-envio-pela-pi-design.md`.

## Objetivo

O jogador aperta um botão na beira da quadra. O sistema salva os **últimos 30 segundos** da câmera daquela quadra e o vídeo fica disponível numa página do site, aberta pelo celular via QR code, para assistir depois. O produto é vendido como SaaS para donos de arenas.

## Decisões tomadas

| Tema | Decisão |
|---|---|
| Onde roda o buffer de 30 s | **Na nuvem**, num worker 24 h que puxa o vídeo de cada câmera pelo relay do fabricante. |
| Estrutura do buffer | **Anel de H.264 em memória** por câmera (~40 s), cortado com `ffmpeg -c copy`. |
| Botão | **ESP32 no Wi-Fi da arena**, com HTTPS POST e token por dispositivo. |
| Acesso do jogador | **QR por quadra, sem cadastro e sem login.** Clipes expiram (padrão 7 dias). |
| Cliente pagante | Dono da arena. Multi-arena desde o início, com painel e cobrança. |
| Cobrança | Provedor **a decidir** (Asaas ou Stripe). Fica atrás de uma interface. Último subprojeto. |
| Repositório | **Repo novo e separado** (nome sugerido: `strukti-replay`). O site da Strukti só linka para ele. |
| Host do worker | **A decidir** (container no Fly.io/Railway ou VPS), conforme custo e banda por câmera. |
| Aperto duplo | Dois apertos do mesmo botão com menos de ~5 s de intervalo viram um só. |

## Riscos conhecidos

1. **Dependência do relay do fabricante.** O acesso remoto vem de engenharia reversa (`camera/docs/PROTOCOL.md`). O fabricante pode mudar o protocolo. Plano B: o cliente local em `camera.py` (DVRIP na LAN) atrás de um gateway na arena. A interface da fonte de vídeo deve permitir trocar a origem sem mexer no anel.
2. **Conexões simultâneas.** A câmera pode limitar conexões. Se o dono abrir o app iCSee, o worker pode ser derrubado. A reconexão automática é requisito.
3. **Banda e custo 24 h por câmera.** Medir o bitrate real do stream principal antes de escolher o host.
4. **Tempo do vídeo.** O H.264 cru não tem timestamp. Usar a hora de chegada e o fps declarado, e validar na câmera real.
5. **Sem cliente nem quadra instalada** (`CLAUDE.md`). A cobrança automática é o item de menor evidência de necessidade. Por isso fica por último.
6. **Privacidade.** Quem tem o QR vê todos os lances recentes da quadra. O `slug` é longo e aleatório. A quadra precisa de aviso de gravação.

## Arquitetura

```
[ESP32 + botão] --HTTPS POST--> [App Next.js: API] --> [Postgres] <--> [Worker de captura] <--relay--> [Câmera]
                                                                              |
                                                                              v
[Site do jogador / Painel do dono] <--URL assinada-- [Cloudflare R2] <-- MP4
```

Componentes:

1. **App web** (Next.js, Vercel): API do botão, site do jogador, painel do dono.
2. **Worker de captura** (Python, container 24 h): reaproveita `camera.py`, `xmremote.py`, `xmcloud.py` e `xmcrypto.py`. Uma conexão e um anel por câmera.
3. **Postgres**: arenas, quadras, câmeras, botões, apertos, clipes.
4. **R2**: MP4 privados, URLs assinadas e expiração.
5. **Firmware do ESP32**: lê o botão e faz o POST.
6. **Cobrança**: interface com implementação trocável.

O app e o worker se comunicam **pelo Postgres** (fila de clipes `pendente`), nunca por HTTP direto. O worker não expõe porta e pode reiniciar sem perder pedidos.

O aperto grava o **instante do servidor** (`recebido_em`), não o do ESP32.

## Dados

| Tabela | Campos principais |
|---|---|
| `arenas` | id, nome, plano, status da assinatura, `dias_retencao` (int, padrão 7) |
| `usuarios` | id, arena_id, e-mail, hash da senha, papel |
| `quadras` | id, arena_id, nome, `slug` público aleatório |
| `cameras` | id, quadra_id, nome, SN, credenciais cifradas, status, última vez visto |
| `botoes` | id, quadra_id, camera_id, hash do token, última vez visto, `revogado_em` |
| `apertos` | id, botao_id, `recebido_em`, status |
| `clipes` | id, `arena_id`, aperto_id, `camera_id`, chave no R2, duração, tamanho, `expira_em`, `motivo`, `iniciado_em`, status (`pendente`, `processando`, `pronto`, `parcial`, `falhou`) |

Toda tabela filha carrega `arena_id` e toda consulta filtra por ele (isolamento entre arenas).

`cameras.credenciais` é um texto no formato `v1:<iv>:<tag>:<cifra>`, com cada parte em base64. A cifra é AES-256-GCM sobre o JSON `{"authcode","local_user","local_pwd"}`.

`clipes.motivo` guarda a causa quando o status é `falhou`. `clipes.iniciado_em` guarda o instante em que o worker pegou o clipe (status `processando`).

## Fluxo do aperto ao vídeo

1. O ESP32 faz `POST /api/botao/aperto` com o token. A API valida, grava o aperto e um clipe `pendente` e responde 202.
2. O worker consulta a fila a cada ~1 s e pega o clipe da câmera que ele atende.
3. Ele corta o anel do keyframe anterior a `recebido_em − 30 s` até `recebido_em` e gera o MP4 com `ffmpeg -c copy`. O clipe tem de 30 a ~32 s.
4. Envia o MP4 ao R2 e marca o clipe como `pronto`, com tamanho e duração.
5. O jogador abre `/q/<slug>` e vê os lances `prontos` e não expirados. O player usa URL assinada curta.
6. Um job de limpeza apaga, no R2 e no banco, os clipes expirados.

### Contrato da fila

O app e o worker usam estas funções SQL. Não há outro caminho entre os dois.

- `registrar_aperto(token_hash text) → (clipe_id uuid, duplicado bool)`. Não retorna linha se o token é inválido ou foi revogado. Aperto duplo (< 5 s no mesmo botão) retorna o clipe existente com `duplicado = true`.
- `pegar_clipes(camera_id uuid, limite int) → setof (clipe_id uuid, camera_id uuid, recebido_em timestamptz)`. Passa os clipes `pendente` para `processando`, com `FOR UPDATE SKIP LOCKED`.
- `marcar_pronto(clipe_id, chave text, tamanho bigint, duracao real, parcial bool) → bool`. Só age sobre `processando`. Grava `pronto`, ou `parcial` se `parcial = true`.
- `marcar_falhou(clipe_id, motivo text) → bool`. Só age sobre `processando`.
- `expirar_presos() → int`. Marca como `falhou` os clipes presos em `pendente` ou `processando` além do limite e retorna quantos foram.

Chave no R2: `clipes/<arena_id>/<clipe_id>.mp4`.

## Interface do buffer

`Buffer.append(chunk, t)` e `Buffer.cut(t, 30s)`. O anel é uma implementação. Trocar por segmentos em disco (abordagem B) não deve mexer no restante do worker.

## Erros e resiliência

- Reconexão do worker com backoff (1, 2, 4… até 60 s). Câmera `offline` após ~30 s sem vídeo.
- Aperto durante um buraco do anel: clipe `parcial`, com a duração real.
- Upload ao R2: 3 tentativas, depois `falhou`.
- Clipe `pendente` há mais de 2 minutos: `falhou`.
- Câmera offline no aperto: `falhou`, com o motivo visível no painel.
- Alerta de câmera offline por e-mail ou WhatsApp: fora da v1. O status aparece no painel.

## Segurança e LGPD

- Credenciais das câmeras cifradas no banco. A chave fica só no ambiente do app e do worker. O `config.py` com segredos continua fora do git.
- Token do botão por dispositivo, revogável (`botoes.revogado_em`), guardado como hash. Token revogado não registra aperto.
- Credenciais no formato `v1:<iv>:<tag>:<cifra>` (AES-256-GCM). O prefixo `v1` permite trocar o formato depois.
- Retenção por arena em `arenas.dias_retencao` (padrão 7 dias). A chave do clipe no R2 inclui o `arena_id`.
- Login do dono com hash forte de senha e limite de tentativas.
- Bucket privado, URLs assinadas e curtas.
- Não há dados de jogador. O vídeo mostra pessoas: a quadra precisa de aviso de gravação, que entra como requisito de implantação e nos termos de uso.

## Testes

- **Anel:** H.264 sintético; corte no keyframe, buracos, anel vazio.
- **API:** token inválido, aperto duplo, isolamento entre arenas.
- **Worker:** integração com câmera simulada (arquivo H.264 transmitido como stream).
- **Câmera real:** roteiro manual na Inova KV-20158 para validar a sincronia e o fps.

## Subprojetos e agentes

| # | Subprojeto | Agente |
|---|---|---|
| 1 | Worker de captura | **Captura** |
| 2 | API e dados | **Backend** |
| 3 | Armazenamento e entrega | **Backend** |
| 4 | Site do jogador | **Web** |
| 5 | Painel do dono | **Web** |
| 6 | Cobrança | depois, quando houver cliente |
| 7 | Firmware do ESP32 | depois, quando houver hardware |
| — | Revisão e segurança de cada entrega | **Revisão** |

Ordem inicial: o agente de Captura valida a câmera real (maior risco) enquanto o Backend monta o schema e a API.

## Fora do escopo da v1

Contas de jogador, alerta de câmera offline, cobrança automática, firmware, estacionamento inteligente.

## Pendências

- Nome e criação do repositório novo.
- Host do worker.
- Provedor de cobrança.
- Valores de expiração por plano.
