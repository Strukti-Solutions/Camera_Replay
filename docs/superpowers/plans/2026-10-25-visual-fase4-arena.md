# Visual novo — Fase 4: página da arena em carrossel

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A página `/a/<slug>` vira duas metades no computador (foto quadrada à esquerda, cartão da reserva à direita) e uma coluna no celular (balão do endereço, foto 4:3, cartão). O cartão da reserva tem três passos: quadra, dia num calendário do mês e horários.

**Architecture:** Os passos vêm da URL, sem JavaScript:
- sem `quadra` → passo 1;
- `quadra` sem `dia` → passo 2, com `mes=AAAA-MM` opcional;
- `quadra` + `dia` → passo 3. O 3 mantém o contrato atual (`inicio`, `qtd`).

As regras puras (passo, mês, estado de cada dia, links) ficam em `app/a/[slug]/apresentacao.ts`. Os dados (fotos, capas, "a partir de", períodos ocupados da janela inteira) vêm de `app/lib/arenas-publicas.ts`. As fotos da arena passam sozinhas num componente cliente; sem JavaScript, fica a primeira.

**Tech Stack:** Next.js 15 App Router, React 19, Postgres (PGlite nos testes), Vitest.

**Spec:** `docs/superpowers/specs/2026-10-24-visual-novo-design.md`, seção "Página da arena (jogador)". Maquete: `.superpowers/brainstorm/2811-1792859524/content/arena-passos-v2.html`.

## Decisões do construtor

- **Clicar num dia já abre os horários (passo 3).** Sai o botão "Ver horários" da maquete: é um clique a menos e o dia escolhido já aparece no topo do passo 3.
- **Estados do dia no calendário:**
  - **livre:** 3 ou mais horários livres;
  - **poucos:** 1 ou 2 livres;
  - **indisponível:** nenhum livre, dia passado, fora da janela de 30 dias ou sem horário.
- **Calendário:** mostra só os meses que tocam a janela (no máximo dois). As setas ‹ › só aparecem quando há outro mês.
- **Fotos da arena:** trocam a cada 5 s.
  - Param com o mouse em cima, com o foco dentro, e com "menos movimento" no aparelho.
  - As bolinhas são botões.
- **Sem foto:** fundo neutro com o nome da arena (passo 1) ou o esporte da quadra (passos 2 e 3).
- **Foto nos passos 2 e 3:** a capa da quadra, ou a capa da arena se a quadra não tiver.

## Global Constraints

- **Contrato da URL:**
  - O passo 3 continua `?quadra&dia&inicio&qtd`.
  - Links velhos (`?quadra=` sozinho, de "Reservar de novo") abrem o passo 2.
  - `mes` inválido ou fora da janela vira o mês de hoje.
  - Nada da URL é exibido.
- **A âncora dos links passa a ser `#reserva`** (o cartão), no lugar de `#quadra-<id>`, inclusive no "voltar" de `/reservar`.
- **Regras de reserva que não mudam:**
  - horários do dono;
  - até 4 seguidos e 12 h;
  - janela hoje +30;
  - só horários que começam depois de agora.
- **Arena suspensa:** continua só com o aviso.
- **Uma consulta de períodos ocupados por quadra escolhida**, para a janela inteira. As outras quadras não precisam de períodos no passo 1.
- **Comandos:**
  - testes: `node node_modules/vitest/vitest.mjs run --no-file-parallelism`;
  - typecheck: `node node_modules/typescript/bin/tsc --noEmit`.
- **Commits:** Conventional Commits e `git add` explícito, terminando com `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`. Branch `feat/visual-novo`.

## Review Focus

- **Virada de mês:** com hoje em 25/10, a janela vai até 24/11, e o mês 11 mostra os dias até 24 disponíveis e o resto apagado. Teste na Task 2.
- **Dia de hoje com todos os horários já começados** → indisponível. Teste na Task 2.
- **`mes=2027-01` ou `mes=lixo`** → mês de hoje. Teste na Task 2.
- **Horário ocupado em parte do dia** (reserva das 18h às 20h) tira só os horários que tocam esse período. Teste na Task 1/2.

---

### Task 1: Dados da página

**Files:**
- Modify: `app/lib/arenas-publicas.ts`
- Test: `tests/arenas-publicas.test.ts`

**Acceptance:**
- **`ArenaPublica` ganha campos:**
  - `fotos: string[]`: ids das fotos da arena, em ordem.
  - Em cada quadra, `capaId: string | null` e `aPartirDe: number | null` (menor preço entre os horários da quadra).
- **`periodosPublicosEntre(db, quadraId, de: string, ate: string): Promise<Periodo[]>`**
  - Devolve os períodos de reserva e bloqueio que tocam os dias locais `de` a `ate`, inclusive.
  - Só início e fim.
  - Id que não é uuid não toca o banco.

- [ ] Testes falhando.
- [ ] Implementar.
- [ ] Rodar a suíte e o typecheck.
- [ ] Commit `feat(arena): fotos, capas, a partir de e períodos da janela`.

### Task 2: Regras puras dos passos e do calendário

**Files:**
- Modify: `app/a/[slug]/apresentacao.ts`
- Test: `tests/a-apresentacao.test.ts`

**Acceptance (assinaturas):**
- `passoDaEscolha(e: { quadra: string | null; diaNaUrl: boolean }): 1 | 2 | 3`
- `lerMes(v, agora): string` (AAAA-MM). Só aceita meses que tocam a janela; o resto vira o mês de hoje.
- `mesesDaJanela(agora): string[]` (1 ou 2 meses).
- `estadoDoDia(livres: number, valido: boolean): "livre" | "poucos" | "indisponivel"`
- `calendarioDoMes(mes, agora, livresPorDia: Map<string, number>): { dia: string; numero: number; doMes: boolean; estado }[][]`
  - Semanas de domingo a sábado, com os dias de fora do mês para completar.
  - `valido` = dia dentro da janela; o número de livres vem do mapa.
- `livresPorDia(horarios, agora, ocupados): Map<string, number>`, para os dias da janela (usa `horariosDoDia`).
- `nomeDoMes(mes)` → "Outubro 2026".
- **Links:**
  - `hrefPasso1(slug)` → `/a/<slug>#reserva`
  - `hrefPasso2(slug, quadra, mes?)`
  - `hrefPasso3(slug, quadra, dia)`
  - `hrefDoHorario` passa a terminar em `#reserva`.
  - Tudo com `encodeURIComponent`.

- [ ] Testes falhando, incluindo os casos do Review Focus.
- [ ] Implementar.
- [ ] Rodar a suíte e o typecheck.
- [ ] Commit `feat(arena): passos, calendário e links da reserva`.

### Task 3: Página em duas metades com o carrossel de passos

**Files:**
- Modify: `app/a/[slug]/page.tsx`, `app/a/[slug]/escolha.tsx` (vira o passo 3), `app/reservar/page.tsx` (âncora)
- Create: `app/a/[slug]/fotos-arena.tsx` (cliente: fotos que passam), `app/a/[slug]/passos.tsx` (passos 1 e 2 e cabeçalho do cartão)
- Modify: `app/globals.css` (bloco `ar-`)

**Acceptance (conferido no navegador, computador e celular 390 px, claro e escuro):**
- **Estrutura:** `main.miolo-largo`, "← Voltar".
- **Balão:** pino, nome (h1) e endereço.
  - Se houver link, o balão inteiro é o link "Como chegar ›" (`target=_blank`, `rel=noopener noreferrer`).
- **Palco (foto):**
  - 1:1 no computador (≥ 56rem, em duas colunas iguais) e 4:3 no celular.
  - **Passo 1:** fotos da arena passando, com bolinhas.
  - **Passos 2 e 3:** capa parada, com a etiqueta "Quadra · Esporte" no canto.
- **Cartão `#reserva`:**
  - Cabeçalho com "‹ voltar ao passo anterior" (link) e três tracinhos de progresso (`aria-label` "Passo N de 3").
  - **Passo 1:** "1. Escolha a quadra". Lista de quadras com nome · esporte, "a partir de R$ X", e link para o passo 2. Quadra sem horário: "Reservas indisponíveis", sem link.
  - **Passo 2:** "2. Escolha o dia" e "‹ Outubro 2026 ›".
    - Grade de 7 colunas que cresce até a altura do cartão.
    - Os dias válidos são links para o passo 3; os indisponíveis, texto apagado.
    - Legenda: livre, poucos horários, indisponível.
  - **Passo 3:** "3. Escolha os horários", com o dia por extenso.
    - As caixinhas e o resumo de hoje, com "Pagamento na arena · cancelamento grátis até 24 h antes" e Reservar.
- **Arena sem quadras:** "Reservas indisponíveis" no cartão.
- **Sem estouro** em 390 px e com foco visível.

- [ ] Implementar.
- [ ] Rodar a suíte e o typecheck.
- [ ] Conferir no navegador os três passos, a virada de mês, sem foto e com foto.
- [ ] Commit `feat(arena): página da arena em duas metades com carrossel de passos`.
