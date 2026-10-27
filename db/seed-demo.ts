import { randomBytes } from "node:crypto";
import { emTransacao, type Db } from "../app/lib/db";
import { arenaDoSlug } from "../app/lib/arena-slug";
import { atualizarArenaDono, type EnderecoArena } from "../app/lib/arena-dono";
import { diaDaSemana, hojeLocal, instanteDoMinuto } from "../app/lib/disponibilidade";
import { criarArenaComDono } from "../app/lib/donos";
import type { Coordenadas } from "../app/lib/geocodificar";
import { criarHorarios } from "../app/lib/horarios-quadra";
import { gerarFixos, type Horario } from "../app/lib/horarios";
import { criarContaJogador } from "../app/lib/jogadores";
import { cadastrarCamera, criarBotao, criarQuadra, definirEsporteQuadra, listarQuadras } from "../app/lib/painel";
import {
  MSG_LIMITE_RESERVAS, bloquearHorarios, cancelarPeloDono, cancelarPeloJogador, criarReserva, periodosOcupados,
} from "../app/lib/reservas";

// Arenas de demonstração, só para banco local: os prints da página de vendas do
// replay (spec 2026-10-26-pagina-replay-design.md, Q9/Q16) e os testes manuais
// saem delas. Nomes fictícios óbvios e e-mails em .invalid (nunca entregáveis).
// Usa as mesmas funções do /admin, do painel e do site (reserva, cancelamento,
// bloqueio); SQL direto só para achar o que já existe e para o slug fixo.
// Nenhum lance: sem câmera de verdade e sem R2 não existe vídeo.

// O check de arenas.slug (0008) e o SLUG_VALIDO pedem de 20 a 64 caracteres:
// "arena-exemplo" sozinho não passa.
const SLUG = "arena-exemplo-demonstracao";
const EMAIL_JOGADOR = "jogador@exemplo.invalid";
const NOME_JOGADOR = "Jogador Exemplo";

const H = 60;
const MINUTO = 60_000;
const DIA_MS = 86_400_000;

type QuadraDemo = { nome: string; esporte: string; horarios: Horario[] };
type ArenaDemo = {
  slug: string;
  nome: string;
  emailDono: string;
  endereco: EnderecoArena;
  coordenadas: Coordenadas;
  quadras: QuadraDemo[];
};

const TODOS = [0, 1, 2, 3, 4, 5, 6];
const DIAS_UTEIS = [1, 2, 3, 4, 5];
const FIM_DE_SEMANA = [0, 6];

// Horários fixos de `duracao` minutos, de `das` a `ate` (minutos), nos dias da semana dados.
const fixos = (dias: number[], das: number, ate: number, duracao: number, precoCentavos: number): Horario[] =>
  dias.flatMap((diaSemana) => gerarFixos({ diaSemana, das, ate, duracao, precoCentavos }));

// Endereços fictícios ("Rua do Exemplo"); as coordenadas são de parques públicos
// de São Paulo e entram sem consultar o Nominatim.
const ARENA_EXEMPLO: ArenaDemo = {
  slug: SLUG,
  nome: "Arena Exemplo",
  emailDono: "dono@exemplo.invalid",
  endereco: { rua: "Rua do Exemplo", numero: "100", bairro: "Ibirapuera", cidade: "São Paulo", uf: "SP", cep: "04094000" },
  coordenadas: { latitude: -23.5874, longitude: -46.6576 }, // Parque Ibirapuera
  quadras: [
    { nome: "Quadra 1 — Society", esporte: "", horarios: fixos(TODOS, 17 * H, 23 * H, H, 12_000) },
    { nome: "Quadra 2 — Areia", esporte: "", horarios: fixos(TODOS, 17 * H, 23 * H, H, 9_000) },
  ],
};

// Mais duas, sem câmera, só para a busca, o filtro de esporte e o mapa da home
// mostrarem mais de uma arena (sem reservas). Os donos têm senha aleatória e
// descartada: ninguém entra com essas contas.
const BEACH = [...fixos(DIAS_UTEIS, 17 * H, 22 * H, H, 8_000), ...fixos(FIM_DE_SEMANA, 8 * H, 12 * H, H, 10_000)];
const PADEL = [...fixos(TODOS, 18 * H, 22 * H + 30, 90, 15_000), ...fixos(FIM_DE_SEMANA, 9 * H, 12 * H, 90, 13_000)];
const OUTRAS_ARENAS: ArenaDemo[] = [
  {
    slug: "arena-exemplo-beach-demonstracao",
    nome: "Arena Exemplo Beach",
    emailDono: "dono.beach@exemplo.invalid",
    endereco: { rua: "Rua do Exemplo", numero: "300", bairro: "Aclimação", cidade: "São Paulo", uf: "SP", cep: "01531000" },
    coordenadas: { latitude: -23.5728, longitude: -46.6297 }, // Parque da Aclimação
    quadras: [
      { nome: "Quadra A", esporte: "Beach tennis", horarios: BEACH },
      { nome: "Quadra B", esporte: "Vôlei de praia", horarios: BEACH },
    ],
  },
  {
    slug: "arena-exemplo-padel-demonstracao",
    nome: "Arena Exemplo Padel",
    emailDono: "dono.padel@exemplo.invalid",
    endereco: {
      rua: "Avenida do Exemplo", numero: "1500", bairro: "Alto de Pinheiros", cidade: "São Paulo", uf: "SP", cep: "05459000",
    },
    coordenadas: { latitude: -23.5466, longitude: -46.7226 }, // Parque Villa-Lobos
    quadras: [
      { nome: "Quadra 1", esporte: "Padel", horarios: PADEL },
      { nome: "Quadra 2", esporte: "Padel", horarios: PADEL },
    ],
  },
];

// Os slugs fixos que a segunda guarda do CLI aceita.
export const SLUGS_DEMO: readonly string[] = [SLUG, ...OUTRAS_ARENAS.map((a) => a.slug)];

// Credenciais de mentira: a câmera só grava depois que a Strukti troca o SN e
// as credenciais pelos da câmera de verdade.
const CAMERA = { nome: "Câmera 1", sn: "DEMO-0001", authcode: "demo", local_user: "demo", local_pwd: "demo" };

// Jogadores fictícios da agenda da Arena Exemplo, com senha aleatória e
// descartada (não vai para o .env.local nem para a tela). São 16 porque o app
// limita cada jogador a LIMITE_RESERVAS_POR_ARENA (2) reservas futuras por
// arena, e a agenda tem até 30 ao mesmo tempo (24 nos próximos 14 dias e até
// 6 hoje): 32 vagas, com folga.
const JOGADORES: [nome: string, email: string][] = [
  ["Ana Exemplo", "ana@exemplo.invalid"],
  ["Bruno Exemplo", "bruno@exemplo.invalid"],
  ["Carla Exemplo", "carla@exemplo.invalid"],
  ["Diego Exemplo", "diego@exemplo.invalid"],
  ["Elisa Exemplo", "elisa@exemplo.invalid"],
  ["Fábio Exemplo", "fabio@exemplo.invalid"],
  ["Gabriela Exemplo", "gabriela@exemplo.invalid"],
  ["Hugo Exemplo", "hugo@exemplo.invalid"],
  ["Isabela Exemplo", "isabela@exemplo.invalid"],
  ["João Exemplo", "joao@exemplo.invalid"],
  ["Karina Exemplo", "karina@exemplo.invalid"],
  ["Lucas Exemplo", "lucas@exemplo.invalid"],
  ["Marina Exemplo", "marina@exemplo.invalid"],
  ["Nícolas Exemplo", "nicolas@exemplo.invalid"],
  ["Olívia Exemplo", "olivia@exemplo.invalid"],
  ["Paulo Exemplo", "paulo@exemplo.invalid"],
];

// ---------- Agenda da Arena Exemplo ----------

const DIAS_HISTORICO = 30; // o painel mostra 30 dias para trás
const DIAS_A_FRENTE = 14;
const DAS = 17; // horários da Arena Exemplo: das 17h às 23h
const ATE = 23;
const HORA_RESERVA = 20; // jogador principal, Quadra 1

type Item = { quadra: number; hora: number; qtd: number };
const item = (quadra: number, hora: number, qtd = 1): Item => ({ quadra, hora, qtd });

// Reservas dos jogadores fictícios por dia da semana (0 = domingo), as mesmas
// no histórico e nos próximos dias (quadra 0 = Quadra 1, 1 = Quadra 2; qtd =
// horários seguidos). Ficam de fora: a Quadra 1 às 20h e a Quadra 2 às 21h
// (do jogador principal), a Quadra 2 às 18h de terça e quinta (aula) e a
// Quadra 1 das 17h às 19h de quarta (manutenção).
const SEMANA: Item[][] = [
  [item(0, 18, 2), item(1, 17)], // domingo
  [item(0, 21)], // segunda
  [item(1, 19)], // terça
  [item(0, 21, 2), item(1, 20)], // quarta
  [item(0, 19), item(1, 19, 2)], // quinta
  [item(0, 18, 2), item(1, 20)], // sexta
  [item(0, 21), item(1, 17, 2)], // sábado
];

// Hoje, cada quadra fica com 4 dos 6 horários ocupados (contando o jogador
// principal e os bloqueios), completando a agenda do dia com estes, em ordem:
// sobram horários livres para a busca e a página da arena. Em dia de
// manutenção a Quadra 1 já chega a 5 sem eles (ainda sobra um livre).
const OCUPADOS_HOJE = 4;
const EXTRAS_DE_HOJE: Item[][] = [
  [item(0, 17), item(0, 22), item(0, 18, 2), item(0, 19), item(0, 18), item(0, 21)],
  [item(1, 17, 2), item(1, 21), item(1, 19), item(1, 20), item(1, 22), item(1, 17), item(1, 18)],
];

// Histórico: a primeira reserva de alguns dias (pelo dia do mês, então rodar
// de novo dá o mesmo) foi cancelada, pelo jogador ou pela arena, com motivo.
const MOTIVO_DA_ARENA = ["Manutenção da iluminação", "Chuva forte"];
function cancelamento(dia: string): "jogador" | "dono" | null {
  const n = Number(dia.slice(8)) % 9;
  return n === 2 ? "jogador" : n === 6 ? "dono" : null;
}

// Bloqueios do dono (pela função do painel), de hoje até o 14º dia: a aula
// toda terça e quinta na quadra de areia e a manutenção do piso da Quadra 1
// quarta sim, quarta não (as quartas a um múltiplo de 14 dias da referência:
// sempre cai uma nos próximos 14 dias).
const AULA = { quadra: 1, hora: 18, diasSemana: [2, 4], motivo: "Aula de beach tennis" };
const MANUTENCAO = { quadra: 0, das: 17, ate: 19, referencia: "2026-11-11", motivo: "Manutenção do piso" };

export type ChaveSegredo = "DEMO_DONO_SENHA" | "DEMO_JOGADOR_SENHA" | "DEMO_BOTAO_TOKEN";
// Só o que foi criado nesta rodada. O CLI grava no .env.local; nunca imprimir.
export type SegredosDemo = Partial<Record<ChaveSegredo, string>>;
export type ResultadoDemo = { arenaSlug: string; outrasArenas: string[]; segredos: SegredosDemo };

const senhaNova = () => randomBytes(18).toString("base64url");

const emUtc = (dia: string) => {
  const [a, m, d] = dia.split("-").map(Number);
  return Date.UTC(a, m - 1, d);
};
const somaDias = (dia: string, n: number) => new Date(emUtc(dia) + n * DIA_MS).toISOString().slice(0, 10);
const diasEntre = (de: string, ate: string) => Math.round((emUtc(ate) - emUtc(de)) / DIA_MS);

const chave = (quadraId: string, inicio: number) => `${quadraId}|${inicio}`;

// Arena e dono (já com o slug fixo, numa transação só), endereço, quadras
// (com esporte, se a quadra ainda não tem) e horários; o que já existe fica.
// `aoCriarDono` recebe a senha do dono só se ele foi criado agora.
async function semearArena(
  db: Db, a: ArenaDemo, aoCriarDono?: (senha: string) => void,
): Promise<{ arenaId: string; quadras: string[] }> {
  let arenaId = (await arenaDoSlug(db, a.slug))?.arenaId;
  if (!arenaId) {
    const senha = senhaNova();
    arenaId = await emTransacao(db, async (tx) => {
      const r = await criarArenaComDono(tx, { arena: a.nome, email: a.emailDono, senha });
      await tx.query("update arenas set slug = $2 where id = $1", [r.arenaId, a.slug]);
      return r.arenaId;
    });
    aoCriarDono?.(senha);
  }

  const end = await atualizarArenaDono(db, arenaId, { nome: a.nome, endereco: a.endereco }, async () => a.coordenadas);
  if (!end.ok) throw new Error(`endereço da demonstração recusado: ${end.erro}`);

  // Quadras e horários (os que já existem chocam e são pulados).
  const existentes = await listarQuadras(db, arenaId);
  const quadras: string[] = [];
  for (const q of a.quadras) {
    const atual = existentes.find((x) => x.nome === q.nome);
    const id = atual?.id ?? (await criarQuadra(db, arenaId, q.nome)).id;
    if (q.esporte && !atual?.esporte) await definirEsporteQuadra(db, arenaId, id, q.esporte);
    const h = await criarHorarios(db, arenaId, id, q.horarios);
    if (!h.ok) throw new Error(`horários da demonstração recusados: ${h.erro}`);
    quadras.push(id);
  }
  return { arenaId, quadras };
}

// Conta de jogador pelo e-mail (único na plataforma inteira). `aoCriar`
// recebe a senha só se a conta foi criada agora.
async function contaDeJogador(
  db: Db, nome: string, email: string, aoCriar?: (senha: string) => void,
): Promise<string> {
  const atual = (await db.query<{ id: string }>("select id from jogadores where email = $1", [email])).rows[0]?.id;
  if (atual) return atual;
  const senha = senhaNova();
  const j = await criarContaJogador(db, { nome, email, senha, aceitouTermos: true });
  if (!j.ok) throw new Error(`conta de jogador da demonstração recusada: ${j.erro}`);
  aoCriar?.(senha);
  return j.jogadorId;
}

type Agenda = { arenaId: string; quadras: string[]; agora: Date; dia: string };

// Jogador principal, em horários que a agenda dos fictícios não usa: duas
// jogadas no histórico, a de hoje e uma futura na Quadra 1 às 20h, e uma
// cancelada por ele na Quadra 2 às 21h (num horário próprio, para o dia dela
// não ganhar outra reserva dele no mesmo lugar). Cada uma só se ainda não tem;
// a ordem respeita o limite de reservas futuras do app.
async function agendaDoPrincipal(db: Db, a: Agenda, jogadorId: string): Promise<void> {
  const { arenaId, agora, dia } = a;
  const inicio = HORA_RESERVA * 60;
  const reservar = (d: string, feitaEm: Date, quadraId = a.quadras[0], minuto = inicio) =>
    criarReserva(db, jogadorId, { quadraId, dia: d, inicio: minuto, qtd: 1 }, feitaEm);
  const tem = async (condicao: string, params: unknown[] = []) =>
    (await db.query(
      `select 1 from reservas
        where jogador_id = $1 and arena_id = $2 and tipo = 'reserva' and ${condicao}
        limit 1`,
      [jogadorId, arenaId, ...params],
    )).rows.length > 0;

  // Histórico: duas jogadas, feitas um minuto antes, da mais antiga para a mais nova.
  if (!(await tem("situacao = 'confirmada' and inicio < $3", [new Date(instanteDoMinuto(dia, 0))]))) {
    for (const n of [-11, -4]) {
      const d = somaDias(dia, n);
      await reservar(d, new Date(instanteDoMinuto(d, inicio) - MINUTO));
    }
  }

  // Uma cancelada por ele, daqui a uns dias (mais de 24 h antes do jogo).
  if (!(await tem("situacao = 'cancelada'"))) {
    for (let n = 5; n <= 9; n++) {
      const r = await reservar(somaDias(dia, n), agora, a.quadras[1], (HORA_RESERVA + 1) * 60);
      if (r.ok) await cancelarPeloJogador(db, jogadorId, r.reservaId, agora);
      if (r.ok || r.erro === MSG_LIMITE_RESERVAS) break;
    }
  }

  // Uma reserva de hoje às 20:00, pelo caminho do site ("pagar na arena",
  // confirmada na hora). criarReserva só aceita horário que ainda não começou:
  // rodando depois das 20h, a reserva conta como feita às 19:59. Só a
  // confirmada de hoje conta: a de outro dia ou a cancelada não impede a
  // reserva do dia dos prints.
  if (!(await tem("situacao = 'confirmada' and inicio = $3", [new Date(instanteDoMinuto(dia, inicio))]))) {
    const feitaEm = new Date(Math.min(agora.getTime(), instanteDoMinuto(dia, inicio) - MINUTO));
    const r = await reservar(dia, feitaEm);
    if (!r.ok) throw new Error(`reserva da demonstração recusada: ${r.erro}`);
  }

  // Uma futura, se ainda não tem nenhuma depois de hoje.
  if (!(await tem("situacao = 'confirmada' and inicio >= $3", [new Date(instanteDoMinuto(somaDias(dia, 1), 0))]))) {
    for (let n = 3; n <= 9; n++) {
      const r = await reservar(somaDias(dia, n), agora);
      if (r.ok || r.erro === MSG_LIMITE_RESERVAS) break;
    }
  }
}

// Horas (17 a 22) da quadra com reserva ou bloqueio que ocupa no dia.
async function horasOcupadas(db: Db, arenaId: string, quadraId: string, dia: string): Promise<Set<number>> {
  const periodos = await periodosOcupados(db, arenaId, quadraId, dia);
  const horas = new Set<number>();
  for (let h = DAS; h < ATE; h++) {
    const de = instanteDoMinuto(dia, h * 60);
    const ate = instanteDoMinuto(dia, (h + 1) * 60);
    if (periodos.some((p) => p.inicio.getTime() < ate && p.fim.getTime() > de)) horas.add(h);
  }
  return horas;
}

// Agenda dos jogadores fictícios e bloqueios do dono, de 30 dias atrás até 14
// dias à frente. Um horário (quadra e início) que já tem qualquer linha, de
// qualquer situação, não é criado de novo: rodar outra vez no mesmo dia não
// cria nada, e em outro dia só completa o que falta.
async function agendaDosOutros(db: Db, a: Agenda, jogadores: string[]): Promise<void> {
  const { arenaId, quadras, agora, dia } = a;
  const existentes = new Set(
    (await db.query<{ quadra_id: string; inicio: Date }>(
      "select quadra_id, inicio from reservas where arena_id = $1 and inicio >= $2 and inicio < $3",
      [
        arenaId,
        new Date(instanteDoMinuto(somaDias(dia, -DIAS_HISTORICO), 0)),
        new Date(instanteDoMinuto(somaDias(dia, DIAS_A_FRENTE + 1), 0)),
      ],
    )).rows.map((r) => chave(r.quadra_id, new Date(r.inicio).getTime())),
  );

  // Cada reserva vai para o próximo jogador da roda que ainda cabe no limite
  // de reservas futuras do app. Passada (ou de hoje que já começou): feita um
  // minuto antes; a que vai ser cancelada, três dias antes; futura, agora.
  let vez = 0;
  const reservar = async (d: string, it: Item, cancelar: "jogador" | "dono" | null = null): Promise<boolean> => {
    const quadraId = quadras[it.quadra];
    const inicio = instanteDoMinuto(d, it.hora * 60);
    if (existentes.has(chave(quadraId, inicio))) return false;
    const feitaEm = new Date(cancelar ? inicio - 3 * DIA_MS : Math.min(agora.getTime(), inicio - MINUTO));
    const primeiro = vez++;
    for (let i = 0; i < jogadores.length; i++) {
      const jogadorId = jogadores[(primeiro + i) % jogadores.length];
      const r = await criarReserva(db, jogadorId, { quadraId, dia: d, inicio: it.hora * 60, qtd: it.qtd }, feitaEm);
      if (!r.ok && r.erro === MSG_LIMITE_RESERVAS) continue;
      // Horário tomado (por exemplo, por uma reserva feita no app): pula.
      if (!r.ok) return false;
      existentes.add(chave(quadraId, inicio));
      if (cancelar === "jogador") await cancelarPeloJogador(db, jogadorId, r.reservaId, new Date(inicio - 2 * DIA_MS));
      if (cancelar === "dono") {
        await cancelarPeloDono(db, arenaId, r.reservaId, MOTIVO_DA_ARENA[it.quadra], new Date(inicio - DIA_MS));
      }
      return true;
    }
    return false;
  };

  // 1. Histórico, do dia mais antigo para o mais novo (antes das futuras, que
  //    contariam no limite de quem reservou no passado).
  for (let n = DIAS_HISTORICO; n >= 1; n--) {
    const d = somaDias(dia, -n);
    for (const [i, it] of SEMANA[diaDaSemana(d)].entries()) await reservar(d, it, i === 0 ? cancelamento(d) : null);
  }

  // 2. A agenda de hoje.
  for (const it of SEMANA[diaDaSemana(dia)]) await reservar(dia, it);

  // 3. Bloqueios (aula e manutenção), de hoje até o 14º dia. Horário que já
  //    começou ou está ocupado, a função do painel pula.
  const bloquear = async (d: string, quadra: number, das: number, ate: number, motivo: string) => {
    const quadraId = quadras[quadra];
    if (existentes.has(chave(quadraId, instanteDoMinuto(d, das * 60)))) return;
    const horarios = Array.from({ length: ate - das }, (_, i) => ({ inicio: (das + i) * 60, fim: (das + i + 1) * 60 }));
    const r = await bloquearHorarios(db, arenaId, { quadraId, dia: d, horarios, motivo }, agora);
    if (!r.ok) throw new Error(`bloqueio da demonstração recusado: ${r.erro}`);
  };
  for (let n = 0; n <= DIAS_A_FRENTE; n++) {
    const d = somaDias(dia, n);
    if (AULA.diasSemana.includes(diaDaSemana(d))) await bloquear(d, AULA.quadra, AULA.hora, AULA.hora + 1, AULA.motivo);
    if ((((diasEntre(MANUTENCAO.referencia, d) % 14) + 14) % 14) === 0) {
      await bloquear(d, MANUTENCAO.quadra, MANUTENCAO.das, MANUTENCAO.ate, MANUTENCAO.motivo);
    }
  }

  // 4. O resto de hoje, até cada quadra ter OCUPADOS_HOJE horários ocupados.
  for (const [q, extras] of EXTRAS_DE_HOJE.entries()) {
    const ocupadas = await horasOcupadas(db, arenaId, quadras[q], dia);
    for (const it of extras) {
      const horas = Array.from({ length: it.qtd }, (_, i) => it.hora + i);
      if (ocupadas.size + it.qtd > OCUPADOS_HOJE || horas.some((h) => ocupadas.has(h))) continue;
      if (await reservar(dia, it)) horas.forEach((h) => ocupadas.add(h));
    }
  }

  // 5. Os próximos 14 dias.
  for (let n = 1; n <= DIAS_A_FRENTE; n++) {
    const d = somaDias(dia, n);
    for (const it of SEMANA[diaDaSemana(d)]) await reservar(d, it);
  }
}

// Idempotente: cada passo procura o que já existe (a arena pelo slug, a conta
// pelo e-mail, a reserva pelo horário) antes de criar, então rodar de novo, ou
// depois de uma rodada interrompida, completa o que falta sem duplicar; em
// outro dia, a agenda anda junto com o "agora". `segredos`, se vier, é
// preenchido a cada conta ou botão criado: mesmo que um passo seguinte lance, o
// chamador ainda tem o que foi criado antes (uma segunda rodada não recria nem
// devolve esses segredos).
export async function semearDemo(
  db: Db,
  opcoes: { agora?: Date; chave?: Buffer; segredos?: SegredosDemo } = {},
): Promise<ResultadoDemo> {
  const agora = opcoes.agora ?? new Date();
  const segredos = opcoes.segredos ?? {};

  const { arenaId, quadras } = await semearArena(db, ARENA_EXEMPLO, (senha) => {
    segredos.DEMO_DONO_SENHA = senha;
  });

  // Câmera e botão na Quadra 1.
  const quadra1 = quadras[0];
  const q1 = (await listarQuadras(db, arenaId)).find((x) => x.id === quadra1);
  if (!q1?.camera) {
    const c = await cadastrarCamera(db, opcoes.chave ?? randomBytes(32), arenaId, quadra1, CAMERA);
    if (!c) throw new Error("quadra da demonstração não encontrada");
  }
  if (!q1 || q1.botoesAtivos === 0) {
    const b = await criarBotao(db, arenaId, quadra1);
    if (!b) throw new Error("quadra da demonstração não encontrada");
    segredos.DEMO_BOTAO_TOKEN = b.token;
  }

  // Jogador principal (guarda a senha) e os fictícios (senha descartada).
  const jogadorId = await contaDeJogador(db, NOME_JOGADOR, EMAIL_JOGADOR, (senha) => {
    segredos.DEMO_JOGADOR_SENHA = senha;
  });
  const outros: string[] = [];
  for (const [nome, email] of JOGADORES) outros.push(await contaDeJogador(db, nome, email));

  for (const a of OUTRAS_ARENAS) await semearArena(db, a);

  const agenda: Agenda = { arenaId, quadras, agora, dia: hojeLocal(agora) };
  await agendaDoPrincipal(db, agenda, jogadorId);
  await agendaDosOutros(db, agenda, outros);

  return { arenaSlug: SLUG, outrasArenas: OUTRAS_ARENAS.map((a) => a.slug), segredos };
}

const HOSTS_LOCAIS = new Set(["localhost", "127.0.0.1", "::1"]);

function hostLocal(host: string): boolean {
  try {
    return HOSTS_LOCAIS.has(decodeURIComponent(host).replace(/^\[(.+)\]$/, "$1").toLowerCase());
  } catch {
    return false;
  }
}

// true só para postgres(ql)://… em localhost, 127.0.0.1 ou ::1. O pg troca o
// host da URL pelo parâmetro ?host=, então ele também tem de ser local. Sem
// host (socket, URL vazia) ou fora do formato: false.
export function urlLocal(url: string): boolean {
  let u: URL;
  try {
    u = new URL(url);
  } catch {
    return false;
  }
  if (u.protocol !== "postgres:" && u.protocol !== "postgresql:") return false;
  return [u.hostname, ...u.searchParams.getAll("host")].every(hostLocal);
}

// Segunda guarda, já conectado: um túnel (ssh -L) ou proxy do provedor em
// localhost leva a um banco remoto e passa pela urlLocal. O banco da
// demonstração não tem arenas de verdade, então qualquer arena fora dos slugs
// fixos da demonstração faz o CLI recusar, salvo com SEED_DEMO_FORCAR=1.
export async function arenasForaDaDemo(db: Db): Promise<number> {
  const r = await db.query<{ n: number }>(
    "select count(*)::int as n from arenas where slug <> all($1::text[])",
    [[...SLUGS_DEMO]],
  );
  return Number(r.rows[0].n);
}

export function podeSemear(arenasForaDaDemo: number, forcar: string | undefined): boolean {
  return arenasForaDaDemo === 0 || forcar === "1";
}

const COMENTARIO = "# Arena de demonstração (npm run seed-demo): só no banco local.";

// Conteúdo novo do .env.local: tira as linhas antigas das chaves dadas (e o
// comentário) e põe as novas no fim, mantendo o resto e a quebra de linha do
// arquivo. Sem segredos, devolve o conteúdo como está.
export function comSegredosNoEnv(conteudo: string, segredos: Partial<Record<string, string>>): string {
  const pares = Object.entries(segredos).filter((p): p is [string, string] => typeof p[1] === "string");
  if (pares.length === 0) return conteudo;
  const eol = conteudo.includes("\r\n") ? "\r\n" : "\n";
  const linhas = conteudo === "" ? [] : conteudo.split(/\r?\n/);
  if (linhas.at(-1) === "") linhas.pop();
  const chaves = new Set(pares.map(([k]) => k));
  const mantidas = linhas.filter((l) => {
    if (l.trim() === COMENTARIO) return false;
    const m = /^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=/.exec(l);
    return !(m && chaves.has(m[1]));
  });
  return [...mantidas, COMENTARIO, ...pares.map(([k, v]) => `${k}=${v}`)].join(eol) + eol;
}
