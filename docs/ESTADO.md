# Onde paramos — 24/10/2026 (fases 1 a 3 no ar, fase 4a pronta sem merge)

Fase 4a na branch `feat/fase4a-reservas`, **sem merge e sem push**. Fases 1 a 3 **no ar**: migrações até a 0015 aplicadas, `main` 1e90ae3 em camera-replay.vercel.app. Spec: `docs/superpowers/specs/2026-10-22-reservas-publicas-design.md`.

## Fase 1 feita e no ar (login único e conta do jogador)
- Migração 0010: alunos por arena e reservas criadas pelo dono removidos.
- Migração 0011: contas da plataforma (um e-mail = uma conta) e conta do jogador.
- Login único em `/entrar` (jogador, dono e super admin), com limite de tentativas por tipo; qualquer bloqueio responde "credenciais".
- `/criar-conta` (com limite de cadastros por IP), `/termos` (texto provisório), `/minhas-reservas` (vazia até a fase 4) e `/minha-conta` (nome, senha, apagar conta; limite de tentativas na senha atual).
- Esqueci a senha (migração 0012): link de uso único, válido por 1 hora, enviado por e-mail via Resend. Redefinir a senha apaga as falhas de login da conta. Sem configuração fora de produção, o link é impresso no terminal do servidor de desenvolvimento; em produção sem configuração, o link some de `/entrar`.
- Migração 0013: e-mail do dono só em minúsculas (check em `usuarios.email`).
- `conferirSenha` registra no log (sem senha nem hash) quando o próprio scrypt falha.

## Ainda pendente da fase 1
- E-mail (25/10): envio pelo SMTP do Gmail da Strukti (spec `docs/superpowers/specs/2026-10-25-emails-design.md`). Variáveis `SMTP_USUARIO` e `SMTP_SENHA` (senha de app) na Vercel; sem elas o "Esqueci a senha" fica escondido em produção (`envioEmailConfigurado` em `app/lib/email.ts`). Limite do Gmail: ~500 e-mails/dia.

## Decisões pendentes do dono
- Confirmação de e-mail no cadastro: hoje a enumeração de contas em `/criar-conta` só é contida pelo limite de tentativas.
- Texto final dos termos: o provisório diz "Não vendemos seus dados" e o dono precisa validar.
- Taxa padrão da Strukti: decidida em 5% (23/10), ajustável por arena.

## Fases seguintes
Fase 4 em diante: ver o spec de reservas públicas. Mais abaixo, o histórico de 17/10 continua válido onde não foi resolvido; as seções sobre alunos por arena foram superadas.

## Fase 2 feita e NO AR (Strukti cria, dono ajusta)
No ar desde 23/10: migração 0014 aplicada em produção, `main` 7cd5d76.
- Migração 0014: endereço e coordenadas da arena, taxa da Strukti por arena (padrão 5%, decisão do dono em 23/10), esporte da quadra e tabela de preços.
- Strukti (super admin) em `/admin/arenas/<id>`: cria e renomeia quadras, cadastra câmeras e credenciais, cria e revoga botões, define a taxa (0 a 30%).
- Dono no painel: não cria mais quadras, câmeras nem botões. Em `/painel/arena` ajusta nome e endereço (geocodificado; se não achar, salva sem coordenadas e avisa). Na página da quadra define nome, esporte e tabela de preços por dia da semana e faixas de hora cheia (sobreposição rejeitada, faixas adjacentes aceitas).
- Nominatim (OpenStreetMap): política de uso de 1 requisição por segundo e User-Agent identificado. Só salvar um endereço chama o serviço; nenhuma outra tela consulta.

## Fase 3 feita e NO AR (busca com mapa)
No ar desde 23/10: migração 0015 aplicada em produção, `main` 1e90ae3.
- Migração 0015: `arenas.geocodificacao_tentada_em`. O geocodificador roda no máximo 1 vez por minuto por arena; barrado pelo limite, o dono lê "salve de novo daqui a 1 minuto" (não "endereço não existe").
- Quadra: nome e esporte salvos num único UPDATE. Botões aparecem só leitura na página da quadra do dono (decisão do dono, 23/10: a Strukti instala os botões).
- Módulo puro de disponibilidade: de hoje até +30 dias, horas cheias, só depois de agora, de 1 a 4 horas, preço por hora.
- Busca pública por nome e endereço, sem diferenciar acento nem maiúscula; sugestões em `GET /api/arenas/sugestoes`.
- Página pública da arena `/a/<slug>`: endereço, "Como chegar", por quadra um formulário GET (dia, início, duração) com total e detalhe por hora; "Reservar" desabilitado na fase 3 (na 4a leva ao resumo).
- Home "Encontre uma quadra": busca, sugestões e mapa Leaflet com OpenStreetMap (botão de tela cheia).
- Nova dependência: `leaflet` 1.9.4 (e `@types/leaflet` em dev).
- Política de uso dos tiles do OpenStreetMap: manter a atribuição visível no mapa e o referrer de origem enviado (sem `no-referrer`); uso leve, sem pré-carga em massa. Se o tráfego crescer, trocar por provedor de tiles próprio.
- Contrato da URL da escolha para a fase 4: `/a/<slug>?quadra=<id>&dia=<YYYY-MM-DD>&inicio=<h>&horas=<n>`.

## Fase 4a pronta (branch feat/fase4a-reservas, sem merge)
Reserva pelo site **sem pagamento online** (emenda no spec de 23/10, decisão do dono: "pagamento fica para depois"). Toda reserva nasce confirmada como "pagar na arena", com taxa 0. Plano: `docs/superpowers/plans/2026-10-23-fase4a-reservas.md`.
- Migração 0016: extensão `btree_gist` e tabela `reservas` (reserva de jogador e bloqueio do dono). Uma restrição de exclusão (`quadra_id` igual e `periodo` sobreposto, só entre `segurada` e `confirmada`) impede dois jogos no mesmo horário mesmo com cliques simultâneos; o conflito vira "Esse horário não está mais disponível." No Supabase a `btree_gist` está disponível (conferido em 23/10); a migração a cria.
- Página da arena: horários ocupados somem; "Reservar" abre `/reservar?quadra=&dia=&inicio=&horas=` com o resumo. Sem login, vai a `/entrar` e volta ao resumo. Na página da arena, duração que não cabe é reduzida com o aviso "Duração reduzida para N h."; no resumo, duração além do que cabe é recusada.
- Limite provisório: 2 reservas futuras por arena e 5 no total por jogador (o dono pode mudar).
- `/minhas-reservas`: próximas e histórico, lances da reserva, cancelamento grátis até 24 h antes. Cancelada pela arena mostra o motivo.
- Painel do dono, aba "Reservas" (`/painel/reservas`): agenda dos próximos 14 dias por dia, filtro por quadra, cancelar reserva (motivo opcional, até 120 caracteres), bloquear horário (motivo de 1 a 60) e remover bloqueio, histórico dos últimos 30 dias.
- Apagar a conta com reservas futuras é recusado: "Cancele suas reservas futuras antes de apagar a conta."
- O admin vê, na confirmação de suspender, quantas reservas futuras confirmadas a arena tem.

### Riscos aceitos da fase 4a
- **Sem pagamento e sem verificação de e-mail:** várias contas podem segurar 2 horários cada por arena. Hoje o dono cancela. Antes de o tráfego crescer, pensar num teto de reservas por IP ou em verificar o e-mail antes de reservar.
- **Conflito de exclusão (23P01) descarta a conexão do pool** (`emTransacao` em `app/lib/db.ts` faz `release(erro)` em qualquer erro). Inofensivo no volume atual.

## Para produção (fase 4a, nesta ordem)
1. Ok do dono.
2. Migrar produção (aplica a 0016): `node node_modules/tsx/dist/cli.mjs --env-file=C:/Users/anton/replay-producao.env db/migrar-cli.ts`.
3. Merge na `main` e push (a Vercel publica sozinha).
4. Smoke: reservar, cancelar como jogador, bloquear e cancelar como dono.

## Para produção (visual novo, fase 2: horários criados pelo dono, nesta ordem)
1. Aplicar SÓ a 0017 em produção (cria `horarios_quadra` e copia as faixas). O código antigo continua funcionando porque as duas tabelas existem.
2. Merge na `main` e push; esperar o deploy da Vercel ficar Ready.
3. Aplicar a 0018 (remove `precos_quadra`).

## Próxima: fase 4b (pagamento com Asaas)
Falta a conta Asaas do dono. Pesquisa em `docs/pesquisa/asaas.md` (Checkout com split e webhook). Antes de implementar, o dono decide os conflitos com o spec listados lá: o split sai do valor líquido (não do bruto), a tarifa do estorno sai da conta da Strukti, o saldo da subconta no estorno, o walletId de conta já existente e a URL de retorno no domínio cadastrado.

---

## Histórico (17/10) — ainda válido onde não foi resolvido

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
- Feito desde então (deploy em 22–23/10): variáveis na Vercel, migrações em produção, smoke do R2 e teste do link de download, app no ar. Ainda aberto: `x-real-ip` na Vercel; TLS e DNS rebinding em `xm/`; escolher o host do worker; na primeira limpeza após o deploy, clipes com 3 a 7 dias são apagados de vez (regra de 3 dias — avisar o dono).
- Dívida conhecida (multi-arena): ~~o worker ainda conecta nas câmeras de arenas suspensas~~ (resolvido na migração 0020, 25/10: `listar_cameras` só traz arena ativa); não há como remover um super admin nem encerrar sessões de admin sem mexer no banco; o CLI `criar-super-admin` pode ecoar a senha no Git Bash/mintty (usar PowerShell ou `winpty`).
- Dívida conhecida: `docs/divida-worker.md`; corrida de sobreposição de reservas (constraint de exclusão com `btree_gist` depois); `atribuirClipe` concorrente pode juntar as duas listas.

## Próximos passos
1. (Feito) Push e merge da `feat/web`; app no ar desde 22–23/10.
2. Fechar as medições pendentes na câmera real (`RELAY_LAG_S`).
3. Deploy do host do worker.

## Time no Maestri (workspace "goToguether", terminais com `--dir C:\Codes\Camera_Replay`)
- Vigia (Revisor Replay, Opus), Lupa (QA Replay), Prancheta (Backlog Replay, dona da nota `backlog-replay`), Trilho (Dev Captura, standby).
- Os agentes de subprojeto ficam em `.claude/agents/`: captura, backend, web, revisao.
