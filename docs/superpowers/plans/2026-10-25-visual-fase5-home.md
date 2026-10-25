# Visual novo — Fase 5: home com cards, filtro de esporte e mapa

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A home (`/`) deixa de ser uma lista de nomes e passa a mostrar cards com foto. Fica assim:
- **No computador:** busca e filtro de esporte em cima; cards à esquerda e mapa sempre aberto à direita.
- **No celular:** título, busca e filtro de esporte; "Arenas em destaque" em carrossel e, depois de buscar, uma lista; botão flutuante "Ver no mapa" que abre o mapa em tela cheia, com preço no pino e o card da arena embaixo.

**Architecture:** A busca e o esporte vêm da URL (`/?busca=&esporte=`), sem JavaScript. Os dados ficam em `app/lib/arenas-publicas.ts`:
- uma consulta para os cards (foto, bairro, "a partir de", esportes);
- uma para os esportes do filtro;
- os pontos do mapa ganham o preço e o bairro.

As regras puras (ler o esporte, texto do preço, links) ficam em `app/escolha-arena.ts`. O mapa continua sendo um extra: sem JavaScript a lista basta.

**Tech Stack:** Next.js 15 App Router, React 19, Leaflet, Postgres (PGlite nos testes), Vitest.

**Spec:** `docs/superpowers/specs/2026-10-24-visual-novo-design.md`, seção "Home (busca)". Maquetes: `home-computador.html` (opção B) e `home-celular.html`, em `.superpowers/brainstorm/2811-1792859524/content/`.

## Decisões do construtor

- **"/h" no preço:**
  - Mostra "a partir de R$ X/h" quando todos os horários da arena têm 1 h.
  - Mostra "a partir de R$ X" quando algum tem outra duração.
  - Arena sem horário: "Reservas indisponíveis".
- **Fotos no card:** faixa com rolagem lateral (scroll-snap) e bolinhas, sem troca automática. Com dez cards passando sozinhos a página ficaria agitada demais.
  - Até 5 fotos por card: a capa da arena e as seguintes.
  - Sem foto: fundo neutro com o nome.
- **A busca também casa com o esporte das quadras.** "padel" acha as arenas com quadra de Padel, como na maquete.
- **Filtro de esporte:**
  - Os chips são links (`?esporte=Padel`), com "Todos" primeiro.
  - Só aparecem os esportes de arenas ativas.
  - A comparação ignora acento e maiúscula.
  - Um esporte que não existe vira "Todos".
- **Celular, sem busca e sem filtro:** "Arenas em destaque" em carrossel horizontal com as arenas em ordem de nome. Ainda não existe critério de destaque. Com busca ou filtro, vira lista vertical com "N arenas encontradas".
- **Mapa:**
  - **No computador:** coluna da direita, presa ao rolar, com a altura da tela. Passar o mouse ou focar um card destaca o pino.
  - **No celular:** o mapa só aparece pelo botão flutuante. O pino tem o preço ("R$ 80"), e tocar num pino mostra o card daquela arena embaixo do mapa. "← Voltar à lista" e Esc fecham o mapa.
- **O mapa mostra só as arenas do resultado** (busca e filtro), não todas.

## Global Constraints

- **Contrato da URL:** `/?busca=&esporte=`.
  - Parâmetro repetido vale o primeiro.
  - O texto do esporte nunca é exibido cru: o chip ativo vem da lista do banco.
  - `?ok=conta-apagada` continua.
- **Só dados de vitrine:** nome, slug, bairro, cidade, coordenadas, fotos, preço mínimo e esportes. Nada de dono, taxa ou câmera. Arena suspensa fica fora de tudo.
- **Desempenho:** no máximo 50 cards e consultas em lote, nunca uma por arena.
- **Comandos:**
  - testes: `node node_modules/vitest/vitest.mjs run --no-file-parallelism`;
  - typecheck: `node node_modules/typescript/bin/tsc --noEmit`.
- **Commits:** Conventional Commits e `git add` explícito, terminando com `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`. Branch `feat/visual-novo`.

## Review Focus

- Arena suspensa e arena sem quadra no filtro de esporte.
- Esporte com acento ("Futevôlei" vs "futevolei").
- Fotos de quadra não entram no card, só as da arena.
- `busca` com `%`, `_` ou aspas.
- O mapa sem pontos não quebra a página.

---

### Task 1: Dados dos cards, do filtro e do mapa

**Files:**
- Modify: `app/lib/arenas-publicas.ts`
- Test: `tests/arenas-publicas.test.ts`

**Acceptance:**
- **`cartoesDeArenas(db, { busca?, esporte? }): Promise<CartaoArena[]>`**
  - Cada cartão traz `{ nome, slug, bairro, cidade, latitude, longitude, fotos: string[] (até 5), aPartirDe: number | null, porHora: boolean, esportes: string[] }`.
  - Só arenas ativas, ordenadas por nome, até 50.
  - A busca casa com nome, endereço e esporte das quadras.
  - O esporte filtra as arenas que têm uma quadra daquele esporte (sem acento e sem maiúscula).
  - `porHora` só é verdadeiro quando há horários e todos têm 60 min.
- **`esportesDasArenas(db): Promise<string[]>`:** os esportes não vazios das quadras de arenas ativas, sem repetir (sem acento e sem maiúscula), ordenados.
- **`arenasNoMapa`** fica como está. A home passa a montar os pontos a partir dos cartões.

- [ ] Testes falhando.
- [ ] Implementar.
- [ ] Rodar a suíte e o typecheck.
- [ ] Commit `feat(home): dados dos cards, esportes e preço mínimo`.

### Task 2: Regras puras da home

**Files:**
- Modify: `app/escolha-arena.ts`
- Test: `tests/escolha-arena.test.ts` (criar se não existir)

**Acceptance:**
- `lerEsporte(v, esportes): string | null`: devolve o item da lista que casa sem acento e sem maiúscula. O resto vira null.
- `textoAPartirDe(c)`: "a partir de R$ 80,00/h", "a partir de R$ 80,00" ou "Reservas indisponíveis".
- `textoPino(c)`: "R$ 80", ou "" sem preço.
- `hrefHome({ busca, esporte })`: monta `/?busca=&esporte=` e omite os vazios.
- `textoEncontradas(n)`: "1 arena encontrada" ou "N arenas encontradas".

- [ ] Testes falhando.
- [ ] Implementar.
- [ ] Rodar a suíte e o typecheck.
- [ ] Commit `feat(home): regras do filtro, preço e links`.

### Task 3: Página e componentes

**Files:**
- Modify: `app/page.tsx`, `app/componentes/mapa-arenas.tsx`, `app/componentes/mapa-arenas-calculo.ts` (pontos com preço e bairro), `app/globals.css` (bloco `hm-`)
- Create: `app/componentes/cartao-arena.tsx` (servidor)

**Acceptance (conferido no navegador, computador e celular 390 px, claro e escuro):**
- `main.miolo-largo`. Título "Encontre uma quadra e reserve".
- **Busca:** a atual, com sugestões. O formulário leva o esporte escolhido num campo escondido.
- **Chips de esporte:** links com `aria-current` no ativo, quebrando linha ou rolando no celular sem estourar.
- **Card:** fotos com rolagem lateral e bolinhas, nome (link para `/a/<slug>`, e o card inteiro clicável), bairro (ou cidade), preço e chips de esporte.
- **Computador (≥ 56rem):** duas colunas, lista e mapa; o mapa preso ao rolar; hover ou foco no card destaca o pino.
- **Celular:**
  - Sem busca: "Arenas em destaque" em carrossel horizontal.
  - Com busca: "N arenas encontradas" em lista.
  - Botão flutuante "Ver no mapa".
  - Mapa em tela cheia com preço no pino; tocar no pino mostra o card embaixo; "← Voltar à lista" e Esc fecham.
- Nenhuma arena: "Nenhuma arena encontrada."
- Sem estouro em 360 px. Foco visível. Funciona sem JavaScript, sem o mapa.

- [ ] Implementar.
- [ ] Rodar a suíte e o typecheck.
- [ ] Conferir no navegador: sem busca, com busca, filtro, mapa no computador e no celular.
- [ ] Commit `feat(home): cards com foto, filtro de esporte e mapa ao lado`.
