# Visual novo — Fase 3: fotos da arena e das quadras

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** O dono envia, ordena e apaga fotos da arena (até 10) e de cada quadra (até 6). A capa aparece na lista de quadras do painel e nos cartões de Minhas reservas.

**Architecture:** Tabela `fotos` (migração 0019) e regras de banco em `app/lib/fotos.ts`. O R2 ganha `enviar` e `ler`. O envio é por server action, depois de o navegador reduzir a foto. A leitura passa por uma rota do site, `/fotos/<id>`, com cache de 1 dia. O bucket continua privado.

**Tech Stack:** Next.js 15 App Router, React 19, Postgres (PGlite nos testes), aws4fetch, Vitest.

**Spec:** `docs/superpowers/specs/2026-10-24-visual-novo-design.md`, seções "Fotos" e "Fotos: decisões do construtor (25/10)".

## Global Constraints

- **Limites:**
  - Até 10 fotos por arena (`quadra_id` nulo) e até 6 por quadra.
  - Até 2 MB por foto (`FOTO_MAX_BYTES = 2 * 1024 * 1024`).
  - O formato vem dos primeiros bytes do arquivo: JPEG `FF D8 FF`; PNG `89 50 4E 47 0D 0A 1A 0A`; WebP `RIFF????WEBP`.
- **Mensagens exatas:**
  - `A arena já tem 10 fotos.`
  - `A quadra já tem 6 fotos.`
  - `Foto grande demais (máximo 2 MB).`
  - `Envie uma foto JPEG, PNG ou WebP.`
  - `Armazenamento de fotos não configurado.`
- **Isolamento:** toda função de banco recebe o `arena_id` da sessão. Um id de outra arena, ou que não é uuid, se comporta como inexistente (padrão de `app/lib/horarios-quadra.ts`).
- **Chave no R2:** `fotos/<arenaId>/<fotoId>.<jpg|png|webp>`. Nada da URL nem do nome do arquivo entra na chave.
- **Rota `/fotos/<id>`:**
  - Id que não é uuid ou que não existe → 404.
  - Sucesso → 200 com o `Content-Type` gravado e `Cache-Control: public, max-age=86400`.
  - Falha do R2 → 502, sem cache.
- **Server actions:**
  - Arquivos `"use server"` só exportam funções assíncronas.
  - Cada action confere a sessão (`exigirSessao`) e usa só `sessao.arenaId`.
- **Comandos:**
  - Testes: `node node_modules/vitest/vitest.mjs run --no-file-parallelism`. Nunca dois vitest ao mesmo tempo.
  - Typecheck: `node node_modules/typescript/bin/tsc --noEmit`.
  - Build sem o `next dev` aberto.
- **Commits:**
  - Conventional Commits, com `git add` explícito (nunca `.claude/settings.json`).
  - Terminam com `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.
  - Branch `feat/visual-novo`.

## Review Focus

- **Dois envios ao mesmo tempo** com a quadra em 5 fotos: só um grava. Teste na Task 1 (`Promise.all`).
- **Arquivo com nome `.jpg` mas conteúdo de outra coisa** (ex.: HTML ou SVG) → recusado. Teste na Task 1 (`tipoDaImagem`).
- **Foto de outra arena:** apagar, mover ou usar como capa com o id dela não faz nada. Teste na Task 1.
- **Apagar com R2 fora do ar:** a linha continua. Teste na Task 3.
- **Ordem depois de apagar:** sem buracos que quebrem "mover". `posicao` é renumerada de 0 a n-1. Teste na Task 1.

---

### Task 1: Tabela e regras de banco das fotos

**Files:**
- Create: `db/migrations/0019_fotos.sql`
- Create: `app/lib/fotos.ts`
- Test: `tests/fotos.test.ts`

**Acceptance:**
- **Migração 0019:**
  - Colunas `id uuid pk default gen_random_uuid()`, `arena_id uuid not null references arenas(id)`, `quadra_id uuid null`, `chave text not null unique`, `tipo text not null check (tipo in (...))`, `bytes int not null check (bytes between 1 and 2097152)`, `posicao smallint not null check (posicao >= 0)`, `criado_em`.
  - FK `(quadra_id, arena_id) references quadras (id, arena_id) on delete cascade`.
  - Índice em `(arena_id, quadra_id, posicao)`.
- **Funções:**
  - `tipoDaImagem(bytes: Uint8Array): "image/jpeg" | "image/png" | "image/webp" | null`
  - `extensaoDoTipo(tipo)` → `jpg` | `png` | `webp`
  - `listarFotos(db, arenaId, quadraId | null): Promise<Foto[]>`, em ordem de posição. `Foto = { id, tipo, bytes, posicao }`.
  - `reservarFoto(db, arenaId, quadraId | null, tipo, bytes): Promise<{ ok: true; id; chave } | { ok: false; erro }>`
    - Abre transação com `select ... from arenas where id = $1 for update`.
    - Confere se a quadra é da arena e se o limite não foi atingido.
    - Insere com `posicao = count`.
    - O id e a chave são gerados aqui.
  - `apagarFoto(db, r2Apagar: (chave) => Promise<void>, arenaId, fotoId): Promise<boolean>`
    - Apaga no R2 antes; se o R2 lança, a linha fica e o erro sobe.
    - Depois apaga a linha e renumera as que sobraram, dentro de transação.
  - `moverFoto(db, arenaId, fotoId, direcao: -1 | 1): Promise<boolean>`: troca com a vizinha; nas pontas não faz nada.
  - `usarComoCapa(db, arenaId, fotoId): Promise<boolean>`: vai para a posição 0 e as outras descem mantendo a ordem.
  - `fotoParaServir(db, fotoId): Promise<{ chave; tipo } | null>`: sem arena, porque a foto é pública. Id que não é uuid → null.
  - `capasDasQuadras(db, arenaId): Promise<Map<quadraId, fotoId>>` e `capaDaArena(db, arenaId): Promise<string | null>`
- O envio ao R2 acontece fora da transação (Task 3). Se ele falhar, a action apaga a linha reservada.

- [ ] Testes falhando para cada função, incluindo os casos do Review Focus e o isolamento entre arenas.
- [ ] Implementar a migração e as funções.
- [ ] Rodar a suíte e o typecheck. Commit `feat(fotos): tabela e regras das fotos da arena e das quadras`.

### Task 2: R2 envia e lê

**Files:**
- Modify: `app/lib/r2.ts`
- Test: `tests/r2.test.ts`

**Acceptance:**
- `enviar(chave, corpo: Uint8Array, tipo: string): Promise<void>`
  - PUT assinado, com `Content-Type`.
  - Status fora de 2xx → `ErroR2` com o status. Falha de rede → `ErroR2` com status 0.
- `ler(chave): Promise<Response | null>`
  - GET assinado (cabeçalho, não query). 404 → null.
  - Outro status de erro → `ErroR2`. Falha de rede → `ErroR2` com status 0.
- O comentário do topo do arquivo é atualizado: o app agora também envia fotos.

- [ ] Testes falhando com `fetcher` falso: método, host, caminho, content-type, 404, 500 e rede.
- [ ] Implementar.
- [ ] Suíte e typecheck. Commit `feat(r2): enviar e ler objetos`.

### Task 3: Actions, rota `/fotos/<id>` e limite do corpo

**Files:**
- Create: `app/painel/fotos/actions.ts` (`"use server"`)
- Create: `app/lib/fotos-envio.ts` (orquestra o envio sem Next, para poder testar)
- Create: `app/fotos/[id]/route.ts`
- Modify: `next.config.ts` (`experimental.serverActions.bodySizeLimit: "3mb"`)
- Test: `tests/fotos-envio.test.ts`

**Acceptance:**
- `enviarFoto(db, r2, arenaId, quadraId | null, arquivo: { bytes: Uint8Array }): Promise<{ ok: true } | { ok: false; erro }>`
  - Valida tamanho e tipo antes de tocar no banco.
  - Chama `reservarFoto` e depois `r2.enviar`.
  - Se o envio falha, apaga a linha e devolve `Não foi possível enviar a foto. Tente de novo.`
- `servirFoto(db, ler, fotoId): Promise<Response>` cumpre as regras da rota em Global Constraints. A rota só chama essa função.
- **Actions:**
  - `enviarFotosAction(estado, form)`:
    - Um ou mais `foto` no form; `quadraId` vazio = arena.
    - Envia em ordem e para no primeiro erro.
    - Devolve `{ erro, enviadas, versao }`.
  - `apagarFotoAction`, `moverFotoAction` e `capaFotoAction`, no formato de `EstadoConfirmar` ou de um form simples.
  - Todas fazem `revalidatePath` do painel (`/painel`, `/painel/arena`, `/painel/quadras/[id]`). Nada de caminho vindo do form.
- Sem R2 → `Armazenamento de fotos não configurado.`

- [ ] Testes falhando de `enviarFoto` (tamanho, tipo falso, limite, falha do R2 desfaz a linha) e de `servirFoto` (404, 200 com cabeçalhos, 502).
- [ ] Implementar a lib, a rota, as actions e o config.
- [ ] Suíte e typecheck. Commit `feat(fotos): envio pelo painel e rota pública das fotos`.

### Task 4: Tela de fotos no painel

**Files:**
- Create: `app/painel/fotos/fotos.tsx` (componente cliente `FotosDoDono`)
- Create: `app/painel/fotos/reduzir.ts` (função pura de tamanho + redução no navegador)
- Modify: `app/painel/arena/page.tsx` (seção "Fotos da arena")
- Modify: `app/painel/quadras/[id]/page.tsx` (seção "Fotos da quadra", logo depois de "Quadra")
- Modify: `app/globals.css` (bloco `ft-`)
- Test: `tests/fotos-reduzir.test.ts`

**Acceptance:**
- `medidaReduzida(largura, altura, max = 1600)` → `{ largura, altura }`: mantém a proporção e nunca aumenta. É testada.
- **Grade de miniaturas:**
  - `img src="/fotos/<id>"` com `alt` "Foto 1 da quadra" etc. e `loading="lazy"`, em 4:3 com `object-fit: cover`.
  - A primeira leva o selo "Capa".
  - Cada foto tem "Mover para a esquerda" e "Mover para a direita" (botões com ícone ‹ › e `aria-label`), "Usar como capa" (menos na capa) e "Apagar" com `Confirmar`.
- Contador "3 de 6 fotos".
- **Envio:**
  - `input type="file" accept="image/jpeg,image/png,image/webp" multiple`.
  - Ao escolher, o cliente reduz cada arquivo (`createImageBitmap` + canvas → `toBlob("image/webp", 0.82)`) e envia pela action.
  - Se a redução falhar, vai o original.
  - Mostra "Enviando 2 de 3…" e depois o erro ou o ok.
  - Com o limite atingido, o campo some e aparece "Limite de fotos atingido".
- Sem JavaScript, o form com `input file` + botão "Enviar" funciona sem a redução.
- Sem R2, o aviso `Armazenamento de fotos não configurado.` aparece e o envio fica escondido.
- No celular (390 px), a grade fica em 2 colunas; no computador, em 3 ou 4. Claro e escuro conferidos no navegador.

- [ ] Teste de `medidaReduzida`.
- [ ] Implementar o componente, as seções e o CSS.
- [ ] Suíte e typecheck, e conferir no navegador.
- [ ] Commit `feat(painel): fotos da arena e das quadras`.

### Task 5: Capas no painel e em Minhas reservas

**Files:**
- Modify: `app/lib/painel.ts` (`listarQuadras` com `capaId`), `app/painel/page.tsx`
- Modify: `app/lib/reservas.ts` (`ReservaJogador.fotoId`: capa da quadra, senão da arena, senão null), `app/minhas-reservas/page.tsx`, `app/globals.css`
- Test: `tests/painel.test.ts`, `tests/reservas.test.ts`

**Acceptance:**
- **Lista de quadras do painel:** cada cartão mostra a capa (4:3) ou um fundo neutro com o esporte (ou "Sem foto").
- **Cartão de Minhas reservas:** a faixa `.rv-foto` vira a imagem (`img` com `alt=""`, porque é decorativa ao lado do nome) quando há `fotoId`. Sem foto, fica o degradê de hoje.
- Uma consulta só para as capas, sem consulta por linha.

- [ ] Testes falhando (capa da quadra vence a da arena; sem nenhuma → null; capa é a de posição 0).
- [ ] Implementar.
- [ ] Suíte, typecheck e navegador.
- [ ] Commit `feat(fotos): capas na lista de quadras e em minhas reservas`.
