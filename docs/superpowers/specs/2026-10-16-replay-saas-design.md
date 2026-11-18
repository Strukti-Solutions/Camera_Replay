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
| Acesso do jogador | **Um QR por arena** (`/a/<slug-da-arena>`). A página do QR não lista nada em público: sem login é só a tela de entrar; o **aluno** entra com o e-mail e a senha que o dono cadastrou e vê só as reservas e os lances dele, em todas as quadras da arena. Os lances ficam disponíveis no máximo 7 dias (padrão e teto) e depois podem ser apagados. Ver "Reservas e alunos". |
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
6. **Privacidade.** Quem tem o QR não vê reserva, horário nem nome de ninguém; reservas e lances exigem login do aluno, e cada aluno vê só os dele. O `slug` é longo e aleatório. A quadra precisa de aviso de gravação.

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
| `arenas` | id, nome, plano, status da assinatura (`ativa` ou `suspensa`), `dias_retencao` (int, padrão 7, entre 1 e 7) |
| `usuarios` | id, arena_id, e-mail, hash da senha, papel |
| `quadras` | id, arena_id, nome, `slug` público aleatório |
| `cameras` | id, quadra_id, nome, SN, credenciais cifradas, status, última vez visto |
| `botoes` | id, quadra_id, camera_id, hash do token, última vez visto, `revogado_em` |
| `apertos` | id, botao_id, `recebido_em`, status |
| `clipes` | id, `arena_id`, aperto_id, `camera_id`, chave no R2, duração, tamanho, `expira_em`, `motivo`, `iniciado_em`, status (`pendente`, `processando`, `pronto`, `parcial`, `falhou`) |

Toda tabela filha carrega `arena_id` e toda consulta filtra por ele (isolamento entre arenas).

**Câmera presa à quadra.** No piloto, cada quadra tem uma câmera e um botão ligados entre si. `cameras.quadra_id` não muda depois de criada: o banco recusa o UPDATE. A página da quadra acha os clipes pela quadra da câmera, então mover uma câmera levaria os lances antigos para o QR de outra quadra. Para mudar a câmera de lugar, a gente reconfigura à mão: cria uma câmera nova na quadra certa e religa o botão. O painel do dono não oferece essa troca.

`cameras.credenciais` é um texto no formato `v1:<iv>:<tag>:<cifra>`, com cada parte em base64. A cifra é AES-256-GCM sobre o JSON `{"authcode","local_user","local_pwd"}`. A `<cifra>` não inclui a tag (na `cryptography` do Python, decifre `cifra || tag`). A chave vem de `CAMERA_CRED_KEY`: base64 canônico de exatamente 32 bytes, compartilhado entre o app e o worker.

`clipes.motivo` guarda a causa quando o status é `falhou`. `clipes.iniciado_em` guarda o instante em que o worker pegou o clipe (status `processando`).

## Fluxo do aperto ao vídeo

1. O ESP32 faz `POST /api/botao/aperto` com o token. A API valida, grava o aperto e um clipe `pendente` e responde 202.
2. O worker consulta a fila a cada ~1 s e pega o clipe da câmera que ele atende.
3. Ele corta o anel do keyframe anterior a `recebido_em − 30 s` até `recebido_em` e gera o MP4 com `ffmpeg -c copy`. O clipe tem de 30 a ~32 s.
4. Envia o MP4 ao R2 e marca o clipe como `pronto`, com tamanho e duração.
5. O jogador abre `/a/<slug-da-arena>` (as rotas antigas `/q/<slug-da-quadra>` redirecionam para a arena da quadra) e cai na tela de entrar; o aluno entra e vê só as reservas dele, de todas as quadras, e os lances `prontos`/`parcial` não expirados da reserva dele. O player usa URL assinada curta.
6. Um job de limpeza apaga, no R2 e no banco, os clipes expirados.

### Contrato da fila

O app e o worker usam estas funções SQL. Não há outro caminho entre os dois.

- `registrar_aperto(token_hash text) → (clipe_id uuid, duplicado bool)`. Não retorna linha se o token é inválido ou foi revogado. Aperto duplo (< 5 s no mesmo botão) retorna o clipe existente com `duplicado = true`.
- `pegar_clipes(camera_id uuid, limite int) → setof (clipe_id uuid, camera_id uuid, arena_id uuid, recebido_em timestamptz)`. Passa os clipes `pendente` para `processando`, com `FOR UPDATE SKIP LOCKED`, e devolve em ordem de `recebido_em` (o mais antigo primeiro). O `arena_id` vem do banco para o worker montar a chave no R2 sem depender da configuração local.
- `marcar_pronto(clipe_id, chave text, tamanho bigint, duracao real, parcial bool) → bool`. Só age sobre `processando`. Grava `pronto`, ou `parcial` se `parcial = true`. A chave tem de ser exatamente `clipes/<arena_id do clipe>/<clipe_id>.mp4`. Outra chave lança erro (SQLSTATE `22023`, `invalid_parameter_value`) em vez de devolver `false`, porque é bug do worker e não pode ser confundida com "o reaper chegou antes".
  - Capa opcional em `clipes/<arena_id>/<clipe_id>.jpg`, enviada pelo worker antes de `marcar_pronto`. Não há coluna nova: a página tenta a capa e cai num fundo neutro se ela não existir. A limpeza e "apagar clipe" removem o `.mp4` e o `.jpg` (DELETE no R2 aceita 404). O link de download é uma URL assinada do `.mp4` com `response-content-disposition=attachment`.
- `marcar_falhou(clipe_id, motivo text) → bool`. Só age sobre `processando`.
- `expirar_presos() → int`. Marca como `falhou` os clipes presos em `pendente` ou `processando` há mais de 2 minutos desde `recebido_em` e retorna quantos foram.
- `listar_cameras() → setof (camera_id uuid, arena_id uuid, sn text, credenciais text)`. Só câmeras com pelo menos um botão ativo (`botoes.revogado_em is null`). No fluxo manual de troca de câmera o botão é religado à nova, então a antiga sai da lista e o mesmo `sn` não abre duas conexões. As credenciais voltam cifradas (`v1:...`); o worker decifra com a chave do ambiente.
- `marcar_camera(camera_id uuid, status text) → bool`. Grava `status` (`online` ou `offline`); com `online` grava também `visto_em = now()`. Devolve `false` se a câmera não existe. Outro status é recusado pelo check da tabela.

O worker usa `clock_timestamp()` do banco como relógio de referência.

Chave no R2: `clipes/<arena_id>/<clipe_id>.mp4`.

## Painel do dono

> **Nota (fase 1, 22/10/2026):** esta seção foi superada em parte por `docs/superpowers/specs/2026-10-22-reservas-publicas-design.md`. Alunos por arena e reservas criadas pelo dono foram removidos (migração 0010); o login agora é único em `/entrar` (jogador, dono e super admin). Em conflito, vale o spec novo.
Migração `0005_painel.sql`. O painel é a única parte com login.

**Tabelas novas**

- `sessoes (id, arena_id, usuario_id, token_hash unique, criado_em, expira_em)`, com FK composta `(usuario_id, arena_id)` para `usuarios (id, arena_id)` e `on delete cascade`.
- `tentativas_login (id, email, ip, em)`, com índices em `(email, em)` e `(ip, em)`. Registra falhas de login. **Exceção à regra do `arena_id`:** é anterior ao login e ainda não há arena conhecida.
- `cameras.criado_em` e `botoes.criado_em` (`timestamptz not null default now()`).

**Regras**

- Sessão de 7 dias, sem renovação, em cookie HttpOnly. O banco guarda só o hash do token da sessão. Sair apaga a linha.
- Limite de login: 5 falhas por e-mail e 20 por IP em 15 minutos. Passou disso, o login é recusado até a janela esvaziar.
- Senha com scrypt (`scrypt$32768$8$1$<sal>$<hash>`, sal de 16 bytes, comparação em tempo constante). Hash malformado conta como senha errada.
- Câmera **online** no painel = `status = 'online'` e `visto_em` com menos de 60 s. Worker parado não deixa câmera "online".
- Uma câmera por quadra no painel: cadastrar só aparece se a quadra não tem câmera. Troca continua manual.
- O token do botão aparece uma única vez, na criação. O banco guarda só o hash.
- Conta de dono criada por nós (`npm run criar-dono`); papel `equipe` tem o mesmo acesso de `dono` na v1.
- `APP_URL`: URL pública do site, sem barra no fim, usada no QR.
- Toda consulta do painel filtra por `arena_id` vindo da sessão. Id de outra arena se comporta como inexistente.

## Reservas e alunos

> **Nota (fase 1, 22/10/2026):** esta seção foi superada em parte por `docs/superpowers/specs/2026-10-22-reservas-publicas-design.md`. Alunos por arena e reservas criadas pelo dono foram removidos (migração 0010); o login agora é único em `/entrar` (jogador, dono e super admin). Em conflito, vale o spec novo.
Migração `0006_reservas.sql`. O dono cadastra alunos e reservas; o aluno vê os lances das reservas dele.

**Tabelas novas** (todas com `arena_id` e FKs compostas `(…, arena_id)`)

- `alunos (id, arena_id, nome, email, senha_hash, criado_em)`, `unique (arena_id, email)` e `unique (id, arena_id)`. O mesmo e-mail em outra arena é outra conta.
- `reservas (id, arena_id, quadra_id, inicio, fim, criado_em)`, `check (fim > inicio and fim - inicio <= interval '12 hours')`, `unique (id, arena_id)`, FK `(quadra_id, arena_id)` para `quadras`.
- `reserva_alunos (reserva_id, aluno_id, arena_id)`, pk `(reserva_id, aluno_id)`, FKs compostas com `on delete cascade`.
- `clipe_alunos (clipe_id, aluno_id, arena_id)`, pk `(clipe_id, aluno_id)`: atribuição explícita de um lance a um aluno; FKs compostas com `on delete cascade`.
- `sessoes_aluno`: no molde de `sessoes`, com FK `(aluno_id, arena_id)` para `alunos` e `on delete cascade`.

**Regras**

- Reservas da mesma quadra não se sobrepõem (`inicio < outro.fim and fim > outro.inicio`); reservas encostadas (fim = início do próximo) são aceitas. Duração máxima de 12 horas. Ao criar ou editar, toda reserva tem pelo menos um aluno. Remover um aluno não apaga a reserva: ela fica sem alunos, continua visível no painel (com os lances) e deixa de aparecer para qualquer aluno.
- E-mail do aluno é normalizado (trim, minúsculas). Senha com 8 ou mais caracteres, guardada com o mesmo scrypt do dono. Redefinir a senha apaga as sessões do aluno. Remover o aluno o tira das reservas e das atribuições.
- Acesso do aluno a um lance: o lance está `pronto`/`parcial`, não expirado e (a) `recebido_em` está em `[inicio, fim)` (intervalo semiaberto: o lance exatamente em `fim` pertence à reserva seguinte) de uma reserva da quadra da câmera do lance com o aluno nela, ou (b) há atribuição explícita do lance ao aluno. Tudo filtrado pela arena do slug do QR.
- Sessão do aluno separada da do dono: cookie `replay_aluno` (HttpOnly, SameSite Lax, 7 dias), presa à arena. Limite de tentativas igual ao do dono (reusa `tentativas_login`).
- Sem lista pública: o aluno logado vê só as reservas em que está, de todas as quadras da arena do QR (cada uma com o nome da quadra), com pelo menos um lance pronto e dentro da retenção; nenhum nome de outro aluno é exposto. Lance fora de qualquer reserva só o dono vê, e ele pode atribuí-lo a alunos.
- **Slug da arena e QR geral** (migração `0008_arena_slug.sql`): `arenas.slug` (texto, único, formato `[A-Za-z0-9_-]{20,64}`, aleatório de 22 caracteres via `novoSlug()`; as arenas já existentes recebem um slug de 32 caracteres hexadecimais). O QR geral abre `/a/<slug-da-arena>`, que só oferece login. **Não há cadastro pelo aluno:** só o dono cria contas de aluno no painel e atribui reservas e lances; o aluno apenas entra para ver as partidas dele. `/q/<slug-da-quadra>` e as subrotas antigas respondem com redirecionamento 308 para a arena da quadra. O painel tem uma folha única para imprimir, com o QR da arena. As chaves de login seguem `aluno:<arena_id>:<email>`.
- Contagem de lances de uma reserva: clipes de câmeras da quadra da reserva, `pronto`/`parcial`, não expirados, com `recebido_em` em `[inicio, fim)`.
- As funções de `alunos.ts` e `reservas.ts` recebem o `arena_id` da sessão, validam uuid (malformado = inexistente) e nunca devolvem `senha_hash`.

## Plataforma e super admin

Várias arenas no mesmo sistema; o aluno escolhe a arena e a equipe Strukti cria e suspende arenas. Migração `0009_super_admin.sql`.

- **Super admin:** tabela `super_admins` (e-mail minúsculo e único, hash scrypt; sem `arena_id`, não pertence a arena) e sessão própria em `sessoes_admin` (só o hash do token, 12 h; cookie `replay_admin`, HttpOnly, Secure em produção, SameSite Strict). Nunca vale como sessão de dono ou aluno, nem o contrário. Limite de tentativas igual ao do dono (5 por e-mail, 20 por IP, 15 min), chave `admin:<email>`. O primeiro vem de `npm run criar-super-admin -- --email <email>` (senha pela entrada padrão, mínimo 12 caracteres); os demais, pelo `/admin`. Super admin não entra no painel de uma arena na v1.
- **Limite por IP por tipo de login:** a contagem por IP considera só as chaves do mesmo tipo (`dono:`, `aluno:` ou `admin:`). Alunos errando a senha no Wi-Fi da arena não travam o login do dono nem o do admin; o limite por e-mail segue por conta.
- **Lista pública** (`app/lib/arenas-publicas.ts`, fora da guarda): `listarArenasPublicas` devolve só nome e slug das arenas ativas, até 50, com busca por trecho do nome.
- **Funções de administração** (`app/lib/plataforma.ts`) cruzam arenas: `listarArenasAdmin`, `criarArenaAdmin` (arena e dono num comando só; e-mail de dono já usado falha sem criar nada), `definirStatusArena`, `criarSuperAdmin`. Só `app/admin/**` (e os CLIs de `db/`) importam o módulo, e as páginas e actions de `/admin` chamam depois de `exigirSuperAdmin()`; `tests/isolamento-plataforma.test.ts` garante.
- **Arena suspensa** (`arenas.status_assinatura` com check `ativa`/`suspensa`; valores antigos viraram `ativa`): some da lista pública; o login do dono e do aluno responde `suspensa` (só a quem acertou a senha); as sessões abertas de dono e aluno deixam de valer na próxima validação, porque a sessão é conferida contra o estado da arena; `registrar_aperto` não grava nada e responde como token inválido. Suspender apaga as sessões de dono e de aluno da arena; o resto só deixa de valer e nada é apagado além do que já expiraria pela retenção de 7 dias. Reativar devolve tudo, exceto as sessões: dono e alunos entram de novo. `/a/<slug>` de arena suspensa mostra o aviso de suspensão publicamente (o nome da arena já é público).

## Interface do buffer

`Buffer.append(chunk, t)` e `Buffer.cut(t, 30s)`. O anel é uma implementação. Trocar por segmentos em disco (abordagem B) não deve mexer no restante do worker.

## Erros e resiliência

- Reconexão do worker com backoff (1, 2, 4… até 60 s). Câmera `offline` após ~30 s sem vídeo.
- Aperto durante um buraco do anel: clipe `parcial`, com a duração real.
- Upload ao R2: 3 tentativas, depois `falhou`.
- Clipe `pendente` ou `processando` há mais de 2 minutos (contados de `recebido_em`): `falhou`.
- Câmera offline no aperto: `falhou`, com o motivo visível no painel.
- Alerta de câmera offline por e-mail ou WhatsApp: fora da v1. O status aparece no painel.

## Segurança e LGPD

- Credenciais das câmeras cifradas no banco. A chave fica só no ambiente do app e do worker. O `config.py` com segredos continua fora do git.
- Token do botão por dispositivo, revogável (`botoes.revogado_em`), guardado como hash. Token revogado não registra aperto.
- Credenciais no formato `v1:<iv>:<tag>:<cifra>` (AES-256-GCM). O prefixo `v1` permite trocar o formato depois.
- Retenção por arena em `arenas.dias_retencao` (padrão e teto de 7 dias, migração `0024_retencao_7_dias.sql`, decisão do Thiago em 26/10: o lance fica 7 dias, como diz o vídeo do replay; todas as arenas passaram a 7 e os lances ainda guardados ganharam o prazo de 7 dias desde o aperto. Antes, a `0007_retencao_3_dias.sql` tinha travado em 3). A chave do clipe no R2 inclui o `arena_id`.
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

Contas de jogador além dos alunos cadastrados pelo dono, alerta de câmera offline, cobrança automática, firmware, estacionamento inteligente.

## Pendências

- Nome e criação do repositório novo.
- Host do worker.
- Provedor de cobrança.
- Valores de expiração por plano.
