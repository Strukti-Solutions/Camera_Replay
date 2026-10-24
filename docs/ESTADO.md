# Onde paramos — 23/10/2026 (fase 1 das reservas públicas)

Branch `feat/reservas-publicas`, **sem merge e sem push**. Spec: `docs/superpowers/specs/2026-10-22-reservas-publicas-design.md`.

## Fase 1 feita (login único e conta do jogador)
- Migração 0010: alunos por arena e reservas criadas pelo dono removidos.
- Migração 0011: contas da plataforma (um e-mail = uma conta) e conta do jogador.
- Login único em `/entrar` (jogador, dono e super admin), com limite de tentativas por tipo; qualquer bloqueio responde "credenciais".
- `/criar-conta` (com limite de cadastros por IP), `/termos` (texto provisório), `/minhas-reservas` (vazia até a fase 4) e `/minha-conta` (nome, senha, apagar conta; limite de tentativas na senha atual).
- Esqueci a senha (migração 0012): link de uso único, válido por 1 hora, enviado por e-mail via Resend. Redefinir a senha apaga as falhas de login da conta. Sem configuração fora de produção, o link é impresso no terminal do servidor de desenvolvimento; em produção sem configuração, o link some de `/entrar`.
- Migração 0013: e-mail do dono só em minúsculas (check em `usuarios.email`).
- `conferirSenha` registra no log (sem senha nem hash) quando o próprio scrypt falha.

## Para produção (nesta ordem)
1. **Ok do dono** para subir a fase 1 (a 0010 apaga os alunos e as reservas existentes).
2. Aplicar as migrações 0010 a 0013 no banco de produção: `npx tsx --env-file=C:/Users/anton/replay-producao.env db/migrar-cli.ts`. A 0013 exige e-mail de dono em minúsculas (produção tem 0 donos com maiúscula, conferido).
3. **Logo em seguida**, merge na `main` e push (a Vercel publica em ~2 min). Aceito: nesses poucos minutos o código antigo ainda no ar dá erro na página de quadra do painel (sem usuários reais ainda).
4. Smoke no ar: `/entrar` com o super admin, com o dono e com uma conta nova de jogador; `/criar-conta`; `/minha-conta`.
5. E-mail: conta no Resend, DNS do domínio do remetente (SPF e DKIM) e as variáveis `RESEND_API_KEY` e `EMAIL_REMETENTE` na Vercel (`APP_URL` já está configurada; o link é montado com ela). Depois, um teste real de "Esqueci a senha". **Até lá o link "Esqueci a senha" fica escondido em `/entrar` em produção** (`envioEmailConfigurado` em `app/lib/email.ts`).

## Decisões pendentes do dono
- Confirmação de e-mail no cadastro: hoje a enumeração de contas em `/criar-conta` só é contida pelo limite de tentativas.
- Texto final dos termos: o provisório diz "Não vendemos seus dados" e o dono precisa validar.
- Taxa padrão da Strukti (fase 2).

## Fases seguintes
Fase 2 em diante: ver o spec de reservas públicas. O restante deste arquivo é o estado anterior (17/10), ainda válido onde não conflita com a fase 1; as seções sobre alunos por arena foram superadas.

---

# Onde paramos — 17/10/2026

## Feito
- Planos 1 a 3 (worker de captura, backend, worker em produção) já integrados na `main`, antes desta rodada.
- Plano web (`docs/superpowers/plans/2026-10-17-web.md`) concluído na `feat/web`, **sem push**:
  - Painel do dono: login (com limite de tentativas por conta), quadras, câmera com credenciais cifradas, botões com token mostrado uma única vez, clipes e folha única do QR da arena para imprimir.
  - Alunos e reservas (migrações 0005 e 0006).
  - Página do jogador `/a/<slug-da-arena>` (QR geral da arena, só login: o aluno não se cadastra, o dono cria a conta; `/q/<slug-da-quadra>` redireciona com 308): login do aluno e carrossel coverflow por reserva; "meus lances avulsos"; capa `.jpg` por clipe gerada pelo worker e link de download assinado.
  - Extensão 3 (migração 0007): retenção de no máximo 3 dias (`arenas.dias_retencao` default 3, check 1..3, clipes existentes ajustados). A página do QR não tem lista pública nem cadastro: sem sessão mostra só o formulário de login; o aluno logado vê apenas as próprias reservas ("Olá, <primeiro nome>", "Meus lances avulsos"). Conferido no preview e em build de produção (`next build` + `next start`): token de sessão do aluno, sobrenomes e dados de outros alunos não aparecem no HTML nem no payload RSC.
  - `npm test` com 276 passando; typecheck e build ok.
- Multi-arena (`feat/multi-arena`, migração 0009, **sem push**): super admin com sessão própria (`sessoes_admin`, 12 h; `npm run criar-super-admin -- --email <email>`) e painel `/admin` (criar arena com dono, listar, suspender e reativar com confirmação, novo super admin); arena suspensa (login de dono e aluno recusado, sessões apagadas ao suspender e não revivem ao reativar, o botão não grava aperto, fora da lista pública, `/a/<slug>` mostra o aviso); home `/` "Escolha sua arena" com busca (lista pública em `app/lib/arenas-publicas.ts`, até 50, com aviso quando passa do limite); limite de tentativas por IP agora é por tipo de login (`dono:`, `aluno:`, `admin:`); teste de guarda `tests/isolamento-plataforma.test.ts` (só `app/admin/**` e `db/` importam `plataforma.ts`). `npm test` com 289 passando; typecheck ok; build ok (verificado pelo controlador).
- Conferido em preview ao vivo (Postgres local no Docker): login do dono mantém o e-mail após erro; quadra, câmera, botão, aperto 202 e revogação; contagem de lances do aluno com `[inicio, fim)`; login do aluno abre a própria reserva; reserva de outro mostra "Esta reserva não é sua."; o dono atribui um clipe e o aluno o vê em "Meus lances avulsos".
- Bancada com câmera real (uma câmera, a que o dono liberou; as outras duas ficaram de fora a pedido): relay online, 10 fps, 0,14 Mbps, keyframe a cada ~4 s, anel de 0,7 MB em 40 s, clipe de 31,6 s, MP4 1080p decodifica sem erro, capa gerada. Valores no quadro de `docs/validacao-camera.md`. Testes do worker com ffmpeg real (Docker): 182 passed; integração com Postgres passou.

## Pendências
- Medir ainda: latência do relay (`RELAY_LAG_S`), sessão longa e concorrência com o app iCSee.
- O dono aprovar: textos de interface escritos além dos briefs, o aviso da folha do QR e a decisão de que só aluno com reserva vê clipes.
- Antes do deploy: smoke test do link de download no R2 (`response-content-disposition`); variáveis na Vercel (`DATABASE_URL`, `R2_*`, `CAMERA_CRED_KEY`, `CRON_SECRET`, `APP_URL`); `x-real-ip` na Vercel; `npm run migrar` no banco de produção; TLS e DNS rebinding em `xm/`; escolher o host do worker; na primeira limpeza após o deploy, clipes com 3 a 7 dias serão apagados de vez (consequência da regra de 3 dias — avisar o dono).
- Dívida conhecida (multi-arena): o worker ainda conecta nas câmeras de arenas suspensas (`listar_cameras` não filtra o status; tarefa futura de backend/captura); não há como remover um super admin nem encerrar sessões de admin sem mexer no banco; o CLI `criar-super-admin` pode ecoar a senha no Git Bash/mintty (usar PowerShell ou `winpty`).
- Dívida conhecida: `docs/divida-worker.md`; corrida de sobreposição de reservas (constraint de exclusão com `btree_gist` depois); `atribuirClipe` concorrente pode juntar as duas listas.

## Próximos passos
1. Push da `feat/web` para `origin`, com o ok do dono (`feat/backend` e `feat/worker-producao` já estão na `main`; `feat/backend` foi apagada).
2. Fechar as medições pendentes na câmera real.
3. Deploy (Vercel e host do worker) depois da lista "Antes do deploy".

## Time no Maestri (workspace "goToguether", terminais com `--dir C:\Codes\Camera_Replay`)
- Vigia (Revisor Replay, Opus), Lupa (QA Replay), Prancheta (Backlog Replay, dona da nota `backlog-replay`), Trilho (Dev Captura, standby).
- Os agentes de subprojeto ficam em `.claude/agents/`: captura, backend, web, revisao.
