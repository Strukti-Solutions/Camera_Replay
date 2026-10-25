# Visual novo, fotos e horários criados pelo dono — design

Data: 24/10/2026. Aprovado em conversa com o dono do projeto, tela por tela, com esboços (`.superpowers/brainstorm/2811-1792859524/content/`, git-ignorado). Este documento complementa `2026-10-22-reservas-publicas-design.md`; onde os dois divergem, vale este.

## Por que

O site funciona (fases 1 a 4a no ar), mas no computador ele é a versão de celular esticada: muito espaço vazio, listas de texto sem fim e formulários soltos. O dono quer um site que pareça produto: fotos das arenas, cards, calendário, menos texto e navegação que sempre deixa voltar. Ao mesmo tempo, quer dar liberdade ao dono da arena para montar horários quebrados (ex.: 15h30 às 17h15), o que o modelo atual de horas cheias não permite.

Sucesso: abrir no computador e no celular e as duas versões parecerem pensadas para aquela tela; o jogador achar uma arena pela foto, escolher quadra, dia e horário sem ler instrução; o dono ver a agenda num calendário e bloquear um horário clicando nele.

## Metas

1. Layout próprio para computador e para celular em todas as telas, com largura máxima centralizada no computador (nada esticado de ponta a ponta).
2. Fotos: o dono cadastra fotos da arena e de cada quadra.
3. Home com busca, filtro por esporte, cards com foto e mapa.
4. Página da arena com reserva em carrossel de 3 passos (quadra → dia → horário).
5. Horários criados pelo dono, com preço por horário e checagem de choque.
6. Agenda do dono em calendário, com bloquear/cancelar/desbloquear direto nos horários, busca por jogador e páginas.
7. Minhas reservas em caixinhas, com abas e páginas; detalhe com os lances.
8. Modo claro e escuro com botão; marca "Replay" em destaque e Strukti discreta.
9. "← Voltar" em todas as telas internas, inclusive depois de criar conta.

## Não metas

- Pagamento online (fase 4b, Asaas) e o worker de captura: ficam para depois.
- Mudar regras já decididas: cancelamento grátis até 24 h antes, limite de 2 reservas futuras por arena e 5 no total, "pagar na arena", lances por até 3 dias.
- Novo layout da página do replay (QR/botão) e do painel do super admin: só recebem o visual novo (cores, tipografia, topo), sem redesenho.

## Anti-metas (seria fracasso mesmo funcionando)

- Computador parecendo celular esticado, ou tela "muito retangular": conteúdo deve ficar numa coluna de largura máxima centralizada.
- Listas infinitas de texto puro. Tudo que é lista vira caixinha/card e pagina quando cresce.
- Dono preso a horas cheias.
- Tela sem caminho de volta.
- Logo da Strukti chamando mais atenção que o nome Replay.

## Restrições

- Next.js 15 (App Router), Postgres, R2 (já usado para clipes, `app/lib/r2.ts`). Leaflet + OpenStreetMap já em uso no mapa.
- Português em todo texto. Dinheiro em centavos inteiros. Fuso America/Sao_Paulo.
- Paleta atual do site (tokens `--navy-*`, `--electric-*`, `--cyan-*` em `app/globals.css`): fundo claro `navy-50`, primário `electric-700`. O modo escuro é o azul-marinho de hoje.
- Regras do CLAUDE.md: TDD, cada agente na sua pasta, mudança de contrato (tabela, API) passa pelo spec — este documento é esse passo.
- Arquivos `"use server"` só exportam funções assíncronas (teste `tests/use-server.test.ts`).

## Decisões do dono, como ele decidiu

### Topo e marca (todas as telas)
- "Replay" é o nome em destaque. A logo da Strukti fica pequena e apagada ao lado ("por Strukti").
- Botão de tema ☀/☾ no topo de todas as telas. Escuro = azul-marinho atual; claro = branco/`navy-50`.
- "← Voltar" leva para onde a pessoa estava (busca, arena, lista de quadras…). Depois de criar conta ou entrar, a pessoa volta para onde estava (já existe `voltar` no login; estender ao cadastro e garantir em todas as telas).

### Home (busca)
- **Computador (opção B aprovada):** busca em cima; abaixo, lista de cards à esquerda e mapa sempre aberto à direita. Passar o mouse num card destaca o pino.
- **Celular:** título, busca, botões de esporte para filtrar, carrossel horizontal de cards ("Arenas em destaque"); depois de buscar, os resultados viram lista vertical; botão flutuante "Ver no mapa" abre o mapa em tela cheia, com preço no pino; tocar num pino mostra o card da arena embaixo; "←" volta à lista.
- **Card da arena:** fotos (deslizam com o dedo ou o mouse, sem troca automática — decisão do dono, 25/10), nome, bairro, "a partir de R$ X/h" (ou "a partir de R$ X" com horários de duração variável — ver Horários) e chips dos esportes.

### Página da arena (jogador)
- **Balão do endereço:** nome da arena e endereço juntos num balão com fundo, ícone de pino e "Como chegar ›". O balão inteiro é o botão e abre o mapa com a rota (link atual do Google Maps).
- **Computador:** tela dividida ao meio. Esquerda: foto grande, quadrada (1:1). Direita: o carrossel da reserva.
- **Celular:** balão, foto (4:3) e o carrossel embaixo.
- **Fotos e escolha de quadra:** enquanto o jogador não escolheu quadra, as fotos da arena passam sozinhas (troca a cada poucos segundos, com bolinhas). Ao escolher uma quadra, a foto muda para a capa daquela quadra e fica parada, com o nome da quadra no canto.
- **Carrossel de 3 passos**, com tracinhos de progresso e "‹" para voltar ao passo anterior:
  1. **Quadra:** lista das quadras com esporte e "a partir de".
  2. **Dia:** calendário do mês inteiro (todas as semanas visíveis, preenchendo o cartão até a altura da foto); dias com horário livre em azul, poucos horários em amarelo, indisponíveis (passados, lotados ou sem horário) apagados; setas para mudar de mês dentro da janela de reserva. Tocar num dia já abre os horários, sem botão "Ver horários" (decisão do dono, 25/10).
  3. **Horário:** os horários do dia criados pelo dono, em caixinhas com preço; ocupados tracejados. No computador, mostrar o dia inteiro agrupado em "madrugada e manhã", "tarde" e "noite", para preencher o cartão. O jogador pode marcar horários seguidos para jogar mais tempo. Resumo (quadra, dia, horário, total, "Pagamento na arena · cancelamento grátis até 24 h antes") e botão Reservar.

### Horários e preços (dono, dentro da quadra) — muda o modelo
- O dono cria cada **horário** (início, fim, preço). O jogador paga pelo horário. Para jogar mais tempo, reserva **horários seguidos**.
- A tela mostra os dias da semana em botões (com a contagem de horários) e os horários do dia em caixinhas; clicar muda hora/preço; "✕" apaga.
- O painel de criar **só aparece ao clicar em "+ Novo horário"**: painel lateral com duas abas:
  - **Um horário:** início, fim, preço (minutos livres, ex.: 15:30–17:15).
  - **Vários fixos:** das/até, duração de cada um, preço; mostra a prévia antes de criar.
- **Choque de horários (pedido do dono):** validação simples. Um horário avulso que sobrepõe outro mostra "Esse horário choca com 15h30 – 17h15", marca o conflitante e não salva. Na criação em lote, a prévia marca os que chocam; esses são pulados e os outros criados, com aviso de quantos foram pulados. A mesma regra vale no servidor (não depende só da tela).
- "Copiar segunda para outros dias…".
- Normalmente o dono vai criar horários de hora em hora; a liberdade é para exceções.

### Quadras e Arena (dono)
- **Lista de quadras:** cards com a foto de capa, nome · esporte, contagem de fotos, "a partir de", e selo "Recebendo reservas" ou "Falta preço" (sem horários).
- **Dentro da quadra:** fotos da quadra (a primeira é a capa; arrastar muda a ordem), nome, esporte, botões e câmera só leitura (decisão anterior), e a seção de horários acima.
- **Arena:** fotos gerais (as que passam no carrossel da página pública; a capa aparece no card da busca), nome, endereço e um mapinha com o pino de onde a arena aparece.

### Reservas do dono
- **Computador:** busca pelo nome do jogador (acha reservas em qualquer dia, resultado em páginas) e filtro por quadra no topo. Esquerda: calendário do mês com o número de reservas em cada dia, e embaixo três números (reservas hoje, nesta semana, a receber). Direita: os horários do dia clicado em caixinhas:
  - reserva: jogador, valor, situação, **Cancelar** (com motivo opcional, como hoje);
  - bloqueio: motivo e **Desbloquear**;
  - horário livre: caixinha tracejada com **Bloquear** ali mesmo (substitui o formulário "Bloquear horário" de hoje).
  - Se o dia tiver muitos itens, pagina.
- **Celular:** faixa de dias da semana para deslizar (com contagem), as mesmas caixinhas, e "Ver mês inteiro".

### Minhas reservas (jogador)
- Abas "Próximas" e "Histórico" (histórico em páginas). Cada reserva é uma caixinha com a foto da quadra e a data em destaque (dia da semana + número).
- Próximas: horário, valor, "Confirmada", até quando cancela grátis; botões "Como chegar" e "Cancelar".
- Histórico: contagem de lances, "Ver lances", "Reservar de novo"; cancelada pela arena mostra o motivo.
- **Detalhe:** dados da reserva de um lado; lances (vídeos) do outro, com "Baixar" e "Compartilhar"; "disponíveis por até 3 dias".

### Entrar, criar conta, minha conta
- Só o formulário centralizado (sem imagem ao lado), no padrão do topo novo. Criar conta e Minha conta seguem o mesmo estilo.

## Mudança de contrato: horários do dono

Hoje: `precos_quadra` guarda faixas de hora cheia por dia da semana (`inicio`/`fim` em horas, preço por hora) e a reserva é uma sequência de horas cheias (`reservas.detalhe` = `[{hora, precoCentavos}]`), com `iniciosLivres`/`precoEscolha` em `app/lib/disponibilidade.ts`.

Novo: o dono cadastra **horários** por quadra e dia da semana, cada um com início e fim em minutos do dia (0–1440, fim > início) e preço em centavos pelo horário inteiro. Horários da mesma quadra e do mesmo dia não podem se sobrepor (checado na gravação, dentro de transação). A reserva passa a referenciar um ou mais horários **seguidos** (o fim de um é o início do próximo) do mesmo dia; `reservas.periodo` continua sendo o intervalo total, e a restrição de exclusão existente continua sendo a garantia contra reserva dupla. `detalhe` passa a listar os horários (início, fim, preço).

Regras que se mantêm: janela de reserva (hoje até +30 dias), só horários que começam depois de agora, limite 2/5, cancelamento 24 h, bloqueio do dono ocupa o período, "pagar na arena", taxa 0 até a 4b.

Regras que mudam:
- "Até 4 horas seguidas" vira **até 4 horários seguidos** (decisão minha; ver chamadas).
- Bloqueio do dono: clicar em "Bloquear" num horário livre bloqueia aquele horário (período = início e fim dele). O bloqueio de período arbitrário (formulário atual) sai da tela.
- "A partir de" = menor preço entre os horários da quadra (ou da arena, no card).
- Selo "Falta preço" = quadra sem nenhum horário.

Edição e remoção de horários (decisão minha):
- O dono pode editar ou apagar um horário a qualquer momento. Reservas já feitas **não mudam**: guardam período e preço próprios (`detalhe` é uma cópia, sem chave estrangeira para o horário). Ao editar ou apagar um horário que tem reservas futuras, a tela avisa "Esse horário tem N reservas futuras; elas continuam valendo como foram feitas".
- Se um horário editado passa por cima de uma reserva existente, ele aparece ocupado naquele dia (a ocupação vem de `reservas.periodo`, como hoje).
- "Vários fixos" cria só no dia da semana selecionado. "Copiar segunda para outros dias…" **soma** aos horários dos dias de destino, pulando os que chocam e avisando quantos foram pulados (nunca apaga nada).

Bloqueios (decisão minha):
- Além de "Bloquear" em cada horário livre, o dia selecionado na agenda tem "Bloquear o dia todo", que bloqueia de uma vez todos os horários livres daquele dia na quadra (um bloqueio por horário), com o mesmo motivo.
- Bloqueios já gravados com período livre continuam valendo: aparecem na agenda como uma caixinha com o período deles e têm "Desbloquear". Não há migração deles (produção não tem bloqueio futuro).

Números da agenda do dono (decisão minha): "hoje" = reservas confirmadas que começam hoje; "esta semana" = de hoje até domingo; "a receber" = soma dos valores das reservas confirmadas de hoje em diante dentro do mês mostrado. Não existe controle de "pago na arena"; isso fica para a 4b.

Migração dos dados: cada faixa de `precos_quadra` vira horários de 1 hora com o mesmo preço (produção tem só as faixas de teste da arena "Teste"; local tem a Arena Beira-Mar). Reservas já gravadas não mudam (todas canceladas em produção).

## Fotos

- Arena: até 10 fotos; quadra: até 6 (decisão minha). Ordem definida pelo dono; a primeira é a capa.
- Guardadas no R2, como os clipes, com chave por arena. Leitura pública (são fotos para divulgação) ou URL assinada longa — escolha do construtor.
- Formatos JPEG, PNG e WebP; tamanho máximo por foto e redimensionamento ficam a cargo do construtor, com um limite que evite fotos de vários MB no celular.
- Só o dono da arena (e a Strukti) envia e apaga fotos da própria arena.
- Sem foto: a página e os cards mostram um fundo neutro com o esporte, nunca um espaço quebrado.

### Fotos: decisões do construtor (25/10)

- **Tabela `fotos`:** `id` (uuid), `arena_id`, `quadra_id` (nulo = foto da arena), `chave` no R2, `tipo` (`image/jpeg`, `image/png` ou `image/webp`), `bytes`, `posicao` e `criado_em`. A capa é a de menor `posicao`. A foto apaga junto com a quadra (cascade).
- **Envio pelo servidor** (server action). Antes de enviar, o navegador reduz a foto para no máximo 1600 px no lado maior e a converte para WebP (qualidade 0,82). Sem JavaScript, ou se a redução falhar, vai o arquivo original.
- **Validação no servidor:** até 2 MB por foto. O formato é conferido pelos primeiros bytes do arquivo (JPEG, PNG ou WebP); o nome e o tipo informados pelo navegador não contam.
- **Chave no R2:** `fotos/<arenaId>/<fotoId>.<jpg|png|webp>`. O bucket continua privado.
- **Leitura:** pela rota do site `/fotos/<fotoId>`, que busca no R2 e devolve com `Cache-Control: public, max-age=86400`. Uma foto apagada some do cache em até 1 dia. A URL só tem o id (uuid), que nunca é reaproveitado.
- **Limites** (10 por arena, 6 por quadra) conferidos dentro de transação, com trava na linha da arena, para dois envios ao mesmo tempo não passarem do limite.
- **Ordem:** botões "Mover para a esquerda", "Mover para a direita" e "Usar como capa" (funcionam sem JavaScript e no teclado). Arrastar fica para depois.
- **Apagar:** apaga primeiro no R2 (404 conta como apagado) e depois a linha. Se o R2 falhar, nada muda e a tela avisa.
- **Sem R2 configurado:** a tela mostra as fotos que houver e avisa que o envio está indisponível.
- **Onde aparece na fase 3:** no painel (gestão das fotos da arena e de cada quadra, e a capa na lista de quadras) e em Minhas reservas (capa da quadra; sem ela, a capa da arena; sem as duas, o degradê). Página da arena e home usam as fotos nas fases 4 e 5.
- **Strukti:** o super admin gerencia as fotos de qualquer arena em `/admin/arenas/<id>` (mesma grade do dono; feito em 25/10). As imagens passam por `/admin/fotos/<id>`, que exige a sessão de admin e serve também foto de arena suspensa; a rota pública `/fotos/<id>` só serve foto de arena ativa.
- **Pendências conhecidas:**
  - Quando existir apagar quadra ou arena, apagar também os arquivos do prefixo `fotos/<arenaId>/` no R2 (a cascata só apaga as linhas).
  - Sem JavaScript, a foto vai original, com os metadados (EXIF, inclusive GPS). Com JavaScript, a redução no navegador os remove.

## Tema claro e escuro

- Hoje o escuro segue só o sistema (`prefers-color-scheme`). Novo: segue o sistema por padrão e o botão ☀/☾ troca e lembra a escolha no aparelho (cookie, para o servidor já renderizar no tema certo e não piscar).

## O que fica com o construtor

- Componentes, CSS e como dividir em tarefas; bibliotecas pequenas só se precisar (o carrossel e o calendário dão para fazer sem dependência).
- Detalhes de tamanhos, espaçamentos e animações, seguindo os esboços.
- Como enviar a foto ao R2 (pelo servidor ou URL de envio assinada), compressão e limites.
- Formato exato das tabelas novas e da migração, respeitando o contrato acima.
- Ordem das fases. Sugestão: (1) tema, topo, marca, voltar e largura máxima; (2) horários do dono + migração + passo 3 do jogador; (3) fotos; (4) página da arena em carrossel; (5) home; (6) reservas do dono; (7) minhas reservas.

## Chamadas que fiz sem o dono (conferir)

- Limite de 6 fotos por quadra e 10 por arena.
- Até 4 horários seguidos por reserva.
- Filtro por esporte e lista após a busca na home do celular.
- Os três números embaixo do calendário do dono (hoje, semana, a receber).
- "Reservar de novo" e "Compartilhar" nas reservas do jogador.
- Tema seguindo o sistema por padrão.
- Bloqueio do dono passa a ser por horário criado (o bloqueio de período livre sai), com "Bloquear o dia todo".
- Editar ou apagar horário não mexe nas reservas já feitas (só avisa).
- Copiar dias soma e pula os que chocam; nunca apaga.
- Definição dos números "hoje", "esta semana" e "a receber".
