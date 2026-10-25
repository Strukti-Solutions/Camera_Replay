# Visual novo — Minhas reservas em cartões

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Trocar a lista de texto de `/minhas-reservas` por cartões sobre um fundo, com abas "Próximas" e "Histórico" e páginas, e dar ao detalhe da reserva duas colunas (dados de um lado, lances do outro).

**Architecture:** Abas e páginas vêm da URL (`?aba=historico&pagina=2`), sem JavaScript; regras puras (ler aba e página, paginar, textos curtos do cartão) em `app/minhas-reservas/apresentacao.ts`. `reservasDoJogador` passa a devolver o id e o esporte da quadra e o endereço/coordenadas da arena (para "Como chegar" e "Reservar de novo"). A foto da quadra ainda não existe (fase 3): a faixa da foto é um degradê.

**Tech Stack:** Next.js 15 App Router, React 19, Postgres (PGlite nos testes), Vitest.

**Spec:** `docs/superpowers/specs/2026-10-24-visual-novo-design.md`, seção "Minhas reservas (jogador)" e anti-meta "Listas infinitas de texto puro". Maquete: `.superpowers/brainstorm/2811-1792859524/content/jogador-reservas-v2.html`.

## Global Constraints

- Todo texto em português. Fuso America/Sao_Paulo (`partesDoInstante`, `hojeLocal` de `app/lib/disponibilidade.ts`).
- Regras que não mudam: cancelamento grátis até 24 h antes (`podeCancelarJogador`), "Pagamento na arena", lances por até 3 dias, `cancelarReservaAction` como está.
- Nada da URL é exibido: `aba` só aceita `historico` (o resto é "próximas"); `pagina` só aceita `^[1-9]\d{0,3}$` e é limitada à última página existente.
- 6 cartões por página (`POR_PAGINA = 6`). A paginação só aparece com mais de uma página.
- Sai o link "Minha conta" do fim da página (já está no topo). Sai o "Olá, nome": o título é "Minhas reservas".
- "Compartilhar" fica de fora: o link do vídeo é assinado e temporário, compartilhar exporia o vídeo a quem receber. "Baixar" já existe no carrossel.
- Funções de banco: id que não é uuid se comporta como inexistente (padrão atual).
- Testes com `node node_modules/vitest/vitest.mjs run --no-file-parallelism` (nunca dois vitest ao mesmo tempo); typecheck com `node node_modules/typescript/bin/tsc --noEmit`. Não rodar `npm run build` com o `next dev` aberto.
- Commits em Conventional Commits, `git add` explícito (nunca `.claude/settings.json`), terminando com `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`. Branch `feat/visual-novo`.

## Review Focus

- **Página fora do intervalo:** `?pagina=99` com 2 páginas mostra a página 2; `?pagina=0`, `-1`, `1.5`, `abc`, `01` mostram a 1. Teste na Task 2.
- **Prazo de cancelar:** "cancelamento grátis até dom 25, 18h" é o início menos 24 h, no fuso de São Paulo, inclusive quando o início é 0h30 (vira o dia anterior às 0h30). Teste na Task 2.
- **Fim à meia-noite:** 22h–24h sai "22h às 24h" no cartão. Teste na Task 2.
- **Endereço vazio:** sem coordenadas e sem endereço, "Como chegar" não aparece (`linkComoChegar` devolve null).
- **Isolamento:** `reservasDoJogador` continua só com reservas do jogador da sessão. Teste existente cobre; não afrouxar.

---

### Task 1: `reservasDoJogador` com quadra e endereço da arena

**Files:**
- Modify: `app/lib/reservas.ts` (`ReservaJogador`, `reservasDoJogador`)
- Test: `tests/reservas.test.ts`

**Acceptance:**
- `ReservaJogador` ganha `quadraId: string`, `esporte: string` e, em `arena`, `latitude: number | null`, `longitude: number | null`, `endereco: { rua, numero, bairro, cidade, uf, cep }` (cada um `string | null`, mesmo formato de `Endereco` em `app/a/[slug]/apresentacao.ts`).
- Latitude/longitude saem como `Number(...)` quando não nulas (o driver pode devolver texto para numeric).
- Ordem, filtro, `podeCancelar`, `lances` e a separação próximas/histórico ficam iguais.

- [ ] Teste falhando em `tests/reservas.test.ts`: uma reserva do jogador numa arena com endereço e coordenadas devolve `quadraId`, `esporte` e os campos da arena; arena sem endereço devolve `null` nos campos e nas coordenadas.
- [ ] Implementar (colunas `q.id`, `q.esporte`, `a.latitude`, `a.longitude`, `a.endereco_*` no select).
- [ ] Rodar a suíte inteira e o typecheck; commit `feat(reservas): reservas do jogador com quadra e endereço da arena`.

### Task 2: Regras puras de Minhas reservas

**Files:**
- Modify: `app/minhas-reservas/apresentacao.ts`
- Test: `tests/minhas-reservas-apresentacao.test.ts`

**Acceptance (assinaturas exatas):**
- `type Aba = "proximas" | "historico"`; `lerAba(v: string | string[] | undefined): Aba` — só `"historico"` (primeiro valor, se lista) vira histórico.
- `POR_PAGINA = 6`; `paginar<T>(lista: T[], pagina: string | string[] | undefined, porPagina = POR_PAGINA): { itens: T[]; pagina: number; totalPaginas: number }` — `totalPaginas` ≥ 1 (lista vazia = 1); página inválida = 1; maior que a última = última.
- `hrefLista(aba: Aba, pagina: number): string` — `/minhas-reservas`, `/minhas-reservas?pagina=2`, `/minhas-reservas?aba=historico`, `/minhas-reservas?aba=historico&pagina=3` (página 1 não vai na URL).
- `seloData(inicio: Date): { semana: string; dia: string }` — `{ semana: "seg", dia: "26" }`; semana em 3 letras minúsculas sem ponto (`dom seg ter qua qui sex sáb`), dia sem zero à esquerda.
- `textoHorario(inicio: Date, fim: Date): string` — `"18h às 20h"`, `"15h30 às 17h15"`, `"22h às 24h"` (reusa `fimEmMinutos`).
- `textoCancelaAte(inicio: Date): string` — `"cancelamento grátis até dom 25, 18h"` (início − 24 h, mesmo formato de `seloData` + `textoMinutos`).
- `seloDaReserva(r: { situacao: string; canceladaPor: string | null; motivoCancelamento: string | null; fim: Date }, agora: Date): { texto: string; tom: "ok" | "jogada" | "cancelada" }` — confirmada que não terminou: `Confirmada`/ok; confirmada que terminou: `Jogada`/jogada; cancelada: texto de `rotuloSituacao` (com o motivo do dono)/cancelada.
- `textoPeriodo` e `rotuloSituacao` continuam (o detalhe ainda pode usar).

- [ ] Testes falhando para cada função, incluindo os casos do Review Focus (página 99/0/-1/1.5/abc/01, início 0h30, fim à meia-noite).
- [ ] Implementar.
- [ ] Rodar a suíte inteira e o typecheck; commit `feat(minhas-reservas): abas, páginas e textos curtos do cartão`.

### Task 3: Página em cartões

**Files:**
- Modify: `app/minhas-reservas/page.tsx`
- Modify: `app/globals.css` (bloco novo com prefixo `rv-`, perto dos outros blocos de página)

**Acceptance (conferido no navegador, computador e celular 390 px, claro e escuro):**
- `<main className="miolo-largo">`; `<h1>Minhas reservas</h1>`; a mensagem `?ok=` continua (role status).
- Fundo: um painel `.rv-painel` (fundo `var(--realce)` no claro e um tom do azul no escuro, raio `var(--raio)`, padding) que envolve abas, cartões e paginação.
- Abas: `<nav aria-label="Reservas">` com dois links (`hrefLista(aba, 1)`), o ativo com `aria-current="page"`; textos `Próximas (n)` e `Histórico (n)`. Visual de pílulas no padrão de `.hr-abas`/`.hr-aba` (alvo de 48 px).
- Cartões: `<ul className="rv-grade">` com `<li className="rv-cartao">`; 2 colunas a partir de 48rem, 1 coluna abaixo. Cada cartão: faixa da foto à esquerda (`.rv-foto`, degradê decorativo `aria-hidden`, duas variações alternadas), selo de data (`.rv-data`: semana pequena em cima, dia grande; azul primário nas próximas, cinza `--navy-400` no histórico), nome da arena (link para `/a/<slug>`), `quadra · esporte`, `textoHorario · valor` (valor em negrito), selo de situação (`seloDaReserva`, cores: ok verde `--sucesso`, cancelada `--perigo`, jogada neutro).
- Próximas: linha pequena `Pagamento na arena · cancelamento grátis até …` quando `podeCancelar`; quando não pode mais, só `Pagamento na arena`. Botões: "Como chegar" (`linkComoChegar`, `target="_blank" rel="noopener noreferrer"`, só se houver link) e "Cancelar" (o `Confirmar` atual, só se `podeCancelar`).
- Histórico: selo `n lances` (`textoLances`) quando `lances > 0`; botões "Ver lances" (`/minhas-reservas/<id>`, só com lances) e "Reservar de novo" (`/a/<slug>?quadra=<quadraId>`, com `encodeURIComponent` nos dois).
- Paginação (`<nav aria-label="Páginas">`) só com `totalPaginas > 1`: ‹ anterior, números, › próxima, como links `hrefLista`; a atual com `aria-current="page"`; ‹ e › somem na primeira/última página.
- Vazio: próximas → "Nenhuma reserva marcada." e um botão "Buscar quadras" (`/`); histórico → "Nada no histórico ainda.".
- Sem o link "Minha conta" no fim.
- Foco visível em todos os links e botões; nada estoura na largura de 390 px.

- [ ] Implementar a página e o CSS.
- [ ] Rodar a suíte inteira e o typecheck.
- [ ] Conferir no navegador (dev em `localhost:3000`, conta `reserva1@teste.local`): as duas abas, uma página 2 (criar reservas de teste se precisar), claro e escuro, 390 px.
- [ ] Commit `feat(minhas-reservas): reservas em cartões com abas e páginas`.

### Task 4: Detalhe da reserva em duas colunas

**Files:**
- Modify: `app/minhas-reservas/[id]/page.tsx`
- Modify: `app/globals.css` (mesmo bloco `rv-`)

**Acceptance:**
- `<main className="miolo-largo">` com `LinkVoltar` para `/minhas-reservas`; grade `.rv-detalhe` de 2 colunas (1fr 1.3fr) a partir de 48rem, 1 coluna abaixo.
- Coluna 1, cartão de dados: selo de data, arena (link) e `quadra · esporte`; lista `<dl>` com Horário (`textoHorario`), Valor, Pagamento ("Na arena"), Situação (`seloDaReserva`); botão "Reservar de novo".
- Coluna 2, cartão de lances: título `Seus lances (n)` e o texto curto "ficam disponíveis por até 3 dias"; dentro, a `Galeria` atual (sem mudar o componente; se os `miolo` internos dela atrapalharem a largura, ajustar só pelo CSS do bloco `rv-`).
- Mesmas regras de acesso de hoje (`exigirJogador`, `notFound` para reserva de outro jogador ou inexistente).

- [ ] Implementar a página e o CSS.
- [ ] Rodar a suíte inteira e o typecheck.
- [ ] Conferir no navegador (uma reserva passada com lance, se houver; senão o estado vazio da galeria), claro e escuro, 390 px.
- [ ] Commit `feat(minhas-reservas): detalhe da reserva com dados e lances lado a lado`.
