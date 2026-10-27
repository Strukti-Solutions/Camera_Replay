import { randomBytes } from "node:crypto";
import { emTransacao, type Db } from "../app/lib/db";
import { arenaDoSlug } from "../app/lib/arena-slug";
import { atualizarArenaDono, type EnderecoArena } from "../app/lib/arena-dono";
import { hojeLocal, instanteDoMinuto } from "../app/lib/disponibilidade";
import { criarArenaComDono } from "../app/lib/donos";
import type { Coordenadas } from "../app/lib/geocodificar";
import { criarHorarios } from "../app/lib/horarios-quadra";
import type { Horario } from "../app/lib/horarios";
import { criarContaJogador } from "../app/lib/jogadores";
import { cadastrarCamera, criarBotao, criarQuadra, listarQuadras } from "../app/lib/painel";
import { criarReserva } from "../app/lib/reservas";

// Arena de demonstração, só para banco local: os prints da página de vendas do
// replay (spec 2026-10-26-pagina-replay-design.md, Q9/Q16) saem dela. Nomes
// fictícios óbvios e e-mails em .invalid (nunca entregáveis). Usa as mesmas
// funções do /admin e do painel; SQL direto só para achar o que já existe e
// para o slug fixo.

// O check de arenas.slug (0008) e o SLUG_VALIDO pedem de 20 a 64 caracteres:
// "arena-exemplo" sozinho não passa.
const SLUG = "arena-exemplo-demonstracao";
const NOME_ARENA = "Arena Exemplo";
const EMAIL_DONO = "dono@exemplo.invalid";
const EMAIL_JOGADOR = "jogador@exemplo.invalid";
const NOME_JOGADOR = "Jogador Exemplo";

// Endereço fictício; as coordenadas (Parque Ibirapuera, área pública) entram
// sem consultar o Nominatim.
const ENDERECO: EnderecoArena = {
  rua: "Rua do Exemplo", numero: "100", bairro: "Ibirapuera", cidade: "São Paulo", uf: "SP", cep: "04094000",
};
const COORDENADAS: Coordenadas = { latitude: -23.5874, longitude: -46.6576 };

const QUADRAS = [
  { nome: "Quadra 1 — Society", precoCentavos: 12_000 },
  { nome: "Quadra 2 — Areia", precoCentavos: 9_000 },
];
const DIAS = [0, 1, 2, 3, 4, 5, 6];
const DAS = 17;
const ATE = 23;
const HORA_RESERVA = 20;

// Credenciais de mentira: a câmera só grava depois que a Strukti troca o SN e
// as credenciais pelos da câmera de verdade.
const CAMERA = { nome: "Câmera 1", sn: "DEMO-0001", authcode: "demo", local_user: "demo", local_pwd: "demo" };

export type ChaveSegredo = "DEMO_DONO_SENHA" | "DEMO_JOGADOR_SENHA" | "DEMO_BOTAO_TOKEN";
// Só o que foi criado nesta rodada. O CLI grava no .env.local; nunca imprimir.
export type SegredosDemo = Partial<Record<ChaveSegredo, string>>;
export type ResultadoDemo = { arenaSlug: string; segredos: SegredosDemo };

const senhaNova = () => randomBytes(18).toString("base64url");

const horariosDaQuadra = (precoCentavos: number): Horario[] =>
  DIAS.flatMap((diaSemana) =>
    Array.from({ length: ATE - DAS }, (_, i) => ({
      diaSemana, inicio: (DAS + i) * 60, fim: (DAS + i + 1) * 60, precoCentavos,
    })),
  );

// Idempotente: cada passo procura o que já existe (a arena pelo slug) antes de
// criar, então rodar de novo, ou depois de uma rodada interrompida, completa o
// que falta sem duplicar. `segredos`, se vier, é preenchido a cada conta ou
// botão criado: mesmo que um passo seguinte lance, o chamador ainda tem o que
// foi criado antes (uma segunda rodada não recria nem devolve esses segredos).
export async function semearDemo(
  db: Db,
  opcoes: { agora?: Date; chave?: Buffer; segredos?: SegredosDemo } = {},
): Promise<ResultadoDemo> {
  const agora = opcoes.agora ?? new Date();
  const segredos = opcoes.segredos ?? {};

  // Arena e dono, já com o slug fixo, numa transação só.
  let arenaId = (await arenaDoSlug(db, SLUG))?.arenaId;
  if (!arenaId) {
    const senha = senhaNova();
    arenaId = await emTransacao(db, async (tx) => {
      const r = await criarArenaComDono(tx, { arena: NOME_ARENA, email: EMAIL_DONO, senha });
      await tx.query("update arenas set slug = $2 where id = $1", [r.arenaId, SLUG]);
      return r.arenaId;
    });
    segredos.DEMO_DONO_SENHA = senha;
  }

  const end = await atualizarArenaDono(
    db, arenaId, { nome: NOME_ARENA, endereco: ENDERECO }, async () => COORDENADAS,
  );
  if (!end.ok) throw new Error(`endereço da demonstração recusado: ${end.erro}`);

  // Quadras e horários (os que já existem chocam e são pulados).
  const existentes = await listarQuadras(db, arenaId);
  const ids: string[] = [];
  for (const q of QUADRAS) {
    const id = existentes.find((x) => x.nome === q.nome)?.id ?? (await criarQuadra(db, arenaId, q.nome)).id;
    const h = await criarHorarios(db, arenaId, id, horariosDaQuadra(q.precoCentavos));
    if (!h.ok) throw new Error(`horários da demonstração recusados: ${h.erro}`);
    ids.push(id);
  }

  // Câmera e botão na Quadra 1.
  const quadra1 = ids[0];
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

  // Jogador (e-mail único na plataforma inteira).
  let jogadorId = (await db.query<{ id: string }>("select id from jogadores where email = $1", [EMAIL_JOGADOR]))
    .rows[0]?.id;
  if (!jogadorId) {
    const senha = senhaNova();
    const j = await criarContaJogador(db, { nome: NOME_JOGADOR, email: EMAIL_JOGADOR, senha, aceitouTermos: true });
    if (!j.ok) throw new Error(`conta do jogador da demonstração recusada: ${j.erro}`);
    jogadorId = j.jogadorId;
    segredos.DEMO_JOGADOR_SENHA = senha;
  }

  // Uma reserva de hoje às 20:00 na Quadra 1, pelo caminho do site ("pagar na
  // arena", confirmada na hora). criarReserva só aceita horário que ainda não
  // começou: rodando depois das 20h, a reserva conta como feita às 19:59.
  const temReserva = await db.query(
    "select 1 from reservas where jogador_id = $1 and arena_id = $2 and tipo = 'reserva' limit 1",
    [jogadorId, arenaId],
  );
  if (temReserva.rows.length === 0) {
    const dia = hojeLocal(agora);
    const inicio = HORA_RESERVA * 60;
    const feitaEm = new Date(Math.min(agora.getTime(), instanteDoMinuto(dia, inicio) - 60_000));
    const r = await criarReserva(db, jogadorId, { quadraId: quadra1, dia, inicio, qtd: 1 }, feitaEm);
    if (!r.ok) throw new Error(`reserva da demonstração recusada: ${r.erro}`);
  }

  return { arenaSlug: SLUG, segredos };
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
