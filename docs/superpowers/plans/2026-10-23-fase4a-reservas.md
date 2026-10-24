# Fase 4a — Reservas (sem pagamento online): plano de implementação

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** O jogador reserva pelo site (escolhe na página da arena, entra ou cria a conta e volta à mesma escolha, confirma), a reserva sai confirmada como "pagar na arena", aparece em "Minhas reservas" com os lances do jogo e pode ser cancelada até 24 h antes; o dono vê a agenda, cancela e bloqueia horários; dois horários nunca se sobrepõem, garantido pelo banco.

**Architecture:** Migração `0016` recria `reservas` (uma linha por reserva ou bloqueio, com situação, valores congelados e prazo de segura) e impõe a não sobreposição com `exclude using gist` (extensão `btree_gist`) sobre `segurada` e `confirmada`. Um módulo `app/lib/reservas.ts` concentra criar (revalidando tudo e **recusando** o que não cabe), cancelar, bloquear e listar; `app/lib/disponibilidade.ts` passa a receber as horas ocupadas. A página pública ganha o "Reservar" de verdade, que leva a `/reservar?…` (exige jogador, com `voltar`); "Minhas reservas" mostra próximas, histórico e lances; o painel ganha "Reservas" (agenda, cancelar, bloquear). O pagamento online (4b) entra depois sem mudar o esquema.

**Tech Stack:** Next.js 15, Postgres (PGlite com `@electric-sql/pglite/contrib/btree_gist` nos testes; Supabase com `btree_gist` em produção), Vitest.

**Spec:** `docs/superpowers/specs/2026-10-22-reservas-publicas-design.md` (seção "Fase 4" e a emenda de 23/10).

## Global Constraints

- Branch `feat/fase4a-reservas`, a partir de `main`. `npm test` e typecheck verdes ao fim de cada tarefa (se `npm`/`npx` travarem: `node node_modules/typescript/bin/tsc --noEmit` e `node node_modules/vitest/vitest.mjs run`); build só com o `next dev` parado.
- **Não sobreposição no banco:** `exclude using gist (quadra_id with =, periodo with &&) where (situacao in ('segurada','confirmada'))`, com `periodo tstzrange` `[inicio, fim)`. Encostadas são aceitas. Reservas e bloqueios na mesma tabela e na mesma regra.
- **Sem pagamento online nesta fase:** criar reserva = `situacao 'confirmada'`, `pagamento 'arena'`, `taxa_centavos 0`. O estado `segurada` + `segura_ate` existe e é tratado (expira e libera o horário) mas só é usado na 4b.
- **Recusar, não cortar:** a confirmação revalida dia (`diaValido`), início livre (`iniciosLivres` com as horas ocupadas) e `horas ≤ horasMax`; qualquer falha → "Esse horário não está mais disponível." e nada é gravado. A página pública deixa de cortar a duração em silêncio: com duração acima do possível, mostra "Duração reduzida para N h." ao lado do total.
- **Valores congelados na reserva:** `total_centavos`, `taxa_centavos`, `detalhe` (jsonb `[{hora, precoCentavos}]`). Mudar a tabela de preços depois não altera reservas.
- **Uma reserva tem um jogador só.** Lances de uma reserva: clipes `pronto`/`parcial`, não expirados, das câmeras da quadra, com `recebido_em` em `[inicio, fim)` — vistos pelo jogador da reserva confirmada (inclusive depois do jogo) e pelo dono. Lance fora de reserva: só o dono.
- **Cancelamento:** jogador, reserva confirmada, até **24 h antes do início** (depois disso o botão some e a ação recusa); dono, qualquer reserva futura, a qualquer momento, com motivo opcional (até 120 caracteres). Cancelada fica no histórico de ambos com quem cancelou e quando; o horário volta a ficar livre.
- **Bloqueio pelo dono:** quadra, dia, início, fim (horas cheias, mesmas regras de dia e hora), motivo curto obrigatório (1–60, ex.: "Reserva por telefone — João"); sem jogador nem valor; removível. Pode ficar fora da tabela de preços (o dono bloqueia o que quiser).
- **Apagar conta (regra que faltava da fase 1):** com reserva futura confirmada → recusa com "Cancele suas reservas futuras antes de apagar a conta."; reservas passadas ficam com `jogador_id null` e aparecem para o dono como "Conta apagada".
- **Isolamento:** toda função do dono recebe o `arenaId` da sessão; do jogador, o `jogadorId` da sessão; id de outra arena ou de outro jogador = inexistente. O dono vê de cada reserva só o nome do jogador.
- **Fuso:** `America/Sao_Paulo` para todas as arenas nesta fase (fuso por arena fica para depois).
- `voltar` sempre por `caminhoSeguro`. pt-BR, WCAG AA, alvos de 48 px, identidade Strukti; páginas funcionam sem JavaScript.

## Review Focus

1. **Dois jogadores confirmando o mesmo horário ao mesmo tempo** → exatamente um consegue; o outro recebe "Esse horário não está mais disponível.". Teste na Task 2 (`Promise.all`).
2. **URL de reserva adulterada ou velha** (`horas=4` onde só cabem 2, início que já passou, dia fora da janela, quadra de outra arena, quadra sem preço) → recusa, nada gravado. Teste na Task 2.
3. **Cancelamento na fronteira de 24 h** (23h59 antes → recusa; 24h00 antes → aceita) e **jogador cancelando reserva de outro** → recusa. Teste na Task 2.
4. **Bloqueio sobre reserva existente** (ou reserva sobre bloqueio) → recusa; bloqueio encostado aceito. Teste na Task 2.
5. **Jogador com reserva futura tenta apagar a conta** → recusa; sem reservas futuras → apaga e as passadas viram "Conta apagada" na agenda do dono. Teste na Task 2.

---

### Task 1: Banco e disponibilidade com horas ocupadas

**Files:**
- Create: `db/migrations/0016_reservas.sql`
- Modify: `tests/db.ts` (PGlite com a extensão `btree_gist`), `db/migrar.ts` se precisar, `app/lib/disponibilidade.ts`, `tests/disponibilidade.test.ts`, `tests/schema.test.ts`

**Interfaces:**
- Produces:
  - `0016_reservas.sql`: `create extension if not exists btree_gist;` e `reservas` nova: `id uuid pk`, `arena_id`, `quadra_id` (FK composta para `quadras (id, arena_id)`), `jogador_id uuid null references jogadores(id) on delete set null`, `tipo text check in ('reserva','bloqueio')`, `situacao text check in ('segurada','confirmada','cancelada','expirada')`, `inicio`, `fim` (`timestamptz`, `fim > inicio`, até 12 h), `periodo tstzrange generated always as (tstzrange(inicio, fim, '[)')) stored`, `segura_ate timestamptz null`, `pagamento text null check in ('arena','online')`, `total_centavos int null`, `taxa_centavos int null`, `detalhe jsonb null`, `motivo text null` (bloqueio), `cancelada_em timestamptz null`, `cancelada_por text null check in ('jogador','dono')`, `motivo_cancelamento text null`, `criado_em`; `unique (id, arena_id)`; check: `tipo='reserva'` exige `total_centavos`/`detalhe` e `tipo='bloqueio'` exige `motivo` e `jogador_id is null`; a exclusão das Global Constraints; índices `(arena_id, inicio)` e `(jogador_id, inicio)`.
  - `iniciosLivres(faixas, dia, agora, ocupadas: Set<number> = new Set())` e `precoEscolha(faixas, dia, hora, horas, agora, ocupadas = new Set())`: hora ocupada não é início livre e corta a continuidade.
  - `horasOcupadas(periodos: { inicio: Date; fim: Date }[], dia: string): Set<number>` — horas locais (0–23) daquele dia tocadas por algum período.
- [ ] **Step 1: testes que falham:** schema `"0016: duas reservas sobrepostas na mesma quadra são recusadas pelo banco; encostadas e canceladas não"` e `"bloqueio exige motivo e não tem jogador"`; disponibilidade `"horas ocupadas tiram inícios e cortam a continuidade"` (tabela 7–23, ocupada 18 → 17 tem `horasMax` 1, 18 some) e `"horasOcupadas por dia local"` (reserva 22h–01h do dia seguinte marca 22 e 23 no dia e 0 no seguinte).
- [ ] **Step 2:** FAIL. **Step 3:** implementar. **Step 4:** PASS, typecheck.
- [ ] **Step 5:** commit `feat(reservas): tabela de reservas sem sobreposição e horas ocupadas`.

### Task 2: Regras de reserva, cancelamento, bloqueio e conta

**Files:**
- Create: `app/lib/reservas.ts`, `tests/reservas.test.ts`
- Modify: `app/lib/jogadores.ts` (`apagarContaJogador`), `tests/jogadores.test.ts`

**Interfaces:**
- Consumes: `diaValido`, `iniciosLivres`, `precoEscolha`, `horasOcupadas` (Task 1); `listarFaixas` (`precos-quadra.ts`); `emTransacao` (`db.ts`).
- Produces (`app/lib/reservas.ts`):
  - `MSG_INDISPONIVEL = "Esse horário não está mais disponível."`
  - `periodosOcupados(db, arenaId, quadraId, dia): Promise<{inicio: Date; fim: Date}[]>` — `segurada` (com `segura_ate > now()`) e `confirmada` que tocam o dia local.
  - `criarReserva(db, jogadorId, { quadraId, dia, inicio, horas }, agora): Promise<{ ok: true; reservaId: string } | { ok: false; erro: string }>` — acha a quadra (arena ativa), revalida tudo com as horas ocupadas, calcula `precoEscolha`; insere `confirmada`/`arena`/`taxa 0` com valores congelados; violação da exclusão (23P01) → `MSG_INDISPONIVEL`; antes de inserir, marca como `expirada` as `segurada` vencidas da quadra.
  - `cancelarPeloJogador(db, jogadorId, reservaId, agora): Promise<boolean>` — só confirmada, dele, com `inicio - agora ≥ 24 h`.
  - `cancelarPeloDono(db, arenaId, reservaId, motivo?): Promise<boolean>` — reserva ou bloqueio futuro da arena; bloqueio removido vira `cancelada` também.
  - `bloquearHorario(db, arenaId, { quadraId, dia, inicio, fim, motivo }, agora): Promise<{ ok: true } | { ok: false; erro: string }>`.
  - `reservasDoJogador(db, jogadorId, agora): Promise<{ proximas: ReservaJogador[]; historico: ReservaJogador[] }>` — `ReservaJogador = { id, arena: { nome, slug }, quadra: string, inicio, fim, totalCentavos, pagamento, situacao, podeCancelar: boolean, lances: number }`; histórico = passadas + canceladas, mais recentes primeiro.
  - `agendaDaArena(db, arenaId, agora, { de: string; ate: string }): Promise<ItemAgenda[]>` — `ItemAgenda = { id, tipo, quadra, inicio, fim, situacao, jogador: string | null (nome ou "Conta apagada"), totalCentavos, motivo, canceladaPor }`.
  - `lancesDaReservaDoJogador(db, r2, jogadorId, reservaId)` — clipes da janela, só se a reserva é dele e `confirmada`, com URLs assinadas (reaproveitar `paraClipePublico` de `app/lib/clipes.ts`); senão `null`.
  - `apagarContaJogador` recusa com reserva futura confirmada (`{ ok: false, erro: "reservas_futuras" }`).
- [ ] **Step 1: testes que falham** (`agora` fixo, quadra com preços): `"cria reserva confirmada com valores congelados"`; `"recusa horas além do contínuo, início passado, dia fora da janela, quadra sem preço e quadra de arena suspensa"` (nada gravado); `"dois jogadores ao mesmo tempo: um consegue"` (`Promise.all`); `"reserva ocupa e libera ao cancelar"`; `"cancelamento do jogador: 24h00 antes aceita, 23h59 recusa, de outro jogador recusa"`; `"dono cancela a qualquer momento e o motivo fica"`; `"bloqueio: sobre reserva recusa, encostado aceita, sem motivo recusa, de outra arena recusa"`; `"segurada vencida não ocupa e vira expirada"`; `"agenda mostra nome do jogador ou Conta apagada"`; `"lances só do dono da reserva e só na janela"`; `"apagar conta com reserva futura recusa; sem futura apaga e mantém as passadas sem jogador"`.
- [ ] **Step 2:** FAIL. **Step 3:** implementar. **Step 4:** PASS, typecheck.
- [ ] **Step 5:** commit `feat(reservas): criar, cancelar, bloquear e listar reservas`.

### Task 3: Reservar pela página da arena

**Files:**
- Create: `app/reservar/page.tsx`, `app/reservar/actions.ts`
- Modify: `app/a/[slug]/escolha.tsx` e `page.tsx` (horas ocupadas, "Reservar" ativo como link para `/reservar?quadra=&dia=&inicio=&horas=`, aviso "Duração reduzida para N h."), `app/jogador/sessao-jogador.ts` (`exigirJogador(voltar?)` repassa `?voltar=`), `app/a/[slug]/apresentacao.ts` (`hrefReservar(escolha)`), `tests/a-apresentacao.test.ts`

**Interfaces:**
- Consumes: Task 2; `lerEscolha`, `arenaPublica`; `caminhoSeguro`.
- `/reservar?quadra&dia&inicio&horas`: sem jogador → `/entrar?voltar=<esta URL>` (que já oferece criar conta com o mesmo `voltar`); com jogador → resumo (arena, quadra, dia por extenso, horário, total e detalhe, "Pagamento na arena", regra "Cancelamento grátis até 24 h antes."), botão "Confirmar reserva" (POST). Escolha inválida → "Esse horário não está mais disponível." com link de volta à arena. Sucesso → `/minhas-reservas?ok=reservada`.
- Na página da arena, "Reservar" vira link (não botão desabilitado) quando há escolha válida; some o "Reservas pelo site em breve".
- [ ] **Step 1: testes que falham:** `"hrefReservar monta a URL do contrato"`; `"exigirJogador com voltar"` se houver lógica pura (ex.: `destinoEntrar(voltar)` → `/entrar?voltar=...` só com `caminhoSeguro`).
- [ ] **Step 2–4:** implementar; typecheck e testes; na prévia (390 px): escolher 16h + 2 h numa segunda, "Reservar" sem login → entrar → volta ao resumo com tudo preenchido → confirmar → "Minhas reservas"; repetir o mesmo horário em outra conta → indisponível.
- [ ] **Step 5:** commit `feat(publico): reservar pela página da arena com volta após o login`.

### Task 4: Minhas reservas com lances e cancelamento

**Files:**
- Modify: `app/minhas-reservas/page.tsx`; Create: `app/minhas-reservas/actions.ts`, `app/minhas-reservas/[id]/page.tsx` (lances da reserva)

**Interfaces:**
- Consumes: `reservasDoJogador`, `cancelarPeloJogador`, `lancesDaReservaDoJogador` (Task 2); `Galeria`/`VideoClipe`/`leitorR2` (`app/a/[slug]/`).
- Tela: "Próximas" e "Histórico"; cada item: arena (link), quadra, dia, horário, valor, "Pagamento na arena", situação (Confirmada / Cancelada por você / Cancelada pela arena); "Cancelar" (com confirmação, só quando `podeCancelar`) e "Ver lances (N)" quando houver; `?ok=reservada` → "Reserva confirmada." e `?ok=cancelada` → "Reserva cancelada." (textos fixos). `/minhas-reservas/<id>`: lances da reserva (404 se não for dele).
- [ ] **Step 1–4:** sem lógica pura nova além da Task 2 (se surgir, testar); typecheck, testes; prévia: cancelar a reserva criada na Task 3; com um clipe de teste na janela, "Ver lances" abre.
- [ ] **Step 5:** commit `feat(jogador): minhas reservas com lances e cancelamento`.

### Task 5: Agenda e bloqueios no painel do dono

**Files:**
- Create: `app/painel/reservas/page.tsx`, `app/painel/reservas/actions.ts`, `app/painel/reservas/formularios.tsx`
- Modify: `app/painel/navegacao.tsx` ("Quadras", "Reservas", "Arena"), `app/minha-conta/actions.ts` (mensagem de reservas futuras ao apagar), `app/jogador/mensagens.ts`, `tests/jogador-telas.test.ts`

**Interfaces:**
- Consumes: `agendaDaArena`, `cancelarPeloDono`, `bloquearHorario` (Task 2).
- Tela: agenda dos próximos 14 dias por dia (padrão hoje; filtro por quadra), cada item com horário, quadra, jogador (ou "Conta apagada"), valor, situação, "Cancelar" (motivo opcional) para futuros; bloqueios com o motivo e "Remover"; formulário "Bloquear horário" (quadra, dia, início, fim, motivo). Histórico dos últimos 30 dias abaixo.
- Mensagem ao apagar conta com reservas futuras: exatamente "Cancele suas reservas futuras antes de apagar a conta." (teste em `jogador-telas.test.ts`).
- Feito (24/10), mudanças em `app/lib/reservas.ts`: `ItemAgenda` ganhou `quadraId`, `esporte` e `motivoCancelamento` (filtro por id, porque nome de quadra não é único); `reservasDoJogador` devolve `motivoCancelamento`; novo `removerBloqueio(db, arenaId, id, agora)` (só `tipo = 'bloqueio'`, futuro, da arena).
- [ ] **Step 1–4:** testes da mensagem; typecheck, testes; prévia: bloquear um horário, ver que some da página pública, cancelar a reserva de um jogador pelo painel.
- [ ] **Step 5:** commit `feat(painel): agenda de reservas e bloqueio de horário`.

### Task 6: Documentação e produção

**Files:** Modify: `docs/ESTADO.md` (fase 4a pronta; migração 0016 com `btree_gist`; "pagar na arena" até a 4b; o que falta para a 4b: conta Asaas, pesquisa em `docs/pesquisa/asaas.md`).
- [ ] **Step 1:** documento. **Step 2:** testes, typecheck, build (com o `next dev` parado). **Step 3:** commit `docs: estado depois da fase 4a`.
- [ ] **Step 4 (com o ok do dono):** migrar produção (0016; conferir antes que `btree_gist` está disponível no Supabase), merge + push, smoke: reservar, cancelar, bloquear.
