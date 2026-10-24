# Visual novo — Fase 2: horários criados pelo dono

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Trocar as faixas de hora cheia por horários livres criados pelo dono (início, fim e preço por horário, sem choque), e fazer o jogador reservar um ou mais horários seguidos.

**Architecture:** Nova tabela `horarios_quadra` (minutos do dia, exclusão GiST contra sobreposição), regras puras em `app/lib/horarios.ts`, acesso ao banco em `app/lib/horarios-quadra.ts`. A disponibilidade passa a trabalhar com horários e períodos ocupados (instantes), não com horas cheias. A tela do dono vira um componente cliente com dias da semana, caixinhas e painel lateral; o passo 3 do jogador vira caixinhas clicáveis que funcionam sem JavaScript (links). `precos_quadra` só sai na última tarefa, depois que ninguém mais lê dela.

**Tech Stack:** Next.js 15 App Router, React 19, Postgres (PGlite nos testes, com btree_gist), Vitest.

**Spec:** `docs/superpowers/specs/2026-10-24-visual-novo-design.md` (seções "Horários e preços (dono, dentro da quadra)", "Página da arena" passo 3, "Mudança de contrato: horários do dono").

## Global Constraints

- Todo texto em português. Dinheiro em centavos inteiros. Fuso America/Sao_Paulo (`FUSO` de `app/lib/disponibilidade.ts`).
- Horário: `inicio` e `fim` em minutos do dia, `0 ≤ inicio ≤ 1439`, `1 ≤ fim ≤ 1440`, `fim > inicio`; preço de 1 a 1.000.000 centavos pelo horário inteiro.
- Horários da mesma quadra e do mesmo dia da semana não se sobrepõem. Checado na tela e no servidor (dentro de transação) e garantido pelo banco.
- Mensagem de choque exata: `Esse horário choca com 15h30 – 17h15.` (intervalo do horário existente, formato de `textoIntervalo`).
- Reserva: até **4 horários seguidos** (fim de um = início do próximo), do mesmo dia. Regras que não mudam: janela hoje até +30 dias, só horários que começam depois de agora, limite 2/5, cancelamento 24 h, "pagar na arena", taxa 0. `reservas.periodo` continua sendo o intervalo total e a exclusão da 0016 continua sendo a garantia contra reserva dupla.
- Editar ou apagar horário não muda reserva já feita: `reservas.detalhe` é cópia (`[{inicio, fim, precoCentavos}]`, minutos), sem chave para o horário.
- Copiar dia **soma**: pula os que chocam, avisa quantos pulou, nunca apaga.
- O bloqueio do dono em `/painel/reservas` continua como está (horas cheias) até a fase 6.
- Funções de banco recebem o `arena_id` da sessão; id de outra arena ou que não é uuid se comporta como inexistente (padrão de `app/lib/precos-quadra.ts`).
- Arquivos `"use server"` só exportam funções assíncronas (`tests/use-server.test.ts`).
- Testes com `node node_modules/vitest/vitest.mjs run --no-file-parallelism`; typecheck com `node node_modules/typescript/bin/tsc --noEmit`. Não rodar `npm run build` com o `next dev` aberto.
- Commits em Conventional Commits, `git add` explícito (nunca `.claude/settings.json`), terminando com `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`. Branch `feat/visual-novo`.

## Review Focus

- **Meia-noite:** dono digita fim `00:00` → é 24h (1440), não erro; horário 23h–24h aparece, reserva e mostra "23h às 24h". Teste na Task 1 (`minutosDeTexto`) e na Task 4 (`escolhaDeHorarios` com fim 1440).
- **Horário editado por cima de reserva existente:** aparece ocupado naquele dia mesmo se só uma parte encosta na reserva. Teste na Task 4 (`horariosDoDia` com período parcial).
- **Dois pedidos simultâneos criando horários sobrepostos:** só um grava. Teste na Task 2 (`Promise.all`).
- **Link velho ou manipulado:** `inicio` que não é início de horário, `qtd` 5, 0 ou não inteiro, horário já começado, sequência com buraco → recusa sem cortar nem "ajustar". Testes na Task 4.
- **Seguido com buraco:** 15h30–17h15 seguido de 18h–19h não conta como seguido. Teste na Task 4.

---

### Task 1: Regras puras dos horários

**Files:**
- Create: `app/lib/horarios.ts`
- Test: `tests/horarios.test.ts`

**Interfaces:**
- Produces:
  - `type Horario = { diaSemana: number; inicio: number; fim: number; precoCentavos: number }` e `type HorarioComId = Horario & { id: string }`.
  - Constantes: `DURACAO_MIN = 15`, `DURACAO_MAX = 720`, `HORARIOS_SEGUIDOS_MAX = 4`, `DURACOES_FIXOS = [30, 45, 60, 90, 120]`.
  - `minutosDeTexto(texto: string, ehFim = false): number | null` — só `"HH:MM"` (00–23, 00–59); com `ehFim`, `"00:00"` vira 1440.
  - `textoMinutos(m: number): string` — 420 → `"7h"`, 930 → `"15h30"`, 1440 → `"24h"`, 5 → `"0h05"`.
  - `textoIntervalo(h: { inicio: number; fim: number }): string` — `"15h30 – 17h15"` (espaços e travessão "–").
  - `validarHorario(h: Horario): string | null` — mensagens: `"Dia da semana inválido."`, `"Início inválido."`, `"Fim inválido."`, `"O fim deve ser depois do início."`, `"Cada horário dura de 15 minutos a 12 horas."`, `"Preço fora do limite permitido."` (usa `PRECO_MAX_CENTAVOS` de `app/lib/precos.ts`).
  - `chocam(a: Horario, b: Horario): boolean` — mesmo dia e `a.inicio < b.fim && b.inicio < a.fim` (encostar não choca).
  - `primeiroChoque<T extends Horario & { id?: string }>(novo: Horario, existentes: T[], ignorarId?: string): T | null`.
  - `gerarFixos(p: { diaSemana: number; das: number; ate: number; duracao: number; precoCentavos: number }): Horario[]` — de `das` em passos de `duracao` enquanto `inicio + duracao ≤ ate`.
  - `separarChoques(novos: Horario[], existentes: Horario[]): { criar: Horario[]; pulados: Horario[] }`.
  - `grupoDoDia(inicio: number): "madrugada e manhã" | "tarde" | "noite"` — `< 720`, `< 1080`, resto.

- [ ] **Step 1: Testes que falham** em `tests/horarios.test.ts`:
  - `minutosDeTexto("15:30") === 930`, `("07:00") === 420`, `("00:00") === 0`, `("00:00", true) === 1440`, `("24:00") === null`, `("7:00") === null`, `("15:60") === null`, `("") === null`.
  - `textoMinutos` nos 4 exemplos acima; `textoIntervalo({ inicio: 930, fim: 1035 }) === "15h30 – 17h15"`.
  - `validarHorario`: válido `{1, 930, 1035, 11000}` → null; 23h–24h (1380–1440) → null; fim 1440 + 1 → "Fim inválido."; 600–600 → "O fim deve ser depois do início."; 600–610 → "Cada horário dura de 15 minutos a 12 horas."; 0–721 → mesma; dia 7 → "Dia da semana inválido."; preço 0 → "Preço fora do limite permitido.".
  - `chocam`: 930–1035 × 960–1050 → true; 420–480 × 480–540 → false; dias diferentes → false.
  - `primeiroChoque` acha o conflitante e ignora o próprio id na edição.
  - `gerarFixos({ diaSemana: 1, das: 420, ate: 1320, duracao: 60, precoCentavos: 8000 })` → 15 horários, primeiro 420–480, último 1260–1320; `ate` que não fecha um horário inteiro (420–500, 60) → só 420–480; `das ≥ ate` → `[]`.
  - `separarChoques`: gerar 7h–22h contra existente 15h30–17h15 → `pulados` são 15h–16h, 16h–17h, 17h–18h; `criar` tem 12.
  - `grupoDoDia(719) === "madrugada e manhã"`, `(720) === "tarde"`, `(1080) === "noite"`.
- [ ] **Step 2:** rodar o arquivo → FALHA (módulo não existe).
- [ ] **Step 3:** implementar `app/lib/horarios.ts`.
- [ ] **Step 4:** arquivo e `tsc` passam.
- [ ] **Step 5:** commit `feat(horarios): regras puras de horário, choque e criação em lote`.

### Task 2: Tabela de horários e acesso ao banco

**Files:**
- Create: `db/migrations/0017_horarios.sql`
- Create: `app/lib/horarios-quadra.ts`
- Modify: `app/lib/disponibilidade.ts` (só acrescenta `partesDoInstante` e `instanteDoMinuto`)
- Modify: `tests/schema.test.ts` (listas esperadas de `migrar` ganham `"0017_horarios.sql"`; testes novos da 0017)
- Test: `tests/horarios-quadra.test.ts`

**Interfaces:**
- Consumes: Task 1 (`Horario`, `HorarioComId`, `validarHorario`, `primeiroChoque`, `separarChoques`, `textoIntervalo`).
- Produces:
  - Tabela `horarios_quadra (id uuid, arena_id, quadra_id, dia_semana smallint 0–6, inicio smallint 0–1439, fim smallint 1–1440, preco_centavos int 1–1000000, criado_em)`, `check (fim - inicio between 15 and 720)`, FK `(quadra_id, arena_id) → quadras (id, arena_id) on delete cascade`, `exclude using gist (quadra_id with =, dia_semana with =, int4range(inicio, fim) with &&)`, índice `(quadra_id, dia_semana)`. A migração copia cada faixa de `precos_quadra` em horários de 1 hora com o mesmo preço (`generate_series(inicio, fim - 1)`). `precos_quadra` fica (sai na Task 5).
  - Em `disponibilidade.ts`: `instanteDoMinuto(dia: string, minuto: number): number` (UTC ms do minuto local; 1440 = meia-noite seguinte; `instanteLocal(dia, hora)` passa a chamar `instanteDoMinuto(dia, hora * 60)`) e `partesDoInstante(d: Date): { dia: string; minuto: number }` (dia e minuto locais).
  - Em `horarios-quadra.ts` (todas recebem `arenaId` da sessão):
    - `listarHorarios(db, arenaId, quadraId): Promise<HorarioComId[]>` — por dia, início.
    - `criarHorario(db, arenaId, quadraId, h: Horario): Promise<{ ok: true; id: string } | { ok: false; erro: string }>` — choque → `Esse horário choca com <textoIntervalo>.`; quadra alheia → `"Quadra não encontrada."`.
    - `criarHorarios(db, arenaId, quadraId, novos: Horario[]): Promise<{ ok: true; criados: number; pulados: number } | { ok: false; erro: string }>` — valida todos (um inválido recusa a leva), pula os que chocam com existentes, grava o resto num comando; leva vazia → `"Nenhum horário para criar."`; mais de 672 → `"Horários demais de uma vez."`.
    - `editarHorario(db, arenaId, horarioId, h: { inicio: number; fim: number; precoCentavos: number }): Promise<{ ok: true } | { ok: false; erro: string }>` — mantém o dia; choque ignorando o próprio; inexistente → `"Horário não encontrado."`.
    - `apagarHorario(db, arenaId, horarioId): Promise<boolean>`.
    - `copiarDia(db, arenaId, quadraId, origem: number, destinos: number[]): Promise<{ ok: true; criados: number; pulados: number } | { ok: false; erro: string }>` — ignora `origem` entre os destinos; sem destino → `"Marque pelo menos um dia."`; origem sem horários → `"Esse dia não tem horários para copiar."`.
    - `reservasFuturasPorHorario(db, arenaId, quadraId, agora: Date): Promise<Record<string, number>>` — reservas de jogador confirmadas com `inicio > agora` cujo dia da semana local e minutos tocam o horário (usa `partesDoInstante`). Horário sem reserva fica fora do objeto.
  - Concorrência: igual a `adicionarFaixas` — trava a quadra (`for no key update`) e lê os existentes em comando seguinte; `23P01` vira a mensagem de choque genérica `"Esse horário choca com outro horário."`.

- [ ] **Step 1: Testes que falham:**
  - `tests/schema.test.ts`: (a) 0017 recusa horário sobreposto no mesmo dia e quadra (`exclusion`), aceita encostado (420–480 e 480–540) e em outro dia; recusa quadra de outra arena (`foreign key`) e duração 10 min (`check`); apagar a quadra apaga os horários. (b) migração com dados: banco parado na 0016 com faixa segunda 7–9 R$ 80 → depois de `migrar`, dois horários 420–480 e 480–540 de 8000. (c) as listas esperadas de `migrar` nos testes de 0007–0010 terminam em `"0017_horarios.sql"`.
  - `tests/horarios-quadra.test.ts`: criar e listar (ordem dia/início); choque devolve a mensagem com o intervalo existente; quadra de outra arena e id não uuid → "Quadra não encontrada."; lote 7h–22h com 15h30–17h15 existente → `{ ok: true, criados: 12, pulados: 3 }`; lote com um inválido grava nada; editar muda hora e preço, recusa choque com outro e aceita encostar no próprio intervalo antigo; editar/apagar de outra arena → falha; copiar segunda (2 horários) para terça vazia e quarta com um que choca → `criados: 3, pulados: 1`; copiar para a própria origem não duplica; duas criações sobrepostas com `Promise.all` → só uma `ok`; `reservasFuturasPorHorario` conta uma reserva futura de segunda 18h–19h no horário 18h–19h de segunda, não conta cancelada nem passada.
  - `instanteDoMinuto("2026-10-26", 930)` = `Date.parse("2026-10-26T15:30:00-03:00")`; `(…, 1440)` = meia-noite do dia 27; `partesDoInstante(new Date("2026-10-26T15:30:00-03:00"))` = `{ dia: "2026-10-26", minuto: 930 }` (em `tests/disponibilidade.test.ts`).
- [ ] **Step 2:** rodar os arquivos → FALHA.
- [ ] **Step 3:** escrever a 0017, as duas funções de `disponibilidade.ts` e `horarios-quadra.ts`.
- [ ] **Step 4:** arquivos, a suíte toda e `tsc` passam.
- [ ] **Step 5:** commit `feat(horarios): tabela horarios_quadra, migração das faixas e funções do dono`.

### Task 3: Tela de horários do dono

**Files:**
- Create: `app/painel/quadras/[id]/horarios.tsx` (`"use client"`)
- Create: `app/painel/quadras/[id]/horarios-apresentacao.ts`
- Modify: `app/painel/quadras/[id]/actions.ts` (troca `adicionarFaixaAction`/`removerFaixaAction` pelas ações abaixo)
- Modify: `app/painel/quadras/[id]/precos.tsx` (fica só `FormularioQuadra`)
- Modify: `app/painel/quadras/[id]/page.tsx` (seção "Horários e preços" usa `HorariosDaQuadra`)
- Modify: `app/globals.css`
- Test: `tests/horarios-apresentacao.test.ts`

**Interfaces:**
- Consumes: Task 1 (regras, `DURACOES_FIXOS`), Task 2 (funções do banco).
- Produces:
  - Ações (`"use server"`, conferem `exigirSessao()` e recarregam `/painel/quadras/[id]`): `criarHorarioAction`, `criarFixosAction`, `editarHorarioAction`, `apagarHorarioAction`, `copiarDiaAction`, todas `(estado: EstadoHorario, form: FormData) => Promise<EstadoHorario>` com `type EstadoHorario = { erro: string | null; mensagem: string | null; versao: number }`. Campos: `quadraId`, `horarioId`, `dia`, `inicio`/`fim` (`HH:MM`), `das`/`ate`, `duracao` (minutos), `preco` (texto, `centavosDeTexto`), `destino` (vários).
  - `horarios-apresentacao.ts`: `contagemPorDia(h: Horario[]): number[]` (índice = dia da semana), `avisoReservas(n: number): string | null` (0 → null; 1 → `"Esse horário tem 1 reserva futura; ela continua valendo como foi feita."`; n → `"Esse horário tem N reservas futuras; elas continuam valendo como foram feitas."`), `resumoLote(criados: number, pulados: number): string` (`"12 horários criados."`, `"1 horário criado."`, com pulados: `"12 horários criados; 3 chocavam com os existentes e foram pulados."`, `criados: 0` → `"Nenhum horário criado: todos chocavam com os existentes."`).
  - `HorariosDaQuadra({ quadraId, horarios, reservasFuturas, diaInicial })` — `horarios: HorarioComId[]`, `reservasFuturas: Record<string, number>`, `diaInicial` = dia da semana de hoje (local).

Comportamento (esboço aprovado `dono-horarios-v2.html`):
- Botões dos dias, segunda primeiro e domingo por último, cada um com a contagem (`—` sem horários). O dia escolhido mostra os horários em caixinhas `7h – 8h` / `R$ 80,00`, em grade; a última caixinha é **"+ Novo horário"** (tracejada).
- Clicar numa caixinha abre o painel lateral em modo **edição** (início, fim, preço, aviso de `avisoReservas` quando houver, "Salvar" e "Apagar"). "✕" na caixinha apaga com confirmação que mostra o mesmo aviso.
- "+ Novo horário" abre o painel com as abas **"Um horário"** (início, fim, preço → "Adicionar") e **"Vários fixos"** (das, até, "Cada um dura" com `DURACOES_FIXOS` em "30 min", "45 min", "1 hora", "1h30", "2 horas", preço → prévia em chips e botão "Criar N horários"). Título do painel: `Novo horário · segunda`.
- Choque na tela: em "Um horário", quando início/fim chocam, mostra `Esse horário choca com …`, destaca a caixinha conflitante e desabilita "Adicionar"; em "Vários fixos", os chips que chocam ficam marcados e aparece `N horários chocam com os que já existem e serão pulados.` O servidor revalida (Task 2).
- "Copiar segunda para outros dias…" abre o painel com os outros 6 dias em caixas de marcar e "Copiar"; o resultado aparece com `resumoLote`.
- Painel: lateral à direita no computador (sobre a grade, com fundo escurecido), tela cheia de baixo para cima no celular; fecha com "✕", Esc e depois de salvar com sucesso. Campos `type="time"`.
- Sem horários na quadra: a grade mostra só "+ Novo horário" e o texto "Sem horários: esta quadra ainda não aceita reservas.".

- [ ] **Step 1: Testes que falham** em `tests/horarios-apresentacao.test.ts` para `contagemPorDia`, `avisoReservas` (0, 1, 3) e `resumoLote` (os quatro textos acima).
- [ ] **Step 2:** rodar → FALHA.
- [ ] **Step 3:** implementar `horarios-apresentacao.ts`, as ações, `HorariosDaQuadra`, a página e o CSS (tokens existentes; claro e escuro).
- [ ] **Step 4:** testes do arquivo, `tests/use-server.test.ts`, a suíte toda e `tsc` passam.
- [ ] **Step 5: Prévia** (dev em `http://localhost:3000`, portais "Site (computador)" e "Jogador (celular)", dono@teste.local / senha-de-teste-123): abrir uma quadra; criar 15h30–17h15; tentar 16h–17h30 e ver o aviso de choque; criar vários fixos 7h–22h de 1 hora e ver "pulados"; editar o preço de um; apagar um; copiar segunda para terça; nos dois temas.
- [ ] **Step 6:** commit `feat(painel): horários da quadra com dias, caixinhas e painel lateral`.

### Task 4: Jogador escolhe horários seguidos e reserva

**Files:**
- Modify: `app/lib/disponibilidade.ts` (sai `iniciosLivres`, `precoEscolha`, `precosDoDia`, `horasOcupadas`, `HORAS_MAX`; entram as funções abaixo)
- Modify: `app/lib/arenas-publicas.ts` (quadras com `horarios`; `ocupadasPublicas` vira `periodosPublicos`)
- Modify: `app/lib/reservas.ts` (`criarReserva` por horários; `periodosOcupados` usa `instanteDoMinuto`)
- Modify: `app/a/[slug]/apresentacao.ts`, `app/a/[slug]/escolha.tsx`, `app/a/[slug]/page.tsx`
- Modify: `app/reservar/page.tsx`, `app/reservar/actions.ts`, `app/reservar/formulario.tsx`
- Modify: `app/globals.css`
- Modify: `tests/fixtures.ts` (helper `criarHorariosDeHora`)
- Test: `tests/disponibilidade.test.ts`, `tests/a-apresentacao.test.ts`, `tests/reservas.test.ts`, `tests/arenas-publicas.test.ts`

**Interfaces:**
- Consumes: Task 1 (`HorarioComId`, `HORARIOS_SEGUIDOS_MAX`, `textoMinutos`, `textoIntervalo`, `grupoDoDia`), Task 2 (`listarHorarios`, `instanteDoMinuto`).
- Produces:
  - `type Periodo = { inicio: Date; fim: Date }`; `type HorarioDoDia = { horario: HorarioComId; livre: boolean }`.
  - `horariosDoDia(horarios: HorarioComId[], dia: string, agora: Date, ocupados: Periodo[]): HorarioDoDia[]` — horários do dia da semana de `dia`, por início, sem os que começam em ou antes de `agora`; `livre = false` se algum período toca o intervalo do horário.
  - `type Escolha = { inicio: number; fim: number; itens: { inicio: number; fim: number; precoCentavos: number }[]; totalCentavos: number }`.
  - `escolhaDeHorarios(horarios: HorarioComId[], dia: string, inicio: number, qtd: number, agora: Date, ocupados: Periodo[]): Escolha | null` — `qtd` inteiro de 1 a `HORARIOS_SEGUIDOS_MAX`; o primeiro é o horário livre que começa em `inicio`; cada próximo é o horário livre cujo início = fim do anterior; sequência quebrada → null.
  - `criarReserva(db, jogadorId, e: { quadraId: string; dia: string; inicio: number; qtd: number }, agora)` — mesma assinatura de retorno; grava `inicio`/`fim` com `instanteDoMinuto` e `detalhe` = `escolha.itens`.
  - `ArenaPublica.quadras[]` = `{ id, nome, esporte, horarios: HorarioComId[] }`; `periodosPublicos(db, quadraId, dia): Promise<Periodo[]>` (só início e fim, nada de quem reservou).
  - Contrato de URL novo: `/a/<slug>?quadra=&dia=&inicio=&qtd=` e `/reservar?quadra=&dia=&inicio=&qtd=` (`inicio` em minutos, até 4 dígitos; `qtd` 1–4). `lerEscolha(params, quadraIds, agora): { quadra: string | null; dia: string; inicio: number | null; qtd: number }` (o que não presta volta ao padrão: sem quadra, hoje, sem início, 1); `lerReserva(...) : { quadra; dia; inicio; qtd } | null` (nada volta ao padrão); `hrefReservar({ quadra, dia, inicio, qtd })`.
  - `hrefDoHorario(base: { slug: string; quadra: string; dia: string }, dia: HorarioDoDia[], selecao: { inicio: number; qtd: number } | null, alvo: number): string` — `alvo` = índice em `dia`. Regras: sem seleção ou alvo fora dela e não colado → seleciona só o alvo (`qtd=1`); alvo livre colado ao fim da seleção e `qtd < 4` → `qtd + 1`; alvo = último da seleção com `qtd > 1` → `qtd - 1`; alvo = único selecionado → tira a seleção (URL sem `inicio`/`qtd`); alvo no meio ou no começo de uma seleção maior → recomeça nele (`qtd=1`). Sempre termina em `#quadra-<id>`.

Comportamento do passo 3 (esboço `dono-horarios.html`, parte do jogador): o seletor de dia e o botão "Ver horários" (GET) ficam; abaixo, os horários do dia agrupados por `grupoDoDia` (só grupos com horário), em caixinhas `15h30–17h15` / `R$ 110,00`; livre é link (`hrefDoHorario`), selecionado fica em destaque com `aria-current="true"`, ocupado é caixinha tracejada "Ocupado" sem link. Dica: `Quer mais tempo? Escolha horários seguidos.` Resumo com a seleção: `18h às 20h · R$ 240,00` e botão "Reservar" (`hrefReservar`). Dia sem horários: `Sem horários livres neste dia.`; quadra sem nenhum horário: `Reservas indisponíveis`. Em `/reservar`, a linha Horário mostra `18h às 20h (2 horários)` e, com mais de um item, o detalhe `18h–19h R$ 120,00 · 19h–20h R$ 120,00`.

- [ ] **Step 1: Testes que falham:**
  - `tests/disponibilidade.test.ts` (troca os testes de `iniciosLivres`/`precoEscolha`/`horasOcupadas`): `horariosDoDia` respeita agora (horário que começa exatamente agora sai), marca ocupado um horário 15h30–17h15 tocado por reserva 17h–18h, e não mistura dia da semana; `escolhaDeHorarios` soma 18h–19h + 19h–20h = 24000, recusa `qtd` 5, 0 e 1.5, recusa quando o segundo está ocupado, recusa 17h15→18h (buraco), recusa `inicio` que não é início de horário, aceita 23h–24h (fim 1440).
  - `tests/a-apresentacao.test.ts`: `lerEscolha` com `inicio=930&qtd=2` e com lixo (`qtd=9`, `inicio=abc`) → padrão; `lerReserva` recusa sem `qtd`; `hrefReservar` monta `/reservar?quadra=…&dia=…&inicio=930&qtd=2`; `hrefDoHorario` nos cinco casos das regras acima.
  - `tests/reservas.test.ts`: os testes passam a semear com `criarHorariosDeHora(db, arenaId, quadraId, dias, deHora, ateHora, precoCentavos)` e a chamar `criarReserva` com `{ inicio: minutos, qtd }`; novo: reserva de 2 horários 15h30–17h15 + 17h15–18h grava período 15h30–18h e `detalhe` com os dois itens; `qtd` 5 recusa com `MSG_INDISPONIVEL`.
  - `tests/arenas-publicas.test.ts`: `arenaPublica` devolve `horarios` (troca a semeadura de `precos_quadra`/`adicionarFaixas` por horários).
- [ ] **Step 2:** rodar → FALHA.
- [ ] **Step 3:** implementar na ordem: `disponibilidade.ts`, `arenas-publicas.ts`, `reservas.ts`, `apresentacao.ts`, `escolha.tsx`/`page.tsx`, `/reservar`, CSS.
- [ ] **Step 4:** a suíte toda e `tsc` passam (`grep -rn "iniciosLivres\|precoEscolha\|horasOcupadas\|HORAS_MAX" app tests` vazio).
- [ ] **Step 5: Prévia:** na Arena Beira-Mar (slug local `b1723aeb773b4105afb403be317cab5d`), escolher quadra e dia, marcar 2 horários seguidos, ver o total, reservar como jogador (reserva1@teste.local / senha-reserva-1) e ver em "Minhas reservas"; tentar marcar um 5º seguido (não deve deixar); celular e computador.
- [ ] **Step 6:** commit `feat(reservas): jogador escolhe horários seguidos criados pelo dono`.

### Task 5: Horários quebrados nas listas e saída das faixas

**Files:**
- Modify: `app/minhas-reservas/apresentacao.ts`, `app/painel/reservas/apresentacao.ts` (minutos)
- Create: `db/migrations/0018_sem_precos_quadra.sql` (`drop table precos_quadra;`)
- Delete: `app/lib/precos-quadra.ts`, `tests/precos-quadra.test.ts`
- Modify: `app/lib/precos.ts` (sai `Faixa`, `validarFaixa`, `sobrepoe`; ficam dinheiro, `NOMES_DIAS` e `textoHora`), `tests/precos.test.ts`
- Modify: `tests/schema.test.ts` (o teste da 0014 deixa de usar `precos_quadra`, fica só a taxa; listas de `migrar` ganham `"0018_sem_precos_quadra.sql"`)
- Test: `tests/minhas-reservas-apresentacao.test.ts`, `tests/painel-reservas-apresentacao.test.ts`

**Interfaces:**
- Consumes: Task 1 (`textoMinutos`), Task 2 (`partesDoInstante`).

- [ ] **Step 1: Testes que falham:** reserva de 15h30 às 17h15 aparece como `… · 15h30 às 17h15` em Minhas reservas e `15h30–17h15 · …` na agenda do dono; fim à meia-noite continua `24h`; os testes de hora cheia continuam iguais.
- [ ] **Step 2:** rodar → FALHA.
- [ ] **Step 3:** trocar `horaLocal` + `textoHora` por `partesDoInstante` + `textoMinutos` (fim com minuto 0 no dia seguinte = 1440); escrever a 0018; apagar o que sobrou das faixas.
- [ ] **Step 4:** a suíte toda e `tsc` passam; `grep -rn "precos_quadra\|listarFaixas\|validarFaixa\|type Faixa" app tests` só acha os testes de migração (0014 antiga e a migração com dados da 0017).
- [ ] **Step 5:** commit `refactor(horarios): minutos nas listas e fim da tabela de faixas`.
