# Visual novo — Fase 6: reservas do dono em calendário

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** `/painel/reservas` deixa de ser uma lista de 14 dias com formulário de bloqueio solto.

- **Computador:**
  - **Topo:** busca pelo nome do jogador e chips de quadra.
  - **Esquerda:** calendário do mês, com o número de reservas em cada dia e três números embaixo (hoje, esta semana, a receber).
  - **Direita:** os horários do dia escolhido em caixinhas, com ações em cada uma:
    - reserva: Cancelar;
    - bloqueio: Desbloquear;
    - horário livre: Bloquear.
- **Celular:** faixa de dias da semana com contagem, as mesmas caixinhas, e "Ver mês inteiro".

**Architecture:** Tudo pela URL, sem JavaScript: `/painel/reservas?quadra=&dia=&mes=&pagina=&busca=&ver=mes`.

- **Dados (`app/lib/reservas.ts`):**
  - contagem por dia do mês e os três números, numa consulta;
  - busca por jogador com páginas;
  - bloqueio por horário criado, de um ou de vários de uma vez.
- **Regras puras (`app/painel/reservas/apresentacao.ts`):**
  - dia, mês e página vindos da URL;
  - faixa da semana;
  - caixinhas do dia, juntando a agenda com os horários livres de cada quadra;
  - links.

**Tech Stack:** Next.js 15 App Router, React 19, Postgres (PGlite nos testes), Vitest.

**Spec:** `docs/superpowers/specs/2026-10-24-visual-novo-design.md`, seções "Reservas do dono", "Bloqueios" e "Números da agenda do dono". Maquete: `dono-reservas.html`.

## Decisões do construtor

- **Dia padrão:** hoje. **Mês padrão:** o mês do dia escolhido.
  - O calendário anda de 3 meses para trás até o mês do fim da janela de reserva (hoje + 30).
  - Dia ou mês fora disso volta para hoje.
- **Quadra "Todas" no dia:** as caixinhas aparecem em grupos por quadra (título "Quadra 1 · Padel"), cada grupo com seu "Bloquear o dia todo". Com uma quadra escolhida, só ela aparece.
- **Caixinhas:**
  - **Horários livres:** cada horário criado pelo dono que está livre aparece em sua própria caixinha, sem juntar vários, para que "Bloquear" corresponda sempre a um horário.
  - **Reservas e bloqueios:** com o período deles.
  - **Canceladas:** aparecem apagadas, sem botão.
  - **Ordem:** pelo início.
- **Paginação do dia:** 12 caixinhas por página.
- **Bloquear:**
  - Abre uma confirmação na própria caixinha com o motivo, que é obrigatório e tem até 60 caracteres, como hoje.
  - "Bloquear o dia todo" pede o motivo uma vez e bloqueia os horários livres da quadra naquele dia, pulando os que já começaram ou foram ocupados. Avisa: "N horários bloqueados" e "M pulados".
  - O servidor só aceita um horário que exista na quadra para aquele dia da semana (início e fim iguais a um horário criado).
- **O formulário "Bloquear horário" sai.**
  - `bloquearHorario` (o de horas cheias) fica na biblioteca, porque os testes o usam para montar cenários.
  - A tela passa a usar `bloquearHorarios`.
- **Desbloquear:** o "Remover bloqueio" de hoje, com o novo nome.
- **Busca por jogador:**
  - Casa parte do nome, sem acento e sem maiúscula, com pelo menos 2 caracteres.
  - Procura em qualquer dia, passado ou futuro, com as mais recentes primeiro, 10 por página.
  - Com busca, a tela mostra só os resultados, com "Limpar busca".
- **Números:**
  - "Reservas hoje": confirmadas de jogador que começam hoje.
  - "Esta semana": de hoje até o domingo.
  - "A receber": soma das confirmadas de hoje em diante dentro do mês mostrado.
  - Os três respeitam o filtro de quadra. Bloqueios não contam.
- **Contagem no calendário:** reservas confirmadas de jogador que começam no dia. Bloqueios e canceladas não contam.
- **Celular:**
  - Faixa com os 7 dias da semana do dia escolhido, de domingo a sábado, com setas para a semana anterior e a seguinte.
  - "Ver mês inteiro" (`ver=mes`) mostra o calendário no lugar da faixa.

## Global Constraints

- **Isolamento:** tudo sai do `arenaId` da sessão. Quadra, reserva ou horário de outra arena se comporta como inexistente.
  - Server Actions conferem a sessão e usam o relógio do servidor.
- **Regras que não mudam:**
  - o dono cancela só reserva que ainda não começou;
  - o bloqueio ocupa o período;
  - a exclusão 23P01 continua sendo a garantia contra sobreposição.
- **Nada da URL é exibido cru.** A busca aparece só dentro do campo, escapada pelo React.
- **Comandos:**
  - testes: `node node_modules/vitest/vitest.mjs run --no-file-parallelism`;
  - typecheck: `node node_modules/typescript/bin/tsc --noEmit`.
- **Commits:** Conventional Commits e `git add` explícito, terminando com `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`. Branch `feat/visual-novo`.

## Review Focus

- Bloquear horário que não existe, de outra quadra, de outra arena, ou que já começou.
- "Bloquear o dia todo" com um horário já reservado no meio.
- Domingo como dia escolhido. A virada de mês na faixa da semana.
- Busca com `%`, `_` e aspas.
- "A receber" não conta reserva cancelada nem bloqueio.

---

### Task 1: Dados da agenda

**Files:**
- Modify: `app/lib/reservas.ts`
- Test: `tests/reservas.test.ts`

**Acceptance:**
- **`bloquearHorarios(db, arenaId, { quadraId, dia, horarios: {inicio, fim}[], motivo }, agora)`**
  - Devolve `{ ok: true; bloqueados; pulados }` ou `{ ok: false; erro }`.
  - Os horários vêm em minutos.
  - Cada um precisa casar com um horário criado da quadra naquele dia da semana; o que não casa é pulado.
  - Também é pulado o que já começou, ou que esbarra em reserva ou bloqueio (savepoint por item).
  - Motivo obrigatório, de 1 a 60 caracteres. Máximo de 48 horários por chamada.
- **`resumoDoMes(db, arenaId, quadraId | null, mes, agora)`**
  - Devolve `{ porDia: Map<dia, n>, hoje, semana, aReceberCentavos }`, com as definições do plano.
- **`buscarNaAgenda(db, arenaId, termo, pagina)`**
  - Devolve `{ itens: ItemAgenda[]; total }`.
  - Só reservas de jogador, casando parte do nome sem acento e sem maiúscula.
  - Termo com menos de 2 ou mais de 60 caracteres devolve vazio sem consultar o banco.

- [ ] Testes falhando.
- [ ] Implementar.
- [ ] Rodar a suíte e o typecheck.
- [ ] Commit `feat(agenda): bloqueio por horário, resumo do mês e busca por jogador`.

### Task 2: Regras puras da tela

**Files:**
- Modify: `app/painel/reservas/apresentacao.ts`
- Test: `tests/painel-reservas.test.ts` (ou o arquivo de teste que já cobre esse módulo)

**Acceptance:**
- **Leitura da URL:**
  - `lerDiaDono(v, agora)`: dia dentro da faixa do calendário; o resto vira hoje.
  - `mesesDoDono(agora)`: lista de AAAA-MM.
  - `lerMesDono(v, dia, agora)`.
  - `lerPagina(v)`.
- **Datas:**
  - `semanaDoDia(dia)`: 7 dias, de domingo a sábado.
  - `calendarioDoDono(mes, porDia, diaEscolhido, hoje)`: semanas de domingo a sábado, com `n` e `escolhido`.
- **`caixinhasDoDia(itens, quadras: {id, nome, esporte, horarios}[], dia, agora)`**
  - Devolve grupos por quadra, com caixinhas `{ tipo: "reserva" | "bloqueio" | "livre", inicio, fim, ... }` em ordem.
  - A caixinha livre tem `podeBloquear` (ainda não começou).
- **`paginarCaixinhas(grupos, pagina, 12)`.**
- **Links:** `hrefAgenda({ quadra, dia, mes, pagina, busca, ver })`, que omite o que está vazio.
- **Mensagens de `?ok=`:**
  - "bloqueados=N&pulados=M" vira texto fixo montado só com números;
  - "desbloqueado".

- [ ] Testes falhando.
- [ ] Implementar.
- [ ] Rodar a suíte e o typecheck.
- [ ] Commit `feat(agenda): regras do calendário, caixinhas e links`.

### Task 3: Tela

**Files:**
- Modify: `app/painel/reservas/page.tsx`, `actions.ts`, `formularios.tsx` e `app/globals.css` (bloco `ag-`)

**Acceptance (conferido no navegador, computador e celular 390 px, claro e escuro):**
- Busca e chips de quadra no topo.
- **Computador:** calendário e números à esquerda; dia com caixinhas e paginação à direita.
- **Celular:** faixa da semana e "Ver mês inteiro".
- **Ações na caixinha:**
  - Cancelar, com motivo opcional;
  - Desbloquear;
  - Bloquear, com motivo;
  - Bloquear o dia todo.
  - Depois de cada ação, volta para o mesmo dia, quadra e página, com a mensagem.
- **Busca:** lista de resultados com páginas e "Limpar busca".
- **Sem quadras:** "Cadastre uma quadra para ver a agenda."
- Sem estouro em 360 px. Foco visível.

- [ ] Implementar.
- [ ] Rodar a suíte e o typecheck.
- [ ] Conferir no navegador.
- [ ] Commit `feat(agenda): calendário do dono com caixinhas e ações`.

## Decisões tomadas na construção

- `podeBloquear` não existe: as caixinhas livres já saem de `horariosDoDia`, que só traz horários que ainda não começaram, então todo "Bloquear" mostrado é válido.
- "Bloquear o dia todo" só aparece com 2 ou mais horários livres; com 1, o "Bloquear" do próprio horário faz o mesmo.
- A paginação da agenda é só com setas (‹ e ›) e "Página X de Y" no meio, a pedido do dono.
