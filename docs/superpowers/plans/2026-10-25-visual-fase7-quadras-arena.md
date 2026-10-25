# Visual novo — fase 7: o que faltava de Quadras e Arena (dono)

Spec: `docs/superpowers/specs/2026-10-24-visual-novo-design.md`, seção "Quadras e Arena (dono)".

Minhas reservas (a "fase 7" da sugestão de ordem do spec) já está no ar desde 25/10 (main cd5d637). Ao conferir o spec, faltavam só dois pedaços do painel do dono; esta fase fecha os dois.

## Tarefa 1 — dados (TDD)

- `listarQuadras` passa a devolver `fotos` (só as da quadra), `aPartirDe` (menor `preco_centavos` dos horários, ou null) e `porHora` (todos os horários com 1 h). Tudo filtrado pela arena.
- `dadosArenaDono` passa a devolver `coordenadas: { latitude, longitude } | null`.
- Aceite: testes em `tests/painel.test.ts` e `tests/arena-dono.test.ts`.

## Tarefa 2 — telas

- Lista de quadras (`/painel`): card com capa, "Nome · esporte", "a partir de R$ X/h" (mesmo texto da home, `textoAPartirDe`), "N fotos" e o selo "Recebendo reservas" (tem horários) ou "Falta preço" (sem horários). Câmera e botões continuam.
- Arena (`/painel/arena`): mapinha (Leaflet, como a home) com o pino onde a arena aparece, abaixo do formulário. Sem coordenadas: aviso "Salve o endereço para a arena aparecer no mapa." O mapinha é extra: sem JavaScript, o resto da tela funciona.
- Aceite: conferido no computador e no celular, claro e escuro, sem rolagem horizontal a 390 px.
