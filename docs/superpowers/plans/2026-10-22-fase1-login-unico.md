# Fase 1 — Login único e conta do jogador: plano de implementação

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Uma tela de entrar só, que leva cada conta para a sua área; o jogador cria a própria conta, recupera a senha por e-mail e apaga a conta; sai tudo que era "aluno de uma arena" e "reserva feita pelo dono".

**Architecture:** O banco ganha `contas_email`, uma tabela mantida por triggers nas três tabelas de conta (`usuarios`, `super_admins`, `jogadores`) que garante "um e-mail, uma conta" no próprio banco e diz o tipo da conta no login. As sessões continuam separadas por tipo (tabela, cookie, duração); só a porta de entrada vira uma (`entrarUnico`). Recuperação de senha com token de uso único (só o hash no banco) e envio por um `EnviarEmail` injetável (Resend em produção, console na prévia).

**Tech Stack:** Next.js 15 (App Router, server actions), Postgres (PGlite nos testes), Vitest, scrypt (`app/lib/senha.ts`), `novoToken`/`hashToken` (`app/lib/segredos.ts`).

**Spec:** `docs/superpowers/specs/2026-10-22-reservas-publicas-design.md` (seção "Fase 1"), que muda partes de `docs/superpowers/specs/2026-10-16-replay-saas-design.md`.

## Global Constraints

- Branch `feat/reservas-publicas`. `npm test` e `npm run typecheck` verdes ao fim de cada tarefa. Build só com o `next dev` da prévia parado (`npm run build` sobrescreve `.next`).
- "Um e-mail é uma conta só na plataforma inteira." E-mail sempre `trim().toLowerCase()`.
- Senha do jogador: 8 ou mais caracteres. Dono e super admin mantêm os mínimos de hoje (`SENHA_ADMIN_MIN` = 12 para admin).
- Limite de tentativas: 5 por chave e 20 por IP em 15 min (`registrarTentativa`, `app/lib/sessao.ts`). Chaves novas: `entrar:<email>` no login único e `recuperar:<email>` no pedido de link.
- Resposta igual para "e-mail não existe" e "senha errada"; "suspensa" só para quem acertou a senha. O pedido de link responde sempre "Se o e-mail tiver conta, enviamos um link para redefinir a senha."
- Link de redefinição: uso único, válido por 1 hora; trocar a senha por ele encerra todas as sessões da conta e invalida os outros links dela.
- Sessão do jogador: tabela `sessoes_jogador`, cookie `replay_jogador` (HttpOnly, Secure em produção, SameSite Lax, path `/`), 30 dias. Dono (`replay_sessao`) e admin (`replay_admin`, path `/admin`, SameSite Strict, 12 h) continuam como estão.
- Termos: caixa obrigatória "Li e aceito os termos de uso e a política de privacidade", link para `/termos`; versão `TERMOS_VERSAO = "provisorio-2026-10-22"` e data do aceite gravadas na conta. O texto de `/termos` começa com "Texto provisório".
- Só caminhos internos em `?voltar=` (começa com `/`, não com `//` nem `/\`, até 512 caracteres); qualquer outro valor é ignorado.
- pt-BR, WCAG AA, alvos de 48 px, identidade Strukti, sem libs novas. Páginas funcionam sem JavaScript.
- Segredos de e-mail só em variáveis de ambiente: `RESEND_API_KEY`, `EMAIL_REMETENTE`. A URL do link usa `APP_URL`.

## Review Focus

1. **E-mail com maiúsculas e espaços** (`"  Ana@X.com "`) ao criar conta, entrar e pedir link → é a mesma conta de `ana@x.com`. Teste na Task 2 e na Task 3.
2. **`?voltar=` malicioso** (`//evil.com`, `https://evil.com`, `/\evil.com`, `javascript:x`) → ignorado; a pessoa vai para a área do tipo dela. Teste na Task 3.
3. **Link de redefinição repetido, vencido, adulterado ou de conta apagada** → "Link inválido ou vencido", nada muda; depois de usado, as sessões antigas da conta deixam de valer. Teste na Task 5.
4. **E-mail de dono tentando virar jogador, ou admin criando dono com e-mail de jogador** → recusa clara, nada criado em nenhuma tabela. Teste na Task 2.
5. **Dono de arena suspensa no login único** → "suspensa" só com a senha certa; com a senha errada, "credenciais". Teste na Task 3.

---

### Task 1: Tirar alunos e reservas do dono

**Files:**
- Create: `db/migrations/0010_sem_alunos.sql`, `app/lib/arena-slug.ts`
- Delete: `app/lib/alunos.ts`, `app/lib/reservas.ts`, `app/lib/acesso-aluno.ts`, `app/painel/alunos/**`, `app/painel/reservas/**`, `app/painel/lances/**`, `app/painel/escolha-alunos.tsx`, `app/painel/escolha-alunos-filtro.ts`, `app/a/[slug]/entrar/**`, `app/a/[slug]/meus-lances/**`, `app/a/[slug]/r/**`, `app/a/[slug]/sessao-aluno.ts`, `tests/alunos.test.ts`, `tests/alunos-telas.test.ts`, `tests/reservas.test.ts`, `tests/acesso-aluno.test.ts`
- Modify: `app/lib/painel.ts` (sem `reserva`/`alunos` em `ClipePainel`; sem `atribuirClipe`, `clipeParaAtribuir`, `listarAlunosParaEscolha`), `app/painel/quadras/[id]/page.tsx` e `actions.ts`, `app/painel/navegacao.tsx` (só "Quadras"), `app/painel/page.tsx`, `app/lib/plataforma.ts` (sem contagem de alunos; suspender não toca `sessoes_aluno`), `app/admin/page.tsx`, `app/a/[slug]/page.tsx`, `app/a/[slug]/apresentacao.ts`, `app/q/[slug]/arena-da-quadra.ts`, `app/entrar/mensagens.ts`, `tests/painel.test.ts`, `tests/plataforma.test.ts`, `tests/schema.test.ts`, `tests/sessao-admin.test.ts`, `tests/a-apresentacao.test.ts`

**Interfaces:**
- Produces: `app/lib/arena-slug.ts` com `arenaDoSlug(db, slug): Promise<{ arenaId: string; nome: string; ativa: boolean } | null>`, `slugDaArena(db, arenaId): Promise<string | null>` e `slugDaArenaDaQuadra(db, slugQuadra): Promise<string | null>`, movidas de `acesso-aluno.ts` sem mudar o comportamento (os testes delas vão de `acesso-aluno.test.ts` para `tests/arena-slug.test.ts`).
- `/a/<slug>` (até a fase 3): slug inexistente → 404 (`not-found.tsx` de hoje); arena existente → `redirect("/entrar")`.

- [ ] **Step 1:** em `tests/schema.test.ts`, teste `"0010 apaga alunos e reservas"`: depois de migrar, `select to_regclass($1)` é `null` para `alunos`, `reserva_alunos`, `clipe_alunos`, `sessoes_aluno` e `reservas`; e `tests/arena-slug.test.ts` com os testes de `arenaDoSlug`/`slugDaArena`/`slugDaArenaDaQuadra` trazidos de `acesso-aluno.test.ts`, importando de `../app/lib/arena-slug`.
- [ ] **Step 2:** `npx vitest run tests/schema.test.ts tests/arena-slug.test.ts` → FAIL (tabelas existem; módulo não existe).
- [ ] **Step 3:** `0010_sem_alunos.sql`: `drop table` de `clipe_alunos`, `reserva_alunos`, `sessoes_aluno`, `alunos` e `reservas` (nessa ordem) e `delete from tentativas_login where email like 'aluno:%'`. Criar `arena-slug.ts`, apagar os arquivos listados e ajustar os que os usavam. A tela da quadra mostra cada lance sem "Reserva"/"Atribuído a"; o admin lista arenas sem a coluna de alunos.
- [ ] **Step 4:** `npm run typecheck` e `npm test` → tudo verde; `grep -rn "aluno" app --include=*.ts --include=*.tsx` não acha código (só texto de comentário que for apagado junto).
- [ ] **Step 5:** commit `refactor!: remove alunos e reservas feitas pelo dono`.

### Task 2: Contas da plataforma e conta do jogador

**Files:**
- Create: `db/migrations/0011_contas.sql`, `app/lib/jogadores.ts`, `tests/jogadores.test.ts`
- Modify: `app/lib/donos.ts` e `app/lib/plataforma.ts` (erro de e-mail em uso continua "e-mail já cadastrado"), `tests/schema.test.ts`

**Interfaces:**
- Consumes: `hashSenha`/`conferirSenha` (`senha.ts`), `novoToken`/`hashToken` (`segredos.ts`).
- Produces (`app/lib/jogadores.ts`):
  - `TERMOS_VERSAO = "provisorio-2026-10-22"`, `DURACAO_SESSAO_JOGADOR_S = 30 * 24 * 3600`, `SENHA_JOGADOR_MIN = 8`
  - `type SessaoJogador = { jogadorId: string; nome: string; email: string }`
  - `criarContaJogador(db, d: { nome: string; email: string; senha: string; aceitouTermos: boolean }): Promise<{ ok: true; jogadorId: string } | { ok: false; erro: "nome" | "email" | "senha" | "termos" | "email_em_uso" }>` — nome com trim, 1 a 80 caracteres.
  - `criarSessaoJogador(db, jogadorId): Promise<{ token: string; expiraEm: Date }>`
  - `validarSessaoJogador(db, token): Promise<SessaoJogador | null>` (token fora do formato não consulta o banco)
  - `sairJogador(db, token): Promise<void>`
  - `atualizarNomeJogador(db, jogadorId, nome): Promise<boolean>`
  - `trocarSenhaJogador(db, jogadorId, atual, nova, tokenAtual): Promise<{ ok: true } | { ok: false; erro: "senha_atual" | "senha" }>` — apaga as outras sessões do jogador, mantém a do `tokenAtual`.
  - `apagarContaJogador(db, jogadorId, senha): Promise<{ ok: true } | { ok: false; erro: "senha" }>` — apaga o jogador (sessões e links por cascata/limpeza); o e-mail fica livre. A regra de reservas futuras entra na fase 4.
- Banco: `contas_email (email text primary key check (email = lower(email)), tipo text not null check (tipo in ('jogador','dono','admin')))`; `jogadores (id, nome, email unique, senha_hash, termos_versao, termos_aceito_em, criado_em)`; `sessoes_jogador (id, jogador_id references jogadores on delete cascade, token_hash unique, criado_em, expira_em)`. Triggers em `usuarios` (tipo `dono`), `super_admins` (`admin`) e `jogadores` (`jogador`): insert reserva o e-mail em `contas_email`, delete libera, update de e-mail troca. A migração preenche `contas_email` com os donos e admins existentes.

- [ ] **Step 1: testes que falham** em `tests/jogadores.test.ts`:
  - `"cria conta com e-mail normalizado e entra na sessão"`: `criarContaJogador(db, { nome: " Ana ", email: "  Ana@X.com ", senha: "senha-boa-1", aceitouTermos: true })` → `ok`; `select email, nome, termos_versao from jogadores` = `ana@x.com`, `Ana`, `TERMOS_VERSAO`; `validarSessaoJogador` com o token de `criarSessaoJogador` → `{ nome: "Ana", email: "ana@x.com" }`.
  - `"recusa nome vazio, e-mail sem @, senha de 7 e termos não aceitos"`: erros `nome`, `email`, `senha`, `termos`, e `count(*) from jogadores` = 0.
  - `"e-mail de dono ou admin não vira jogador, e vice-versa"`: com uma arena e dono `dono@x.com` (fixture existente) → `criarContaJogador(..., email: "DONO@x.com")` = `email_em_uso`; jogador `j@x.com` criado → `criarArenaAdmin(db, { arena: "B", email: "j@x.com", senha })` rejeita com `"e-mail já cadastrado"` e não cria arena (`count(*) from arenas` não muda).
  - `"apagar conta pede a senha, derruba sessões e libera o e-mail"`: senha errada → `erro: "senha"`, conta continua; certa → `validarSessaoJogador` do token antigo = `null` e `criarContaJogador` com o mesmo e-mail volta a dar `ok`.
  - `"trocar senha confere a atual e derruba as outras sessões"`: duas sessões; troca com `tokenAtual` da primeira → a primeira vale, a segunda não; senha atual errada → `senha_atual`.
- [ ] **Step 2:** `npx vitest run tests/jogadores.test.ts` → FAIL (módulo não existe).
- [ ] **Step 3:** migração `0011_contas.sql` e `app/lib/jogadores.ts` com as assinaturas acima; `email_em_uso` vem do 23505 de `contas_email`.
- [ ] **Step 4:** `npx vitest run tests/jogadores.test.ts tests/plataforma.test.ts tests/donos.test.ts tests/schema.test.ts` → PASS.
- [ ] **Step 5:** commit `feat(contas): conta do jogador e e-mail único na plataforma`.

### Task 3: Login único

**Files:**
- Create: `app/lib/entrar-unico.ts`, `tests/entrar-unico.test.ts`, `app/jogador/sessao-jogador.ts` (`COOKIE_JOGADOR = "replay_jogador"`, `sessaoJogadorAtual()`, `exigirJogador()` → `redirect("/entrar")`)
- Modify: `app/lib/sessao.ts` (extrair `criarSessaoDono(db, usuarioId, arenaId): Promise<{ token; expiraEm }>`; remover `entrar`), `app/lib/sessao-admin.ts` (extrair `criarSessaoAdmin(db, adminId)`; remover `entrarAdmin`), `app/entrar/actions.ts`, `app/entrar/formulario.tsx`, `app/entrar/page.tsx`, `app/admin/entrar/**` (vira `redirect("/entrar")`), `app/admin/sessao-admin-atual.ts` e `app/painel/sessao-atual.ts` (sem sessão → `/entrar`), `app/admin/entrar/actions.ts` (só `sairAdminAction`, que volta para `/entrar`), `tests/sessao.test.ts`, `tests/sessao-admin.test.ts`

**Interfaces:**
- Consumes: `criarSessaoJogador` (Task 2), `registrarTentativa`, `obterHashFalso`.
- Produces (`app/lib/entrar-unico.ts`):
  - `type TipoConta = "jogador" | "dono" | "admin"`
  - `entrarUnico(db, email, senha, ip): Promise<{ ok: true; tipo: TipoConta; token: string; expiraEm: Date } | { ok: false; motivo: "credenciais" | "bloqueado" | "suspensa" }>` — chave `entrar:<email>`; acha o tipo em `contas_email`, confere a senha na tabela do tipo (hash falso se não houver conta), dono de arena não ativa → `suspensa`; sucesso apaga as falhas da chave.
  - `destinoDoTipo(tipo: TipoConta): string` → `"/admin"`, `"/painel"`, `"/minhas-reservas"`.
  - `caminhoSeguro(v: unknown): string | null`.
- `/entrar` (página): logado em qualquer tipo → vai para o destino do tipo. Título "Entrar", sem rótulo de tipo; links "Criar conta" (`/criar-conta`, levando o `voltar`) e "Esqueci a senha" (`/esqueci-a-senha`). O formulário leva `voltar` num campo escondido. Ação: grava o cookie do tipo (com os atributos de hoje) e redireciona para `caminhoSeguro(voltar)` se o tipo for jogador, senão para `destinoDoTipo`.

- [ ] **Step 1: testes que falham** em `tests/entrar-unico.test.ts`:
  - `"leva cada tipo à sua área"`: admin, dono e jogador criados → `entrarUnico` devolve `tipo` `admin`, `dono` e `jogador`; o token do dono vale em `validarSessao`, o do admin em `validarSessaoAdmin`, o do jogador em `validarSessaoJogador`, e nenhum vale nos outros dois.
  - `"e-mail normalizado"`: `entrarUnico(db, "  JOGADOR@x.com ", ...)` → `ok`.
  - `"mesma resposta para e-mail inexistente e senha errada"`: os dois → `{ ok: false, motivo: "credenciais" }`.
  - `"dono de arena suspensa: suspensa só com a senha certa"`: senha certa → `suspensa`; errada → `credenciais`.
  - `"bloqueia após 5 falhas do e-mail"`: 5 falhas → a 6ª, mesmo com a senha certa, é `bloqueado`.
  - `"caminhoSeguro só aceita caminho interno"`: `"/a/x?y=1"` → igual; `null`, `""`, `"//evil.com"`, `"/\\evil.com"`, `"https://evil.com"`, `"javascript:x"`, `"a/b"` e `"/" + "x".repeat(600)` → `null`.
  - Em `tests/sessao.test.ts` e `tests/sessao-admin.test.ts`, os testes de `entrar`/`entrarAdmin` passam a usar `criarSessaoDono`/`criarSessaoAdmin` + `validar*`/`sair*`; os de limite e suspensão migram para `entrar-unico.test.ts`.
- [ ] **Step 2:** `npx vitest run tests/entrar-unico.test.ts` → FAIL.
- [ ] **Step 3:** implementar o módulo, a página `/entrar` única e os redirecionamentos de `/admin/entrar`.
- [ ] **Step 4:** `npm run typecheck` e `npm test` → verde.
- [ ] **Step 5:** commit `feat(web): login único para jogador, dono e super admin`.

### Task 4: Telas do jogador

**Files:**
- Create: `app/criar-conta/page.tsx`, `formulario.tsx`, `actions.ts`; `app/termos/page.tsx`; `app/minhas-reservas/page.tsx`; `app/minha-conta/page.tsx`, `formularios.tsx`, `actions.ts`; `app/componentes/cabecalho-publico.tsx`; `tests/jogador-telas.test.ts`; `app/jogador/mensagens.ts`
- Modify: `app/page.tsx` (usa o cabeçalho público; tira "Sou dono de arena"), `app/globals.css`

**Interfaces:**
- Consumes: `criarContaJogador`, `criarSessaoJogador`, `atualizarNomeJogador`, `trocarSenhaJogador`, `apagarContaJogador`, `sairJogador` (Task 2); `exigirJogador`, `COOKIE_JOGADOR`, `caminhoSeguro` (Task 3).
- Produces: `mensagemCriarConta(erro): string` e `mensagemMinhaConta(erro): string` em `app/jogador/mensagens.ts`, com os textos:
  - `nome` → "Informe seu nome (até 80 caracteres)."; `email` → "Informe um e-mail válido."; `senha` → "A senha precisa ter pelo menos 8 caracteres."; `termos` → "Para criar a conta, aceite os termos de uso e a política de privacidade."; `email_em_uso` → "Este e-mail já tem conta. Entre ou use \"Esqueci a senha\"."; `senha_atual` → "Senha atual incorreta."
- Telas:
  - `/criar-conta`: nome, e-mail, senha, caixa dos termos; ao criar, já entra (cookie do jogador) e vai para `caminhoSeguro(voltar) ?? "/minhas-reservas"`. Logado como jogador → `/minhas-reservas`.
  - `/termos`: texto provisório (termos de uso + privacidade em linguagem simples: quem é a Strukti, que dados guarda — nome, e-mail, vídeos por até 3 dias —, para quê, como apagar a conta; responsável "Strukti Soluções", contato struktisolutions@gmail.com), com o aviso "Texto provisório".
  - `/minhas-reservas`: exige jogador; "Olá, <primeiro nome>"; "Você ainda não tem reservas."; links "Minha conta" e "Sair".
  - `/minha-conta`: exige jogador; três formulários separados — nome; senha (atual + nova); apagar conta (senha + caixa "Entendo que a conta e o histórico serão apagados"). Apagar → apaga o cookie e vai para `/` com "Conta apagada.".
  - Cabeçalho público: sem sessão de jogador, "Entrar" e "Criar conta"; com sessão, "Minhas reservas" e "Sair".

- [ ] **Step 1: teste que falha** `tests/jogador-telas.test.ts`: `mensagemCriarConta` e `mensagemMinhaConta` devolvem exatamente os textos acima para cada erro.
- [ ] **Step 2:** `npx vitest run tests/jogador-telas.test.ts` → FAIL.
- [ ] **Step 3:** implementar as telas e as actions (toda action de `/minha-conta` chama `exigirJogador()` e usa só o `jogadorId` da sessão).
- [ ] **Step 4:** `npm run typecheck`, `npm test`; na prévia, no celular (390 px): criar conta com `?voltar=/minha-conta` cai em `/minha-conta`; apagar a conta e criar de novo com o mesmo e-mail funciona.
- [ ] **Step 5:** commit `feat(web): criar conta, minhas reservas e minha conta do jogador`.

### Task 5: Esqueci a senha

**Files:**
- Create: `db/migrations/0012_tokens_senha.sql`, `app/lib/email.ts`, `app/lib/recuperar-senha.ts`, `tests/recuperar-senha.test.ts`, `tests/email.test.ts`, `app/esqueci-a-senha/page.tsx` (+ `formulario.tsx`, `actions.ts`), `app/redefinir-senha/page.tsx` (+ `formulario.tsx`, `actions.ts`)
- Modify: `app/lib/jogadores.ts` (`apagarContaJogador` apaga os links da conta), `.env.example` (`RESEND_API_KEY=`, `EMAIL_REMETENTE=`)

**Interfaces:**
- Consumes: `TipoConta`, `registrarTentativa`, `SENHA_JOGADOR_MIN`, `SENHA_ADMIN_MIN`, o mínimo do dono que `donos.ts` já usa.
- Produces:
  - `app/lib/email.ts`: `type MensagemEmail = { para: string; assunto: string; texto: string }`, `type EnviarEmail = (m: MensagemEmail) => Promise<void>`, `criarEnvioEmail(env = process.env, fetcher = fetch): EnviarEmail` — com `RESEND_API_KEY` e `EMAIL_REMETENTE`: `POST https://api.resend.com/emails` com `Authorization: Bearer <chave>` e corpo `{ from, to: [para], subject, text }`, resposta não-2xx lança erro sem a chave; sem configuração: fora de produção `console.info` com o texto (o link aparece no terminal da prévia), em produção `console.error("e-mail: envio não configurado")` sem o texto.
  - `app/lib/recuperar-senha.ts`: `VALIDADE_LINK_S = 3600`; `pedirRecuperacao(db, email, ip, appUrl, enviar): Promise<void>` — chave `recuperar:<email>`; bloqueado ou e-mail sem conta → não envia nada; senão grava `tokens_senha (tipo, conta_id, token_hash, expira_em)` e envia "Redefinir sua senha do Replay" com o link `${appUrl}/redefinir-senha?t=<token>` e o aviso de validade de 1 hora. `redefinirSenha(db, token, novaSenha): Promise<{ ok: true; tipo: TipoConta } | { ok: false; erro: "link" | "senha" }>` — token fora do formato não consulta o banco; válido = não usado e não vencido; troca o hash na tabela do tipo, marca `usado_em`, apaga os outros links e todas as sessões da conta.
  - Banco: `tokens_senha (id, tipo check in ('jogador','dono','admin'), conta_id uuid, token_hash text unique, criado_em, expira_em, usado_em)`, índice em `(tipo, conta_id)`.
- Telas: `/esqueci-a-senha` (e-mail → sempre "Se o e-mail tiver conta, enviamos um link para redefinir a senha. Ele vale por 1 hora."); `/redefinir-senha?t=` (nova senha duas vezes → sucesso "Senha alterada. Entre com a nova senha." e link para `/entrar`; erro `link` → "Link inválido ou vencido. Peça um novo." com link para `/esqueci-a-senha`).

- [ ] **Step 1: testes que falham**:
  - `tests/recuperar-senha.test.ts`, com um `enviar` falso que guarda as mensagens:
    - `"envia o link para jogador, dono e admin com e-mail normalizado"`: para `"  J@x.com "` → uma mensagem para `j@x.com` com `/redefinir-senha?t=` no texto.
    - `"e-mail sem conta não envia nada"`: zero mensagens, sem erro.
    - `"link troca a senha uma vez só e derruba as sessões"`: sessão aberta antes → `redefinirSenha(token, "nova-senha-1")` = `{ ok: true, tipo: "jogador" }`; `validarSessaoJogador` antiga = `null`; `entrarUnico` com a nova senha = `ok`; o mesmo token de novo → `erro: "link"`.
    - `"link vencido, adulterado ou de conta apagada é inválido"`: `update tokens_senha set expira_em = now() - interval '1 second'` → `link`; token com um caractere trocado → `link`; conta apagada com `apagarContaJogador` → `link`.
    - `"senha curta não gasta o link"`: `"curta"` → `erro: "senha"`, e o mesmo token com senha válida depois → `ok`.
    - `"pedir um link novo não invalida o anterior; usar um invalida os dois"`.
  - `tests/email.test.ts`: com chave e remetente, `fetcher` recebe a URL do Resend, o header `Authorization` e o corpo com `to: ["a@b.com"]`; resposta 500 → rejeita com mensagem que não contém a chave; sem configuração e `NODE_ENV=production` → não chama `fetcher`.
- [ ] **Step 2:** `npx vitest run tests/recuperar-senha.test.ts tests/email.test.ts` → FAIL.
- [ ] **Step 3:** migração, módulos e telas.
- [ ] **Step 4:** `npm run typecheck`, `npm test`; na prévia, pedir o link de `jogador` criado na Task 4 → o link aparece no terminal do `next dev` e funciona uma vez.
- [ ] **Step 5:** commit `feat(contas): esqueci a senha com link por e-mail`.

### Task 6: Documentação e produção

**Files:**
- Modify: `docs/ESTADO.md` (fase 1 feita; variáveis novas; migrações 0010–0012 a aplicar em produção; DNS do remetente pendente), `docs/superpowers/specs/2026-10-16-replay-saas-design.md` (nota no topo das seções "Reservas e alunos" e "Painel do dono" apontando para o spec novo), `README.md` se citar `/admin/entrar` ou alunos.

- [ ] **Step 1:** atualizar os documentos.
- [ ] **Step 2:** `npm test`, `npm run typecheck` e, com o `next dev` parado, `npm run build` → verdes.
- [ ] **Step 3:** commit `docs: estado depois da fase 1`.
- [ ] **Step 4 (com o ok do dono):** merge na `main`, push, `npx tsx --env-file=C:/Users/anton/replay-producao.env db/migrar-cli.ts` (aplica 0010–0012) e conferir `/entrar` no ar com as três contas.
