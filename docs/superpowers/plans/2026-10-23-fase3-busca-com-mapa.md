# Fase 3 — Busca pública com mapa: plano de implementação

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** O jogador acha a arena pela busca (nome ou endereço) ou pelo mapa, abre a página pública da arena e vê, em cada quadra, os horários reserváveis de um dia e o preço total da escolha; o botão "Reservar" fica para a fase 4.

**Architecture:** Um módulo puro (`app/lib/disponibilidade.ts`) calcula, a partir da tabela de preços da quadra, do dia e de "agora" em `America/Sao_Paulo`, os inícios livres, quantas horas cabem em seguida e o preço por hora. A lista pública de arenas passa a buscar por nome e endereço e a fornecer os pontos do mapa. A página `/a/<slug>` vira pública: a escolha (quadra, dia, início, horas) vai na URL por formulário GET, então funciona sem JavaScript e já serve de ponto de volta para a fase 4. A home ganha sugestões enquanto digita (rota GET pública) e um mapa Leaflet + OpenStreetMap carregado só no navegador.

**Tech Stack:** Next.js 15, Postgres (PGlite nos testes), Vitest, `leaflet@1.9.4` (única dependência nova; tiles do OpenStreetMap).

**Spec:** `docs/superpowers/specs/2026-10-22-reservas-publicas-design.md` (seção "Fase 3").

## Global Constraints

- Branch `feat/fase3-busca-mapa`, a partir de `main`. `npm test` e `npm run typecheck` verdes ao fim de cada tarefa (se `npm`/`npx` travarem nesta máquina: `node node_modules/typescript/bin/tsc --noEmit` e `node node_modules/vitest/vitest.mjs run`); build só com o `next dev` parado.
- Só arenas **ativas** aparecem na busca, nas sugestões, no mapa e na página pública com quadras; arena suspensa em `/a/<slug>` mostra o aviso de suspensão de hoje (`MENSAGEM_ARENA_SUSPENSA`); slug inexistente → 404. Dado público: nome, slug, endereço, coordenadas, quadras (nome, esporte), faixas de preço. Nada de dono, e-mail, taxa, câmera, botão ou clipe.
- Busca: até 80 caracteres, sem curingas (`%` e `_` valem como texto), sem diferença de maiúsculas e **de acentos** (`"sao paulo"` acha `"São Paulo"`), em nome, rua, bairro, cidade e UF; até 50 resultados; sugestões até 8.
- Disponibilidade: dia de **hoje até 30 dias à frente** (data local `YYYY-MM-DD` em `America/Sao_Paulo`); início em hora cheia dentro de uma faixa da tabela daquele dia da semana e **depois de agora** (hoje: início > hora atual; às 18h00 em ponto, 18h não entra); horas de **1 a 4**, só enquanto cada hora seguinte também está na tabela (faixas encostadas contam como contínuas); cada hora é cobrada pelo preço da faixa em que começa. Na fase 3 não há reservas: "livre" = na tabela e no futuro. Parâmetros fora disso (dia passado, > 30 dias, malformado, hora inválida, horas fora de 1–4, quadra de outra arena) são ignorados e a página mostra o padrão (hoje, sem início escolhido), sem erro 500.
- Quadra sem nenhuma faixa: "Reservas indisponíveis". Dia sem horário livre: "Sem horários livres neste dia.".
- "Reservar" na fase 3: botão desabilitado com o texto "Reservas pelo site em breve" abaixo do total. A URL da escolha (`/a/<slug>?quadra=<id>&dia=<YYYY-MM-DD>&inicio=<h>&horas=<n>`) é o contrato que a fase 4 usa.
- Mapa: Leaflet 1.9.4 com tiles `https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png` e atribuição visível "© OpenStreetMap"; marcadores com `circleMarker` (sem imagens de ícone); toque no ponto abre um popup com o nome e o link "Ver arena"; mapa pequeno (240 px de altura) abaixo da busca e botão "Ver no mapa" que o expande para a tela inteira (e "Fechar mapa"). Sem JavaScript o mapa não aparece e a busca continua funcionando como formulário.
- "Como chegar": link `https://www.google.com/maps/search/?api=1&query=<lat>,<lon>` (ou o endereço em texto se não houver coordenadas), abre em nova aba com `rel="noopener noreferrer"`.
- pt-BR, WCAG AA, alvos de 48 px, identidade Strukti; páginas públicas funcionam sem JavaScript (exceto o mapa e as sugestões, que são extras).

## Review Focus

1. **Fronteira de dia e hora** (agora 23h30 → nenhum horário hoje; agora 17h59 → 18h livre; agora 18h00 → 18h não) e **dia na URL** passado, de 31 dias à frente ou `2026-02-30` → ignorado. Teste na Task 2.
2. **Busca com acento, maiúscula e curinga** (`"sao paulo"`, `"BEIRA"`, `"50%"`, `"_"`) → acha pelo texto, curinga literal. Teste na Task 3.
3. **Arena suspensa ou sem coordenadas** → fora do mapa; suspensa fora da busca e das sugestões; página pública da suspensa só com o aviso. Teste na Task 3.
4. **Horas além do contínuo** (tabela até 23h, início 21h, `horas=4`) → limitado a 2, total certo atravessando duas faixas (16h–18h = 80 + 120). Teste na Task 2.
5. **Parâmetros manipulados** (`horas=10`, `inicio=abc`, `quadra=<id de outra arena>`, `dia=<script>`) → ignorados, página normal. Teste na Task 4 (função que lê a escolha).

---

### Task 1: Pendências da fase 2

**Files:**
- Create: `db/migrations/0015_geocodificacao_tentada.sql`
- Modify: `app/painel/quadras/[id]/actions.ts` (`salvarQuadraAction` atômica, sem o import morto), `app/painel/quadras/[id]/page.tsx` (botões só leitura), `app/lib/painel.ts` (função que grava nome e esporte juntos), `app/lib/arena-dono.ts` (limite do Nominatim), `tests/painel.test.ts`, `tests/arena-dono.test.ts`, `tests/schema.test.ts`

**Interfaces:**
- Produces:
  - `salvarNomeEsporteQuadra(db, arenaId, quadraId, nome, esporte): Promise<{ ok: true } | { ok: false; erro: "nome" | "esporte" | "quadra" }>` em `app/lib/painel.ts` — um único `update quadras set nome = $, esporte = $ where id = $ and arena_id = $` depois de validar os dois (mesmas regras de `renomearQuadra` e `definirEsporteQuadra`).
  - `arenas.geocodificacao_tentada_em timestamptz` (0015). `atualizarArenaDono` só chama o geocodificador se a última tentativa da arena foi há mais de **60 s** (ou nunca); senão salva sem coordenadas e devolve `localizada: false`. Grava `geocodificacao_tentada_em = now()` a cada tentativa.

- **Botões só para leitura no painel do dono** (decisão do dono, 23/10: a Strukti instala os botões): a página da quadra do dono volta a listar os botões (criado em, visto em, revogado em), sem criar nem revogar, como já mostra o estado da câmera. Nunca mostra o token.

- [ ] **Step 1: testes que falham:** `"salvarNomeEsporteQuadra grava os dois ou nenhum"` (esporte com 41 caracteres → `erro: "esporte"` e nome **não** muda; outra arena → `erro: "quadra"`); `"geocodificador no máximo uma vez por minuto por arena"` (duas gravações seguidas com endereços diferentes → o falso é chamado 1 vez; depois de `update arenas set geocodificacao_tentada_em = now() - interval '61 seconds'` → chamado de novo); 0015 nas listas de migrações.
- [ ] **Step 2:** os testes falham.
- [ ] **Step 3:** implementar; `salvarQuadraAction` usa `salvarNomeEsporteQuadra`; tirar `import { emTransacao }` sem uso.
- [ ] **Step 4:** testes e typecheck verdes.
- [ ] **Step 5:** commit `fix: nome e esporte da quadra juntos, limite do geocodificador e botões só leitura no painel`.

### Task 2: Disponibilidade e preço da escolha (módulo puro)

**Files:**
- Create: `app/lib/disponibilidade.ts`, `tests/disponibilidade.test.ts`

**Interfaces:**
- Consumes: `Faixa` (`app/lib/precos.ts`).
- Produces (`app/lib/disponibilidade.ts`, sem banco):
  - `DIAS_A_FRENTE = 30`, `HORAS_MAX = 4`, `FUSO = "America/Sao_Paulo"`.
  - `hojeLocal(agora: Date): string` → `"YYYY-MM-DD"` no fuso.
  - `diaValido(dia: unknown, agora: Date): string | null` — formato `YYYY-MM-DD`, data real, de hoje a hoje + 30.
  - `diaDaSemana(dia: string): number` (0 = domingo).
  - `diasDisponiveis(agora: Date): { valor: string; rotulo: string }[]` — 31 dias; rótulos `"Hoje"`, `"Amanhã"` e depois `"Sáb, 25/10"`.
  - `type Inicio = { hora: number; horasMax: number }`
  - `iniciosLivres(faixas: Faixa[], dia: string, agora: Date): Inicio[]` — horas cheias reserváveis em ordem; `horasMax` = quantas horas seguidas (até `HORAS_MAX`) continuam na tabela a partir dali.
  - `type Escolha = { hora: number; horas: number; porHora: { hora: number; precoCentavos: number }[]; totalCentavos: number }`
  - `precoEscolha(faixas: Faixa[], dia: string, hora: number, horas: number, agora: Date): Escolha | null` — `null` se a hora não é um início livre ou se `horas` passa de `horasMax`.

- [ ] **Step 1: testes que falham** (`agora` fixo; ex.: `new Date("2026-10-23T21:30:00Z")` = 18h30 em São Paulo, sexta):
  - `"hojeLocal usa o fuso de São Paulo"`: `2026-10-24T02:30:00Z` → `"2026-10-23"`.
  - `"diaValido"`: hoje e hoje+30 aceitos; ontem, hoje+31, `"2026-02-30"`, `"23/10/2026"`, `"<script>"` → `null`.
  - `"diasDisponiveis"`: 31 itens, primeiro `"Hoje"`, segundo `"Amanhã"`, terceiro `"Dom, 25/10"`.
  - `"iniciosLivres respeita agora"`: tabela sexta 7–17 e 17–23; às 18h30 → inícios 19, 20, 21, 22 com `horasMax` 4, 3, 2, 1; às 17h59 (`20:59Z`) → começa em 18; às 18h00 (`21:00Z`) → começa em 19; às 23h30 → vazio; amanhã (sábado) sem faixas → vazio.
  - `"faixas encostadas são contínuas e o preço é por hora"`: sábado futuro com 7–17 a 8000 e 17–23 a 12000 → `precoEscolha(..., 16, 2)` = `{ totalCentavos: 20000, porHora: [{16, 8000}, {17, 12000}] }`.
  - `"horas além do contínuo"`: início 21 com `horas = 4` (tabela até 23) → `null`; `horas = 2` → total certo.
  - `"buraco na tabela corta a continuidade"`: 7–12 e 14–18 → `horasMax` de 11 é 1.
- [ ] **Step 2:** FAIL.
- [ ] **Step 3:** implementar com `Intl.DateTimeFormat` no fuso (sem libs).
- [ ] **Step 4:** PASS, typecheck.
- [ ] **Step 5:** commit `feat(reservas): horários livres e preço da escolha`.

### Task 3: Dados públicos — busca, sugestões, mapa e página da arena

**Files:**
- Modify: `app/lib/arenas-publicas.ts`, `tests/escolha-arena.test.ts` (ou o arquivo de teste que hoje cobre `listarArenasPublicas`)
- Create: `app/api/arenas/sugestoes/route.ts`

**Interfaces:**
- Produces (`app/lib/arenas-publicas.ts`):
  - `listarArenasPublicas(db, busca?)` passa a casar nome, rua, bairro, cidade e UF, sem acento e sem maiúscula (normalizar os dois lados com `translate`/`lower` no SQL e o termo em JS com `normalize("NFD")` sem marcas), mantendo `LIMITE_PUBLICO = 50` e o retorno `{ nome, slug }[]` + `cidade: string | null`.
  - `sugestoesArenas(db, termo): Promise<{ nome: string; slug: string; cidade: string | null }[]>` — termo de 2 a 80 caracteres (menos → `[]` sem consultar), até 8.
  - `arenasNoMapa(db): Promise<{ nome: string; slug: string; latitude: number; longitude: number }[]>` — ativas com coordenadas.
  - `arenaPublica(db, slug): Promise<{ nome: string; slug: string; ativa: boolean; endereco: { rua; numero; bairro; cidade; uf; cep } | null; latitude: number | null; longitude: number | null; quadras: { id: string; nome: string; esporte: string; faixas: Faixa[] }[] } | null>` — slug malformado → `null` sem consultar; suspensa → `ativa: false` e `quadras: []`.
- `GET /api/arenas/sugestoes?q=` → `200` JSON `{ arenas: [...] }` de `sugestoesArenas`, cabeçalho `Cache-Control: public, max-age=60`; sem `q` válido → `{ arenas: [] }`.

- [ ] **Step 1: testes que falham:** `"busca sem acento e sem maiúscula por nome e endereço"` (`"sao paulo"` acha cidade `"São Paulo"`, `"BEIRA"` acha `"Arena Beira-Mar"`, `"meireles"` acha o bairro); `"curinga é literal"` (`"50%"` não acha tudo); `"suspensa fora da busca, das sugestões e do mapa"`; `"mapa só com coordenadas"`; `"sugestões: termo curto não consulta, no máximo 8"`; `"arenaPublica devolve quadras com faixas ordenadas e nada privado"` (as chaves do objeto são só as do contrato; nenhuma string com `@`, taxa ou SN); `"arenaPublica: suspensa sem quadras; slug malformado sem consulta"`.
- [ ] **Step 2:** FAIL.
- [ ] **Step 3:** implementar.
- [ ] **Step 4:** PASS, typecheck.
- [ ] **Step 5:** commit `feat(publico): busca por nome e endereço, sugestões e pontos do mapa`.

### Task 4: Página pública da arena

**Files:**
- Modify: `app/a/[slug]/page.tsx`, `app/a/[slug]/apresentacao.ts`, `app/globals.css`, `tests/a-apresentacao.test.ts`
- Create: `app/a/[slug]/escolha.tsx` (formulário GET por quadra)

**Interfaces:**
- Consumes: `arenaPublica` (Task 3); `diaValido`, `diasDisponiveis`, `iniciosLivres`, `precoEscolha`, `hojeLocal` (Task 2); `textoDeCentavos`, `textoHora` (`precos.ts`); `CabecalhoPublico`, `sessaoJogadorAtual`.
- Produces (`app/a/[slug]/apresentacao.ts`):
  - `lerEscolha(params: Record<string, string | string[] | undefined>, quadraIds: string[], agora: Date): { quadra: string | null; dia: string; inicio: number | null; horas: number }` — `quadra` só se estiver em `quadraIds`; `dia` via `diaValido` (senão hoje); `inicio` inteiro 0–23 (senão `null`); `horas` inteiro 1–4 (senão 1); arrays → primeiro valor.
  - `linkComoChegar(a: { latitude: number | null; longitude: number | null; endereco: ... | null }): string | null`.
- Página: cabeçalho público; nome; endereço em uma linha + "Como chegar"; para cada quadra um cartão com nome, esporte e:
  - sem faixas: "Reservas indisponíveis";
  - com faixas: formulário GET (`quadra` escondido, `dia` select de `diasDisponiveis`, `inicio` select dos `iniciosLivres` com o preço da hora, `horas` select de 1 até o `horasMax` do início escolhido, botão "Ver preço"); com escolha válida, o total (`textoDeCentavos`) e o detalhe por hora quando há mais de um preço; botão "Reservar" desabilitado + "Reservas pelo site em breve"; sem início livre no dia: "Sem horários livres neste dia.".
  - Suspensa: só nome e `MENSAGEM_ARENA_SUSPENSA`.
  - `metadata.robots` passa a permitir indexação só para arena ativa (`index: true`), mantendo `noindex` para suspensa.

- [ ] **Step 1: testes que falham** em `tests/a-apresentacao.test.ts`: `"lerEscolha ignora o que não presta"` (`horas=10` → 1; `inicio=abc` → `null`; `quadra` fora da lista → `null`; `dia=<script>` → hoje; `dia` válido mantido; arrays → primeiro); `"linkComoChegar"` (coordenadas → URL com `query=-3.72,-38.48`; sem coordenadas → endereço codificado; nada → `null`).
- [ ] **Step 2:** FAIL.
- [ ] **Step 3:** implementar a página.
- [ ] **Step 4:** PASS, typecheck; na prévia (390 px), com a quadra de teste seg–sex 7–17 R$ 80 e 17–23 R$ 120: escolher um dia útil, início 16h, 2 horas → "R$ 200,00" com o detalhe; sem JavaScript o fluxo funciona.
- [ ] **Step 5:** commit `feat(publico): página da arena com horários e preço`.

### Task 5: Home com busca, sugestões e mapa

**Files:**
- Modify: `package.json` / `package-lock.json` (`leaflet@1.9.4`, `@types/leaflet` em dev), `app/page.tsx`, `app/globals.css`
- Create: `app/componentes/mapa-arenas.tsx` (client, Leaflet via `import()` dinâmico dentro de `useEffect`), `app/componentes/busca-arenas.tsx` (client, sugestões)

**Interfaces:**
- Consumes: `listarArenasPublicas`, `arenasNoMapa` (Task 3); `GET /api/arenas/sugestoes`.
- Home: título "Encontre uma quadra"; formulário GET `?busca=` com campo "Nome da arena ou endereço" (como hoje, funciona sem JS) e, com JS, lista de até 8 sugestões abaixo do campo depois de 2 caracteres (espera de 250 ms entre teclas; setas e Enter escolhem; `role="combobox"`/`listbox` com `aria-expanded` e `aria-activedescendant`); lista de resultados (nome + cidade) como hoje; mapa de 240 px com todos os pontos de `arenasNoMapa`, centralizado para caber todos (um ponto só → zoom 14; nenhum → mapa não aparece); botão "Ver no mapa" expande para a tela inteira (classe CSS, `Esc` e "Fechar mapa" voltam); CSS do Leaflet importado só no componente.

- [ ] **Step 1:** instalar `leaflet@1.9.4` e `@types/leaflet`; teste que falha só se houver lógica pura nova (ex.: `limitesDoMapa(pontos)` em `app/componentes/mapa-arenas-calculo.ts`: vazio → `null`, um ponto → centro com zoom 14, vários → bounds) em `tests/mapa.test.ts`.
- [ ] **Step 2:** FAIL.
- [ ] **Step 3:** implementar.
- [ ] **Step 4:** PASS, typecheck; na prévia (390 px e desktop): digitar "beira" mostra a sugestão; o ponto da arena de teste aparece no mapa; "Ver no mapa" expande e "Fechar mapa" volta; sem JS a busca funciona.
- [ ] **Step 5:** commit `feat(publico): home com busca, sugestões e mapa`.

### Task 6: Documentação e produção

**Files:**
- Modify: `docs/ESTADO.md` (fase 3 no ar ou pronta; migração 0015; dependência `leaflet`; contrato da URL da escolha para a fase 4).

- [ ] **Step 1:** atualizar o documento.
- [ ] **Step 2:** testes, typecheck e build (com o `next dev` parado).
- [ ] **Step 3:** commit `docs: estado depois da fase 3`.
- [ ] **Step 4 (com o ok do dono):** migrar produção (0015), merge + push, conferir no ar a home, a busca, o mapa e a página da arena.
