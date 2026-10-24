# Fase 2 — Strukti cria, dono ajusta: plano de implementação

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Quadras, câmeras e botões passam a ser criados pela Strukti no admin, junto com a taxa de cada arena; o dono passa a ajustar o nome e o endereço da arena (convertido em coordenadas para o mapa) e, em cada quadra, o nome, o esporte e a tabela de preços por dia e horário.

**Architecture:** Uma migração (`0014`) traz endereço, coordenadas e taxa em `arenas`, esporte em `quadras` e a tabela `precos_quadra` (faixas de uma hora cheia de início e fim por dia da semana). A lógica de preço (ler "R$ 80,50", conferir sobreposição, mostrar) fica num módulo puro testável. O admin ganha uma página por arena (`/admin/arenas/<id>`) que reaproveita as funções de `app/lib/painel.ts` passando o `arenaId` da URL; o painel do dono perde os formulários de quadra, câmera e botão e ganha "Arena" (nome e endereço) e, na quadra, nome, esporte e preços. A geocodificação usa o Nominatim (OpenStreetMap) por um `Geocodificar` injetável.

**Tech Stack:** Next.js 15 (App Router, server actions), Postgres (PGlite nos testes), Vitest, `fetch` do Node para o Nominatim.

**Spec:** `docs/superpowers/specs/2026-10-22-reservas-publicas-design.md` (seção "Fase 2").

## Global Constraints

- Branch `feat/fase2-strukti-cria`, a partir de `main`. `npm test` e `npm run typecheck` verdes ao fim de cada tarefa; build só com o `next dev` parado.
- Toda função do dono recebe o `arenaId` da sessão (`exigirSessao()`), valida uuid e trata id de outra arena como inexistente. Toda página e action de `/admin/**` chama `exigirSuperAdmin()` antes de qualquer consulta. `app/lib/plataforma.ts` continua importável só por `app/admin/**` e `db/`.
- **Dono não cria quadra, câmera nem botão** (decisão do dono). Dono ajusta: nome e endereço da arena; nome, esporte e tabela de preços da quadra.
- **Tabela de preços:** por quadra, faixas de dia da semana + hora de início + hora de fim + preço por hora. Dia da semana `0` = domingo … `6` = sábado. Horas cheias: início de `0` a `23`, fim de `1` a `24` (`24` = meia-noite), fim > início. Preço em centavos inteiros, de `1` a `1_000_000` (R$ 10.000,00). Faixas do mesmo dia e da mesma quadra não se sobrepõem; faixas encostadas (fim = início da outra) são aceitas. Fuso: `America/Sao_Paulo`; a tabela é em hora local.
- **Endereço:** rua (1–120), número (1–20), bairro (0–80), cidade (1–80), UF (2 letras, uma das 27), CEP (8 dígitos; aceita `00000-000`). Ao salvar, vira latitude e longitude uma vez; se a conversão falhar, salva assim mesmo, sem coordenadas, e mostra "Endereço salvo, mas não foi possível localizá-lo no mapa. Confira o endereço." Endereço que muda apaga as coordenadas antigas antes de tentar de novo.
- **Esporte:** texto de 0 a 40 caracteres (vazio = não informado).
- **Taxa da Strukti:** percentual por arena com até 2 casas decimais, de `0` a `30`; padrão para arenas novas `TAXA_PADRAO_PERCENTUAL = 5` (decisão do dono, 23/10).
- Nominatim: `GET https://nominatim.openstreetmap.org/search?format=jsonv2&limit=1&countrycodes=br&q=<endereço>`, cabeçalho `User-Agent: Replay-Strukti/1.0 (struktisolutions@gmail.com)`, tempo máximo 5 s. Nunca chamado em teste (geocodificador injetado).
- pt-BR, WCAG AA, alvos de 48 px, identidade Strukti, sem libs novas; páginas funcionam sem JavaScript.

## Review Focus

1. **Preço digitado de jeitos diferentes** (`"80"`, `"80,5"`, `"R$ 1.234,56"`, `" 80,00 "`, `"0"`, `"-5"`, `"abc"`, `"80.5"`) → os válidos viram centavos certos (`8000`, `8050`, `123456`, `8000`); zero, negativo e lixo são recusados com mensagem. Teste na Task 1.
2. **Faixa nova sobre faixa existente** do mesmo dia (`8–12` com `10–14`), encostada (`8–12` com `12–14`) e em outro dia → sobreposta recusada sem gravar nada; encostada e outro dia aceitas. Teste na Task 1 (pura) e na Task 4 (banco).
3. **Faixa com fim ≤ início, início 24, fim 0 ou 25, preço fora do limite** → recusada com mensagem; `23–24` aceita. Teste na Task 1.
4. **Dono mexendo em quadra ou faixa de outra arena** (id na URL ou no formulário) → nada muda, 404 na página. Teste na Task 4.
5. **Geocodificador fora do ar, lento ou sem resultado** → endereço salvo, coordenadas `null`, aviso mostrado; endereço inválido (UF desconhecida, CEP com 7 dígitos) → nada salvo. Teste na Task 3.

---

### Task 1: Banco e regras de preço

**Files:**
- Create: `db/migrations/0014_fase2.sql`, `app/lib/precos.ts`, `tests/precos.test.ts`
- Modify: `tests/schema.test.ts` (0014 nas listas de migrações esperadas)

**Interfaces:**
- Produces:
  - Banco (`0014_fase2.sql`): `arenas` ganha `endereco_rua`, `endereco_numero`, `endereco_bairro`, `endereco_cidade`, `endereco_uf`, `endereco_cep` (text, nulos), `latitude double precision`, `longitude double precision` (nulos), `taxa_percentual numeric(5,2) not null default 5 check (taxa_percentual between 0 and 30)`; `quadras` ganha `esporte text not null default '' check (length(esporte) <= 40)`; tabela `precos_quadra (id uuid pk, arena_id uuid not null, quadra_id uuid not null, dia_semana smallint check 0..6, inicio smallint check 0..23, fim smallint check 1..24, preco_centavos int check 1..1000000, criado_em, check (fim > inicio), foreign key (quadra_id, arena_id) references quadras (id, arena_id) on delete cascade)`, índice `(quadra_id, dia_semana)`.
  - `app/lib/precos.ts` (puro, sem banco):
    - `type Faixa = { diaSemana: number; inicio: number; fim: number; precoCentavos: number }`
    - `PRECO_MAX_CENTAVOS = 1_000_000`
    - `centavosDeTexto(texto: string): number | null` — aceita dígitos com vírgula decimal (até 2 casas), ponto de milhar opcional e prefixo `R$`; `"80.5"` (ponto como decimal) é `null`.
    - `textoDeCentavos(c: number): string` → `"R$ 80,00"`, `"R$ 1.234,56"`.
    - `validarFaixa(f: Faixa): string | null` — mensagem de erro ou `null`.
    - `sobrepoe(a: Faixa, b: Faixa): boolean` — mesmo dia e `a.inicio < b.fim && b.inicio < a.fim`.
    - `NOMES_DIAS = ["Domingo","Segunda","Terça","Quarta","Quinta","Sexta","Sábado"]`, `textoHora(h: number): string` (`7` → `"7h"`, `24` → `"24h"`).

- [ ] **Step 1: testes que falham** em `tests/precos.test.ts`:
  - `"centavosDeTexto"`: `"80"`→`8000`, `"80,5"`→`8050`, `"80,50"`→`8050`, `"R$ 1.234,56"`→`123456`, `" 80,00 "`→`8000`; `"0"`, `"-5"`, `"abc"`, `"80.5"`, `"80,555"`, `""` → `null`.
  - `"textoDeCentavos"`: `8000`→`"R$ 80,00"`, `123456`→`"R$ 1.234,56"`, `5`→`"R$ 0,05"`.
  - `"validarFaixa"`: `{0,8,12,8000}` → `null`; `{0,23,24,8000}` → `null`; fim ≤ início, início `24`, fim `0`, fim `25`, dia `7`, dia `-1`, preço `0` e `1_000_001` → mensagem (string não vazia).
  - `"sobrepoe"`: `8–12` × `10–14` mesmo dia → `true`; `8–12` × `12–14` → `false`; `8–12` × `8–12` em dias diferentes → `false`.
  - Em `tests/schema.test.ts`: `"0014: preço sem quadra da arena, fim ≤ início e taxa 31 são recusados pelo banco"`.
- [ ] **Step 2:** `npx vitest run tests/precos.test.ts tests/schema.test.ts` → FAIL.
- [ ] **Step 3:** migração e módulo.
- [ ] **Step 4:** testes, `npm run typecheck` → verdes.
- [ ] **Step 5:** commit `feat(precos): tabela de preços, endereço e taxa no banco`.

### Task 2: Admin cria quadras, câmeras, botões e define a taxa

**Files:**
- Create: `app/admin/arenas/[id]/page.tsx`, `app/admin/arenas/[id]/actions.ts`, `app/admin/arenas/[id]/formularios.tsx`
- Modify: `app/lib/plataforma.ts` (`detalheArenaAdmin`, `definirTaxaArena`), `app/lib/painel.ts` (`renomearQuadra`), `app/admin/page.tsx` (link "Configurar" por arena e coluna "Taxa"), `app/painel/page.tsx` (sem "Nova quadra"), `app/painel/quadras/[id]/page.tsx` e `actions.ts` e `formularios.tsx` (sem câmera, credenciais e botões; a câmera aparece só como estado), `tests/plataforma.test.ts`, `tests/painel.test.ts`
- Delete: `app/painel/nova-quadra.tsx`, as actions do painel `criarQuadraAction`, `cadastrarCameraAction`, `atualizarCredenciaisAction`, `criarBotaoAction`, `revogarBotaoAction`

**Interfaces:**
- Consumes: `criarQuadra`, `cadastrarCamera`, `atualizarCredenciais`, `criarBotao`, `revogarBotao`, `listarQuadras`, `detalheQuadra` de `app/lib/painel.ts` (assinaturas de hoje, com o `arenaId` vindo da URL do admin depois de `detalheArenaAdmin` confirmar que a arena existe).
- Produces:
  - `detalheArenaAdmin(db, arenaId): Promise<{ id: string; nome: string; slug: string; status: StatusArena; taxaPercentual: number; donoEmail: string | null } | null>` (uuid malformado → `null` sem consultar).
  - `definirTaxaArena(db, arenaId, percentual: number): Promise<boolean>` — recusa fora de 0–30 ou com mais de 2 casas decimais (`false`, sem gravar).
  - `renomearQuadra(db, arenaId, quadraId, nome): Promise<boolean>` — mesma validação de `criarQuadra` (1–60), só na arena dada.
  - `/admin/arenas/<id>`: nome, status, e-mail do dono, slug; formulário da taxa (texto `"10"` ou `"7,5"`); lista de quadras com renomear, câmera (cadastrar, trocar credenciais, estado online/offline), botões (criar — o token aparece uma vez —, revogar); "Nova quadra". Arena inexistente → 404.
- Os formulários de câmera, credenciais, botão e nova quadra **mudam de lugar** (do painel para o admin) com os mesmos campos e mensagens; as actions do admin chamam `exigirSuperAdmin()` e conferem com `detalheArenaAdmin` que a arena existe antes de usar o `arenaId` da URL.

- [ ] **Step 1: testes que falham:**
  - `tests/plataforma.test.ts`: `"detalheArenaAdmin devolve taxa e e-mail do dono; malformado não consulta"`; `"definirTaxaArena aceita 0, 7,5 e 30 e recusa -1, 30,01 e 7,555"` (com `7.5` e `7.555` como números).
  - `tests/painel.test.ts`: `"renomearQuadra valida 1–60 e não toca quadra de outra arena"`.
  - `tests/isolamento-plataforma.test.ts` continua verde (nenhum import novo de plataforma fora de `app/admin`).
- [ ] **Step 2:** os testes falham.
- [ ] **Step 3:** funções, página do admin e remoção dos formulários do painel.
- [ ] **Step 4:** `npm run typecheck`, `npm test`; na prévia: admin cria quadra, câmera e botão numa arena; o dono vê a quadra e o estado da câmera, sem nenhum formulário de câmera ou botão.
- [ ] **Step 5:** commit `feat(admin): Strukti cria quadras, câmeras e botões e define a taxa`.

### Task 3: Dono ajusta nome e endereço da arena

**Files:**
- Create: `app/lib/geocodificar.ts`, `app/lib/arena-dono.ts`, `app/painel/arena/page.tsx`, `app/painel/arena/formulario.tsx`, `app/painel/arena/actions.ts`, `tests/arena-dono.test.ts`, `tests/geocodificar.test.ts`
- Modify: `app/painel/navegacao.tsx` ("Quadras" e "Arena")

**Interfaces:**
- Produces:
  - `app/lib/geocodificar.ts`: `type Coordenadas = { latitude: number; longitude: number }`; `type Geocodificar = (endereco: string) => Promise<Coordenadas | null>`; `criarGeocodificador(fetcher = fetch): Geocodificar` — Nominatim com os parâmetros e o `User-Agent` das Global Constraints, `AbortSignal.timeout(5000)`; qualquer erro, resposta não-2xx ou lista vazia → `null` (nunca lança).
  - `app/lib/arena-dono.ts`:
    - `type EnderecoArena = { rua: string; numero: string; bairro: string; cidade: string; uf: string; cep: string }`
    - `UFS` (as 27 siglas).
    - `validarEndereco(e: EnderecoArena): { ok: true; endereco: EnderecoArena } | { ok: false; erro: string }` — trim, UF maiúscula, CEP só dígitos.
    - `dadosArenaDono(db, arenaId): Promise<{ nome: string; endereco: EnderecoArena | null; temCoordenadas: boolean } | null>`
    - `atualizarArenaDono(db, arenaId, dados: { nome: string; endereco: EnderecoArena }, geocodificar: Geocodificar): Promise<{ ok: true; localizada: boolean } | { ok: false; erro: string }>` — nome 1–80; grava nome e endereço; se o endereço mudou (ou não há coordenadas), apaga as coordenadas, chama `geocodificar("<rua>, <número>, <bairro>, <cidade> - <UF>, <CEP>, Brasil")` e grava o resultado; endereço igual com coordenadas → não chama o geocodificador.
  - `/painel/arena`: nome e endereço; sucesso → "Arena salva." ou o aviso de "não foi possível localizá-lo no mapa" das Global Constraints.

- [ ] **Step 1: testes que falham:**
  - `tests/geocodificar.test.ts`: com `fetcher` falso — URL com `format=jsonv2`, `limit=1`, `countrycodes=br` e o endereço codificado; cabeçalho `User-Agent`; `[{ lat: "-3.73", lon: "-38.52" }]` → `{ latitude: -3.73, longitude: -38.52 }`; `[]`, status 500, `fetcher` que lança → `null`.
  - `tests/arena-dono.test.ts`:
    - `"validarEndereco"`: CEP `"60000-000"` vira `"60000000"`; UF `"ce"` vira `"CE"`; UF `"XX"`, CEP com 7 dígitos, rua vazia → erro.
    - `"salva endereço e coordenadas"` com geocodificador falso → `localizada: true` e coordenadas no banco.
    - `"geocodificador sem resultado: salva sem coordenadas"` → `localizada: false`, endereço salvo, coordenadas `null`; e coordenadas antigas apagadas quando o endereço muda.
    - `"endereço igual não chama o geocodificador de novo"` (contador no falso).
    - `"arena de outra sessão / uuid malformado não muda nada"`.
- [ ] **Step 2:** os testes falham.
- [ ] **Step 3:** módulos, página e action (a action usa `criarGeocodificador()`).
- [ ] **Step 4:** `npm run typecheck`, `npm test`.
- [ ] **Step 5:** commit `feat(painel): dono ajusta nome e endereço da arena`.

### Task 4: Dono ajusta quadra e tabela de preços

**Files:**
- Create: `app/lib/precos-quadra.ts`, `app/painel/quadras/[id]/precos.tsx` (formulários de faixa), `tests/precos-quadra.test.ts`
- Modify: `app/painel/quadras/[id]/page.tsx` e `actions.ts` (nome, esporte, tabela de preços), `app/lib/painel.ts` (`definirEsporteQuadra`)

**Interfaces:**
- Consumes: `Faixa`, `validarFaixa`, `sobrepoe`, `centavosDeTexto`, `textoDeCentavos`, `NOMES_DIAS`, `textoHora` (Task 1); `renomearQuadra` (Task 2).
- Produces (`app/lib/precos-quadra.ts`):
  - `listarFaixas(db, arenaId, quadraId): Promise<(Faixa & { id: string })[]>` — ordenadas por dia e início.
  - `adicionarFaixas(db, arenaId, quadraId, dias: number[], f: { inicio: number; fim: number; precoCentavos: number }): Promise<{ ok: true } | { ok: false; erro: string }>` — uma faixa por dia marcado; valida cada uma; se qualquer uma sobrepõe uma existente (ou outra da mesma leva), não grava nenhuma e o erro diz o dia (`"Já existe preço para Segunda entre 8h e 12h."`); quadra de outra arena → `{ ok: false, erro: "Quadra não encontrada." }`. Gravação num comando só.
  - `removerFaixa(db, arenaId, faixaId): Promise<boolean>`.
  - `definirEsporteQuadra(db, arenaId, quadraId, esporte): Promise<boolean>` (em `painel.ts`; 0–40 após trim).
- Tela da quadra (dono): bloco "Quadra" (nome e esporte), bloco "Preços e horários" com a tabela atual agrupada por dia (`Segunda · 8h–12h · R$ 80,00 [Remover]`) e o formulário "Adicionar faixa" (caixas dos 7 dias, início, fim, preço por hora). Sem faixas: "Sem preços: esta quadra ainda não aceita reservas.".

- [ ] **Step 1: testes que falham** em `tests/precos-quadra.test.ts`:
  - `"adiciona a mesma faixa em vários dias"`: dias `[1,2,3]`, `8–12`, `8000` → 3 linhas.
  - `"sobreposição em um dos dias não grava nenhum"`: existente segunda `10–14`; nova `[1,2]` `8–12` → erro com "Segunda", 1 linha só no banco.
  - `"encostada é aceita"`: segunda `8–12` e depois `12–14`.
  - `"faixa inválida não grava"`: fim ≤ início → erro, nada gravado.
  - `"quadra ou faixa de outra arena"`: `adicionarFaixas` com quadra da arena B → `"Quadra não encontrada."`; `removerFaixa` com faixa da arena B → `false` e a faixa continua.
  - `"definirEsporteQuadra"`: `" Beach tennis "` → `"Beach tennis"`; 41 caracteres → `false`; outra arena → `false`.
- [ ] **Step 2:** os testes falham.
- [ ] **Step 3:** módulo, ação e tela.
- [ ] **Step 4:** `npm run typecheck`, `npm test`; na prévia, no celular: adicionar "Segunda a sexta, 7h–17h, R$ 80" e "Segunda a sexta, 17h–23h, R$ 120", tentar sobrepor (erro) e remover uma faixa.
- [ ] **Step 5:** commit `feat(painel): dono define esporte e tabela de preços da quadra`.

### Task 5: Documentação e produção

**Files:**
- Modify: `docs/ESTADO.md` (fase 2 feita; migração 0014; taxa padrão de 5%; geocodificação pelo Nominatim; o que o dono e a Strukti fazem agora).

- [ ] **Step 1:** atualizar o documento.
- [ ] **Step 2:** `npm test`, `npm run typecheck` e, com o `next dev` parado, `npm run build` → verdes.
- [ ] **Step 3:** commit `docs: estado depois da fase 2`.
- [ ] **Step 4 (com o ok do dono):** migrar produção (`npx tsx --env-file=C:/Users/anton/replay-producao.env db/migrar-cli.ts`, aplica a 0014), logo em seguida merge na `main` e push; conferir no ar o admin da arena e o painel do dono.
