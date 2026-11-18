# Camera_Replay

SaaS de replay para quadras: o jogador aperta um botão e recebe os últimos 30 s da câmera.

- Spec: `docs/superpowers/specs/2026-10-16-replay-saas-design.md`
- Planos: `docs/superpowers/plans/`
- `worker/`: worker de captura (Python). Testes: `cd worker && py -m pytest`.

## Worker de captura

Roda 24 h: lê as câmeras do banco, mantém o anel de vídeo de cada uma e corta os clipes pedidos pela fila do Postgres, enviando o mp4 ao R2.

Variáveis de ambiente (obrigatórias): `DATABASE_URL`, `R2_ACCOUNT_ID`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`, `R2_BUCKET`, `CAMERA_CRED_KEY`. Opcionais: `RELAY_LAG_S` (padrão `0`) e `WORKER_POLL_S` (padrão `1`). Se faltar alguma obrigatória, o worker imprime só os nomes e sai com código 2.

Local (precisa de `ffmpeg` no PATH):

```bash
cd worker
py -m pip install "psycopg[binary]==3.3.6" "cryptography==50.0.2"
# defina as variáveis acima no ambiente e rode:
py -m replay_worker.main
```

Docker:

```bash
docker build -t replay-worker worker/
docker run --rm --env-file worker/.env replay-worker
```

O `.env` não vai para o git nem para a imagem. Sem variáveis, o contêiner sai com a lista do que falta.

## App

Site do jogador, painel do dono e API do botão (Next.js). Requer Node 24.

Variáveis de ambiente: `DATABASE_URL`, `R2_ACCOUNT_ID`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`, `R2_BUCKET`, `CAMERA_CRED_KEY`, `CRON_SECRET` e `APP_URL` (URL pública do site, sem barra no fim; usada no QR).

**CORS do bucket do R2 (obrigatório para o "Compartilhar").** O botão "Compartilhar" do lance baixa o `.mp4` com `fetch()` no navegador, pela URL assinada, que é de outra origem (`https://<R2_ACCOUNT_ID>.r2.cloudflarestorage.com`). Sem uma regra de CORS no bucket, o navegador bloqueia a leitura e o botão sempre termina em "Não deu para compartilhar". O "Baixar vídeo", o player e a capa não dependem disso. A correção é no bucket, não no código. No painel da Cloudflare (R2 → o bucket → Settings → CORS Policy):

```json
[
  {
    "AllowedOrigins": ["<APP_URL>", "http://localhost:3000"],
    "AllowedMethods": ["GET"],
    "MaxAgeSeconds": 3600
  }
]
```

Para conferir: copie o link do "Baixar vídeo" de um lance (vale 15 minutos) e rode `curl -s -o /dev/null -D - -H "Origin: <APP_URL>" "<link>"`. A resposta tem de trazer `Access-Control-Allow-Origin` com essa origem. No celular pela rede local (`next dev -H 0.0.0.0`), `http://<ip>:3000` não é contexto seguro e o navegador esconde o "Compartilhar": use HTTPS ou, no Chrome do Android, `chrome://flags/#unsafely-treat-insecure-origin-as-secure` com essa origem, e ponha a mesma origem em `AllowedOrigins`.

```bash
npm install
npm run migrar                                   # aplica db/migrations em DATABASE_URL
npm run criar-dono -- --arena "Arena Sol" --email dono@exemplo.com   # lê a senha (mín. 10 caracteres) do terminal, sem eco
npm run dev                                      # http://localhost:3000
```

Para automatizar, a senha pode vir pelo stdin (uma linha). Nem `migrar` nem `criar-dono` imprimem a `DATABASE_URL` ou a senha.

Arenas de demonstração (para prints e testes manuais, só em banco local): `npm run seed-demo` lê o `.env.local` (sem sobrescrever o ambiente), recusa `DATABASE_URL` fora de `localhost`/`127.0.0.1`/`::1`, recusa também, já conectado, um banco que tenha qualquer arena fora dos slugs fixos da demonstração (se o banco é mesmo local e já tem arenas de teste, rode com `SEED_DEMO_FORCAR=1`) e monta:

- a "Arena Exemplo" em `/a/arena-exemplo-demonstracao`: 2 quadras com horários das 17h às 23h (R$ 120 e R$ 90), câmera e botão na Quadra 1, dono `dono@exemplo.invalid` e jogador `jogador@exemplo.invalid`;
- a agenda dela, sempre relativa ao dia em que o seed roda (fuso de São Paulo), com 16 jogadores fictícios ("Ana Exemplo" a "Paulo Exemplo", e-mails `@exemplo.invalid`, senha aleatória descartada: ninguém entra com essas contas), todas as reservas "pagar na arena" pelas funções do app, dentro do limite de 2 reservas futuras por jogador e sem ninguém com dois jogos ao mesmo tempo: hoje, 4 dos 6 horários de cada quadra ocupados (5 na Quadra 1 em dia de manutenção; sobram livres para a busca e a página da arena); nos próximos 14 dias, 1 a 2 reservas por dia (24 ao todo, 2 ou 3 delas canceladas), algumas de 2 horas seguidas; nos últimos 30 dias, cerca de 55 reservas, umas 6 canceladas. As canceladas são pelo jogador ou pela arena (com motivo), só em dia que tem mais de uma reserva;
- bloqueios do dono com motivo: "Aula de beach tennis" na Quadra 2 toda terça e quinta às 18h e "Manutenção do piso" na Quadra 1 das 17h às 19h, quarta sim, quarta não;
- o jogador principal com a reserva de hoje às 20h na Arena Exemplo, duas jogadas e uma cancelada por ele no histórico, e uma futura na Arena Exemplo Padel às 18h (rodar em outro dia, ou depois de cancelar a de hoje, cria a reserva do dia). Ele usa 1 das 2 reservas futuras por arena em cada uma, então dá para testar uma reserva nova com `jogador@exemplo.invalid` na Arena Exemplo (ou na Beach, ou na Padel); na Arena Exemplo e na Padel, a segunda reserva nova já mostra o aviso de limite. Para começar do zero, crie uma conta em `/criar-conta`;
- mais duas arenas sem câmera e sem agenda própria (a Padel só tem a futura do jogador principal), para a busca, o filtro de esporte e o mapa mostrarem mais de um resultado: "Arena Exemplo Beach" (`/a/arena-exemplo-beach-demonstracao`, beach tennis e vôlei de praia) e "Arena Exemplo Padel" (`/a/arena-exemplo-padel-demonstracao`, horários de 1h30). Os endereços das três são fictícios ("Rua do Exemplo", CEP `00000-xxx`), com coordenadas de parques públicos de São Paulo (sem consultar a rede).

Nenhum lance é criado (sem câmera de verdade e sem R2 não existe vídeo). As senhas do dono da Arena Exemplo e do jogador principal e o token do botão criados vão só para o `.env.local` (`DEMO_DONO_SENHA`, `DEMO_JOGADOR_SENHA`, `DEMO_BOTAO_TOKEN`), nunca para a tela; os donos das outras duas arenas também ficam com senha descartada. Rodar de novo no mesmo dia não cria nada; em outro dia, completa a agenda (o novo hoje, o 14º dia à frente) sem duplicar o que já existe. Os números acima são da primeira rodada. Rodando o seed todo dia, cada dia passa para o histórico com a ocupação de "hoje", então o histórico fica mais cheio (perto de 200 reservas nos últimos 30 dias depois de um mês de rodadas diárias, com as mesmas 5 ou 6 canceladas), e o jogador principal ganha uma jogada por dia. Se o seed recusar com "rode de novo daqui a um minuto", o endereço de uma arena mudou logo depois da última geocodificação: é só rodar de novo. A câmera nasce com SN e credenciais de mentira (`DEMO-0001`): para gravar um lance de verdade, troque as credenciais em `/admin` e o SN direto no banco local (o `/admin` não edita o SN). Não use com túnel ou proxy em `localhost` para um banco remoto (`ssh -L`, proxy do provedor): a guarda do host não vê a diferença, e um banco remoto com arenas só é barrado pela segunda guarda.

Jogadores: criam conta em `/criar-conta` e entram em `/entrar` (o mesmo login serve para dono e super admin). Reservas públicas virão nas próximas fases; veja `docs/superpowers/specs/2026-10-22-reservas-publicas-design.md`.

A limpeza de clipes expirados roda por cron da Vercel (`vercel.json`, diário às 07:00 UTC, 4h em Brasília), chamando `/api/cron/limpeza` com `Authorization: Bearer <CRON_SECRET>`.
