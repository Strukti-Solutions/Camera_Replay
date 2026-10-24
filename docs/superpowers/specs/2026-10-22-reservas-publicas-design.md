# Reservas públicas, login único e pagamento (design)

**Data:** 22/10/2026. **Estado:** para aprovação do dono do projeto (com as respostas da revisão de quem constrói).
**Relação com o spec principal:** este documento muda partes de `2026-10-16-replay-saas-design.md`: contas de aluno presas a uma arena, cadastro de aluno pelo dono, vários alunos por reserva, atribuição de lance a aluno, logins separados, e quadras e câmeras criadas pelo dono. Quando os dois divergem, vale este. O resto do spec principal continua valendo: botão, fila, worker, R2, retenção de 3 dias, isolamento por `arena_id` e suspensão de arena.

Marcações: **(decisão do dono)** foi dito por ele; **(decisão nossa)** foi escolha do time, e ele pode mudar.

## Intenção

Hoje o Replay é só "aperta o botão e o lance fica salvo", e quem cria as contas e as reservas é o dono, à mão. A ideia é que o Replay vire **o lugar onde o jogador acha uma quadra, reserva, cria a conta e paga, tudo num fluxo só**. Os lances gravados durante o jogo aparecem na reserva dele. Nada disso funciona hoje nas arenas: a plataforma passa a ser o canal de reserva.

Modelo de negócio **(decisão do dono)**: o dono paga uma **mensalidade** à Strukti e, em cada reserva paga pelo site, a Strukti fica com uma **taxa pequena**. É um modelo misto, e deve dar para mudar depois (só taxa, só mensalidade, valores por arena).

O sistema **não está em produção**. Dá para apagar o que ficar obsoleto e refazer o banco, sem migrar dados antigos **(decisão do dono)**.

## Papéis

| Quem | Onde | O que faz |
|---|---|---|
| **Strukti (super admin)** | `/admin` | Cria a arena e a conta do dono, as quadras, as câmeras e os botões; suspende arena; define a taxa da arena. |
| **Dono da arena** | painel | Ajusta nome e endereço da arena, nome das quadras, **preços e horários**; vê as reservas e os lances da arena; cancela reserva. **Não cria quadra nem câmera** **(decisão do dono)**. |
| **Jogador** | site público e "Minhas reservas" | Cria a conta sozinho, busca a arena, reserva, paga, cancela no prazo, vê os lances das reservas dele. |

O "aluno" de hoje vira **jogador**: conta própria, criada por ele, **da plataforma e não de uma arena**. Reserva em qualquer arena com o mesmo login **(decisão do dono)**. O cadastro de aluno pelo dono, a tela de alunos do painel, "Editar alunos" da reserva e "Atribuir a alunos" do lance são **apagados** **(decisão do dono)**.

## Fases (nesta ordem)

Cada fase é entregue, revisada e publicada antes da próxima.

1. **Login único e conta do jogador.**
2. **Strukti cria, dono ajusta:** quadras, câmeras e botões passam para o admin; o dono ganha endereço, preços e horários.
3. **Busca pública com mapa** e página pública da arena com horários livres e preço.
4. **Reserva paga:** cadastro no meio do fluxo, pagamento pelo Asaas, "Minhas reservas", cancelamento.
5. *(Depois, fora deste documento)* Cobrança da mensalidade do dono pelo sistema. Até lá, a Strukti cobra por fora **(decisão nossa)**.

---

## Fase 1 — Login único e conta do jogador

- **Uma tela de entrar só** (`/entrar`), com e-mail e senha. Pelo tipo da conta, o sistema leva **o super admin para `/admin`, o dono para o painel e o jogador para "Minhas reservas"** **(decisão do dono)**. As telas de entrar de hoje (`/admin/entrar`, `/a/<slug>/entrar`) deixam de existir ou redirecionam para `/entrar`.
- **Um e-mail é uma conta só na plataforma inteira** **(decisão nossa)**. Criar um dono com um e-mail que já é de jogador, ou o contrário, falha com mensagem clara. Quem é dono e também joga usa outro e-mail. Isso evita a pergunta "entrar como quem?".
- **Criar conta** (`/criar-conta`): nome, e-mail, senha (8 ou mais caracteres, como hoje). Só cria jogador; dono e super admin continuam sendo criados pela Strukti.
- As sessões continuam separadas por tipo (cookie, duração, SameSite), como no spec principal. Muda só a porta de entrada. A sessão do super admin segue mais curta e com SameSite Strict.
- Continuam valendo o limite de tentativas (por e-mail e por IP), o scrypt e a resposta igual para "e-mail não existe" e "senha errada". O limite por IP continua valendo por tipo de conta, para que jogadores errando a senha no Wi-Fi da arena não travem o dono nem o admin; e qualquer bloqueio (por e-mail ou por IP) responde igual a uma senha errada, sem revelar o tipo da conta **(decisão nossa)**.
- **Esqueci a senha** **(decisão do dono: entra na fase 1)**, para jogador, dono e super admin:
  - Na tela de entrar, "Esqueci a senha" pede o e-mail e **sempre responde a mesma coisa** ("Se o e-mail tiver conta, enviamos um link"), para não revelar quem tem conta.
  - O e-mail traz um link de uso único, válido por **1 hora** **(decisão nossa)**. O banco guarda só o hash do token, como nas sessões. O pedido tem limite por e-mail e por IP.
  - Trocar a senha pelo link **encerra todas as sessões** da conta e invalida os outros links pendentes.
  - **Envio de e-mail** por um serviço transacional com plano grátis (Resend ou similar), com remetente num domínio da Strukti **(decisão nossa)**. Exige configurar o DNS do domínio (SPF/DKIM). A chave do serviço fica só nas variáveis de ambiente.
- **Apagar a conta** **(decisão do dono)**, só para o jogador, em **"Minha conta"**:
  - Pede a senha de novo e uma confirmação explícita.
  - Apaga nome, e-mail, senha, CPF e sessões. O e-mail fica livre para uma conta nova.
  - **Com reserva futura confirmada não dá para apagar:** primeiro ele cancela, se ainda estiver no prazo, ou espera o jogo passar **(decisão nossa)**.
  - **Reservas passadas continuam na agenda e no financeiro do dono**, sem o nome do jogador ("Conta apagada"). Os lances dessas reservas passam a ser só do dono, como lance sem jogador **(decisão nossa)**.
  - Dono e super admin não se apagam sozinhos; isso é feito pela Strukti.
- **"Minha conta"** do jogador: trocar nome e senha (pedindo a senha atual) e apagar a conta.
- No topo do site público ficam sempre **Entrar** e **Criar conta** e, logado, **Minhas reservas** e **Sair**.
- O QR da arena (`/a/<slug>`) passa a abrir a **página pública da arena** (fase 3). Até a fase 3, abre `/entrar`.
- **Termos de uso e política de privacidade:** aceitos na criação da conta (caixa de marcar, obrigatória). A fase 1 usa um **texto provisório, marcado como provisório**, trocado pelo definitivo antes de abrir ao público **(decisão do dono)**. A conta guarda a versão aceita e a data do aceite.
- **Entre a fase 1 e a fase 4, nenhum jogador vê lance; só o dono vê** **(decisão do dono)**. A fase 1 apaga alunos, `reserva_alunos`, `clipe_alunos` e as telas de reserva com alunos do painel. As reservas voltam na fase 4, já pagas, junto com o bloqueio de horário.

## Fase 2 — Strukti cria, dono ajusta

- **No admin**, por arena: criar e renomear quadras, cadastrar câmera e botão (o que hoje está no painel do dono) e definir a **taxa da Strukti** da arena.
- **No painel do dono:**
  - **Arena:** nome e **endereço** (rua, número, bairro, cidade, UF, CEP). Ao salvar, o endereço vira **latitude e longitude**, uma vez, para o mapa. Se a conversão falhar, salva assim mesmo e a arena fica sem ponto no mapa, com aviso ao dono.
  - **Quadra:** nome, esporte (texto curto, ex.: "Beach tennis") e **tabela de preços**.
- **Tabela de preços** **(decisão do dono)**: por quadra, faixas de **dia da semana + horário de início e fim + preço por hora**. Exemplo: de segunda a sexta, das 7h às 17h, R$ 80; das 17h às 23h, R$ 120; sábado e domingo, das 7h às 23h, R$ 120.
  - **A tabela também define quando a quadra abre:** hora fora de toda faixa não é reservável.
  - Faixas da mesma quadra e do mesmo dia não podem se sobrepor.
  - **Reserva em horas cheias**, começando na hora redonda, de **1 a 4 horas** **(decisão nossa)**. Cada hora é cobrada pelo preço da faixa em que começa. Por isso uma reserva das 16h às 18h custa 80 + 120.
  - Fuso: `America/Sao_Paulo`. A tabela é em hora local.
- **Quadra sem tabela** aparece na página da arena como "Reservas indisponíveis".
- A **taxa da Strukti** é **percentual por arena**, definida no admin, com um padrão para arenas novas **(decisão nossa; valor padrão a definir pelo dono do projeto)**. **Ela sai da parte do dono:** o preço da tabela é o que o jogador paga **(decisão do dono)**.

## Fase 3 — Busca pública com mapa

- **Página inicial** (`/`):
  - No topo, uma barra grande, **"Nome da arena ou endereço"**. Enquanto a pessoa digita, aparecem as arenas que batem pelo nome ou por qualquer parte do endereço, e tocar numa abre a página dela **(decisão do dono)**.
  - **Um mapa** com todas as arenas ativas como pontos. Fica pequeno abaixo da busca e **expande para a tela inteira** pelo botão "Ver no mapa". Tocar num ponto mostra o nome e abre a arena **(decisão do dono)**.
  - Mapa com **Leaflet + OpenStreetMap**, gratuito e sem chave **(decisão nossa)**. Respeitar a política de uso dos tiles do OSM (atribuição visível). Se o uso crescer, trocar por um provedor de tiles com plano grátis (MapTiler ou similar).
  - **Sem JavaScript:** a busca funciona como formulário comum e lista as arenas; o mapa simplesmente não aparece.
  - Arena suspensa ou sem endereço não aparece no mapa. A suspensa também não aparece na busca, como hoje.
- **Página da arena** (`/a/<slug>`, a mesma do QR): nome, endereço (com link "Como chegar" para o app de mapas do celular) e as quadras. Em cada quadra:
  - Escolha de **dia**, até 30 dias à frente **(decisão nossa)**; **horário de início**, só os livres; e **quantas horas**, de 1 a 4, limitadas ao que está livre em seguida.
  - **Preço total** calculado na hora, com o detalhe por hora quando houver mais de uma faixa.
  - Botão **Reservar**.
  - "Livre" = dentro da tabela de preços, no futuro, sem reserva confirmada e sem reserva **segurada** por outra pessoa (fase 4).

## Fase 4 — Reserva paga

> **Emenda de 23/10/2026 (decisão do dono: "pagamento fica para depois, faz todo o resto"):** a fase 4 é feita em duas partes. **4a (agora):** tudo, menos o pagamento online — horário reservado sem sobreposição no banco, bloqueio de horário pelo dono, volta à escolha após o login, confirmação, "Minhas reservas" com os lances, cancelamento e agenda do dono. Sem provedor de pagamento configurado, a reserva é **confirmada na hora como "pagar na arena"** (o dono recebe pessoalmente; a Strukti não cobra taxa nessas reservas) **(decisão nossa)**. O código já nasce com o estado `segurada` e o prazo de 10 minutos, prontos para a 4b. **4b (quando houver conta Asaas):** cobrança com split, página de pagamento do Asaas, webhook, estorno — como descrito abaixo; a partir daí "pagar na arena" deixa de ser oferecido (ou vira opção do dono, a decidir). Pesquisa da API em `docs/pesquisa/asaas.md`.

### Fluxo

1. Na página da arena, o jogador escolhe quadra, dia, início e horas, e clica em **Reservar**.
2. **Sem login:** vai para entrar ou criar conta e **volta para a mesma escolha, com tudo preenchido** **(decisão do dono)**. A escolha viaja na URL (quadra, dia, início, horas); o servidor revalida tudo ao voltar.
3. **Tela de confirmação:** arena, quadra, dia, horário, total e a regra de cancelamento. Ao confirmar, o sistema **segura o horário por 10 minutos** **(decisão nossa)** e cria a cobrança no Asaas.
4. **Pagamento** por **Pix** (QR e "copia e cola") ou **cartão de crédito**, pelo Asaas **(decisão nossa)**. O pagamento acontece na **página de pagamento do próprio Asaas**: o site redireciona para ela e volta depois. O número do cartão nunca passa pelo nosso servidor **(decisão nossa)**.
5. **Pagamento confirmado → reserva confirmada.** Ela aparece em "Minhas reservas" e no painel do dono.
6. Se os 10 minutos acabarem sem pagamento, o horário é liberado. Um pagamento que chegue depois disso, se o horário ainda estiver livre, confirma a reserva; se não estiver, é **estornado automaticamente**.

### Dinheiro

- **Asaas com split:** a cobrança é da Strukti, e o Asaas divide o valor na hora entre a parte do dono (conta ou subconta Asaas da arena) e a taxa da Strukti **(decisão do dono: Asaas; decisão nossa: split)**. Ninguém repassa dinheiro à mão.
- Cada arena precisa de uma **conta Asaas vinculada** (o identificador da carteira para o split), cadastrada pela Strukti no admin. **Arena sem conta vinculada não recebe reservas pagas**: a página mostra as quadras, mas sem o botão Reservar.
- **Confirmação pelo webhook do Asaas**, nunca pelo retorno do navegador. O webhook é autenticado (token do Asaas), **idempotente** (o mesmo evento duas vezes não confirma duas vezes nem estorna duas vezes) e registra cada evento recebido.
- **Quem fica com quanto** **(decisão do dono)**: o jogador paga o preço da tabela. O split manda a **taxa percentual para a Strukti** e **o resto para o dono**. As tarifas do Asaas (Pix ou cartão) saem da parte do dono, inclusive a tarifa que o Asaas não devolve num estorno. Exemplo: hora de R$ 100, taxa de 5% → o jogador paga R$ 100, a Strukti recebe R$ 5 e o dono recebe R$ 95 menos a tarifa do Asaas.
- **Estorno que falha** (por exemplo, porque o dono já sacou o dinheiro): a reserva fica cancelada com a situação "estorno pendente", visível no admin, e a Strukti resolve à mão com o dono **(decisão nossa)**.
- **Preço gravado na reserva:** a reserva guarda o valor total, a taxa e o detalhe por hora no momento da compra. Mudar a tabela depois não altera reservas existentes.
- O Asaas pede **CPF** do pagador para emitir cobrança. O CPF é pedido **na primeira compra**, não no cadastro, e fica guardado na conta do jogador **(decisão nossa; confirmar a exigência na documentação do Asaas)**.

### Cancelamento **(decisão do dono)**

- **Jogador:** cancela pelo "Minhas reservas" **até 24 h antes do início** e recebe **o valor inteiro de volta, inclusive a taxa** **(decisão nossa)**. O horário volta a ficar livre. Com menos de 24 h, o botão some e não há devolução.
- **Dono:** cancela pelo painel **a qualquer momento**, por chuva, manutenção ou outro motivo, e o jogador recebe tudo de volta **(decisão nossa)**.
- O estorno é feito pelo Asaas. A reserva fica marcada como cancelada, com o motivo e quem cancelou, e continua no histórico dos dois.

### Minhas reservas

- Duas listas: **Próximas** e **Histórico**. Cada reserva mostra arena, quadra, dia, horário, valor e situação (confirmada, cancelada, estornada).
- **Os lances de uma reserva são do jogador que reservou** **(decisão do dono)**: clipes `pronto`/`parcial`, não expirados, das câmeras da quadra, com `recebido_em` em `[inicio, fim)`, como hoje. **Uma reserva tem um jogador só**; os amigos assistem pela conta dele ou recebem o vídeo baixado **(decisão do dono)**.
- Lance fora de qualquer reserva: **só o dono vê**, como hoje. Não existe mais atribuir lance a alguém **(decisão nossa)**.

### Painel do dono

- **Reservas** passa a ser a agenda da arena: as reservas pagas (com o nome do jogador e o valor) e as canceladas. O dono **não cria reserva paga em nome de outro**.
- **Bloquear horário** **(decisão do dono: entra antes do pagamento ir ao ar)**: o dono escolhe quadra, dia, início e fim e um motivo curto (ex.: "Reserva por telefone — João"). O horário bloqueado deixa de aparecer como livre e entra na mesma regra de não sobreposição das reservas, no banco. Bloqueio não tem jogador nem pagamento; os lances do horário bloqueado só o dono vê. Dá para remover o bloqueio.

### Arena suspensa **(decisão nossa)**

- Deixa de aparecer na busca e no mapa e **não aceita reservas novas**.
- **Reservas já pagas continuam valendo**: o jogador continua vendo a reserva e os lances dela em "Minhas reservas". Nada é estornado automaticamente.
- Antes de suspender, o admin mostra quantas reservas futuras confirmadas a arena tem.

---

## Dados (direção, não esquema final)

- **Contas:** jogador sem `arena_id`. E-mail único na plataforma inteira (ver Fase 1). Saem `alunos`, `reserva_alunos`, `clipe_alunos` e `sessoes_aluno`, e entra a conta e a sessão do jogador.
- **Arenas:** endereço, latitude e longitude, taxa percentual e identificador da carteira Asaas.
- **Quadras:** esporte; tabela de preços em tabela própria (quadra, dia da semana, início, fim, preço por hora em centavos).
- **Reservas:**
  - Ganham jogador, situação (`segurada`, `confirmada`, `cancelada`), `segura_ate`, valores em centavos (total, taxa, detalhe) e os dados da cobrança Asaas.
  - A **sobreposição** entre reservas `segurada` (dentro do prazo), `confirmada` e **bloqueios** da mesma quadra passa a ser impedida pelo **próprio banco** (constraint de exclusão com `btree_gist`), resolvendo a dívida conhecida da corrida. Bloqueio pode ser uma reserva sem jogador ou uma tabela própria; a escolha fica com quem constrói, desde que a regra valha no banco para os dois.
- **Eventos do Asaas** guardados para idempotência e auditoria.
- Dinheiro sempre em **centavos inteiros**.
- O isolamento por `arena_id` continua em tudo que é da arena. Jogador e reserva atravessam arenas só pelo lado do jogador ("Minhas reservas" lista reservas de várias arenas, e só as dele).

## Restrições

- Stack atual: Next.js na Vercel, Postgres no Supabase, R2, CSS próprio com a identidade Strukti, **sem Tailwind e sem libs de UI novas**. Leaflet é a única dependência nova prevista, mais o cliente HTTP do Asaas, se necessário.
- pt-BR, WCAG AA, alvos de toque de 48 px, funciona no celular primeiro.
- Páginas públicas funcionam sem JavaScript sempre que possível (busca, página da arena, confirmação). Pagamento com cartão pode exigir JavaScript.
- TDD, revisão a cada tarefa, push e deploy com o ok do dono, como no CLAUDE.md.
- Segredos do Asaas (chave da API e token do webhook) só nas variáveis de ambiente.

## Fora do escopo

- Cobrança da mensalidade do dono pelo sistema (fase 5).
- Avaliações, fotos da arena, chat, convite de amigos para a reserva, divisão do pagamento entre amigos.
- Reserva recorrente (toda terça às 19h).
- App nativo.

## Anti-objetivos (falhas mesmo que "funcione")

- Duas pessoas pagarem pelo mesmo horário.
- Reserva confirmada sem pagamento confirmado pelo Asaas, ou pagamento confirmado sem reserva nem estorno.
- O jogador ter que escolher tudo de novo depois de criar a conta.
- Um jogador ver reserva, nome ou lance de outro jogador.
- Um dono ver ou mexer em reservas, preços ou dinheiro de outra arena.

## LGPD

Agora **há dados de jogador**: nome, e-mail, CPF e histórico de reservas.
- Termos de uso e política de privacidade aceitos na criação da conta.
- CPF só para o pagamento: nunca aparece para o dono nem em logs.
- O dono vê, das reservas da arena dele, só o nome do jogador.
- O jogador apaga a própria conta em "Minha conta" (fase 1).

## Deixado para quem constrói

Nomes de tabelas e rotas, desenho das telas dentro da identidade Strukti, como a escolha viaja pelo login (desde que sobreviva a criar conta), serviço de geocodificação (Nominatim ou outro gratuito, respeitando o limite de uso), organização do código do Asaas, e textos de erro.

## Pendências

- Valor padrão da taxa da Strukti.
- Texto definitivo dos termos de uso e da política de privacidade.
- Domínio e DNS para o remetente dos e-mails (SPF/DKIM) e conta no serviço de envio.
- Confirmar na documentação do Asaas: split com subconta, exigência de CPF, página de pagamento hospedada e estorno com split.
- Conta Asaas da Strukti e subcontas das arenas (abertura e verificação).
- Trocar a senha do banco do Supabase antes de ter dados reais.
