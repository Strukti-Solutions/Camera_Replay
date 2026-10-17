import { afterEach, expect, test, vi } from "vitest";
import { ErroPainel } from "../app/lib/painel";
import { mensagemDoErro, textoCamera, textoVistoHa } from "../app/painel/apresentacao";

afterEach(() => vi.restoreAllMocks());

const agora = new Date("2026-10-17T20:00:00Z");
const antes = (seg: number) => new Date(agora.getTime() - seg * 1000);

test("status da câmera na lista", () => {
  expect(textoCamera(null)).toBe("Sem câmera");
  expect(textoCamera({ online: true })).toBe("Online");
  expect(textoCamera({ online: false })).toBe("Offline");
});

test("visto há: menos de 1 min, minutos, horas e dias", () => {
  expect(textoVistoHa(null, agora)).toBe("nunca conectou");
  expect(textoVistoHa(antes(20), agora)).toBe("visto há menos de 1 min");
  expect(textoVistoHa(antes(60), agora)).toBe("visto há 1 min");
  expect(textoVistoHa(antes(59 * 60 + 59), agora)).toBe("visto há 59 min");
  expect(textoVistoHa(antes(3 * 3600 + 10), agora)).toBe("visto há 3 h");
  // Mais de um dia: data e hora em São Paulo.
  expect(textoVistoHa(new Date("2026-10-15T12:10:00Z"), agora)).toBe("visto em 15/10, 09:10");
});

test("relógio adiantado (visto no futuro) conta como agora", () => {
  expect(textoVistoHa(antes(-30), agora)).toBe("visto há menos de 1 min");
});

test("ErroPainel vira frase com maiúscula e ponto, sem log", () => {
  const log = vi.spyOn(console, "error").mockImplementation(() => {});
  expect(mensagemDoErro(new ErroPainel("quadra já tem câmera"), "x")).toBe("Quadra já tem câmera.");
  expect(log).not.toHaveBeenCalled();
});

test("outro erro vira mensagem genérica e loga só nome, código e mensagem", () => {
  const log = vi.spyOn(console, "error").mockImplementation(() => {});
  const e = Object.assign(new Error("null value in column"), {
    code: "23502",
    detail: "Failing row contains (senha-secreta)",
  });
  expect(mensagemDoErro(e, "cadastrar câmera")).toBe("Algo deu errado. Tente de novo.");
  expect(log).toHaveBeenCalledTimes(1);
  const linha = log.mock.calls[0].map(String).join(" ");
  expect(linha).toContain("cadastrar câmera");
  expect(linha).toContain("23502");
  expect(linha).not.toContain("senha-secreta");
});

test("valor lançado que não é Error também vira genérico sem eco", () => {
  const log = vi.spyOn(console, "error").mockImplementation(() => {});
  expect(mensagemDoErro("token-xyz", "criar botão")).toBe("Algo deu errado. Tente de novo.");
  expect(log.mock.calls[0].map(String).join(" ")).not.toContain("token-xyz");
});

// ---------- Reservas e alunos ----------

import { PALETA_AVATAR, corDoAvatar, iniciais } from "../app/componentes/avatar-cor";
import {
  instanteEmSaoPaulo,
  intervaloDaReserva,
  textoData,
  textoReserva,
} from "../app/painel/apresentacao";

test("data e hora de São Paulo viram instante absoluto (UTC−3, sem horário de verão)", () => {
  expect(instanteEmSaoPaulo("2026-10-17", "08:00")?.toISOString()).toBe("2026-10-17T11:00:00.000Z");
  expect(instanteEmSaoPaulo("2026-10-17", "22:30")?.toISOString()).toBe("2026-10-18T01:30:00.000Z");
  // Janeiro também é UTC−3: o Brasil não tem mais horário de verão.
  expect(instanteEmSaoPaulo("2027-01-10", "00:00")?.toISOString()).toBe("2027-01-10T03:00:00.000Z");
  // Alguns navegadores mandam segundos.
  expect(instanteEmSaoPaulo("2026-10-17", "08:00:00")?.toISOString()).toBe("2026-10-17T11:00:00.000Z");
});

test("data ou hora malformada ou impossível vira null", () => {
  for (const [d, h] of [
    ["", "08:00"],
    ["2026-10-17", ""],
    ["17/10/2026", "08:00"],
    ["2026-02-30", "08:00"],
    ["2026-13-01", "08:00"],
    ["2026-10-17", "24:00"],
    ["2026-10-17", "08:60"],
    ["2026-10-17", "8h"],
  ]) {
    expect(instanteEmSaoPaulo(d, h)).toBeNull();
  }
});

test("intervalo da reserva: fim antes ou igual ao início é erro, horário inválido também", () => {
  const r = intervaloDaReserva("2026-10-17", "08:00", "10:00");
  expect(r.inicio.toISOString()).toBe("2026-10-17T11:00:00.000Z");
  expect(r.fim.toISOString()).toBe("2026-10-17T13:00:00.000Z");
  expect(() => intervaloDaReserva("2026-10-17", "10:00", "08:00")).toThrow(ErroPainel);
  expect(mensagemDoErro(capturar(() => intervaloDaReserva("2026-10-17", "10:00", "08:00")), "x")).toBe(
    "O fim precisa ser depois do início.",
  );
  expect(mensagemDoErro(capturar(() => intervaloDaReserva("2026-10-17", "10:00", "10:00")), "x")).toBe(
    "O fim precisa ser depois do início.",
  );
  expect(mensagemDoErro(capturar(() => intervaloDaReserva("", "10:00", "11:00")), "x")).toBe("Horário inválido.");
});

function capturar(f: () => unknown): unknown {
  try {
    f();
  } catch (e) {
    return e;
  }
  throw new Error("não lançou");
}

test("rótulo da reserva em horário de São Paulo, minutos só quando houver", () => {
  const sp = (iso: string) => new Date(iso);
  expect(textoReserva(sp("2026-10-17T11:00:00Z"), sp("2026-10-17T13:00:00Z"))).toBe("Reserva 8h–10h");
  expect(textoReserva(sp("2026-10-17T11:30:00Z"), sp("2026-10-17T13:05:00Z"))).toBe("Reserva 8h30–10h05");
  expect(textoReserva(sp("2026-10-18T01:00:00Z"), sp("2026-10-18T02:00:00Z"))).toBe("Reserva 22h–23h");
  expect(textoData(sp("2026-10-18T01:00:00Z"))).toBe("17/10/2026");
});

test("iniciais: primeira e última palavra, até 2 letras", () => {
  expect(iniciais("Ana")).toBe("A");
  expect(iniciais("ana maria souza")).toBe("AS");
  expect(iniciais("  Élio   Dias ")).toBe("ÉD");
  expect(iniciais("")).toBe("?");
});

test("cor do avatar: estável pelo id e sempre da paleta", () => {
  const id = "3f2b8c1e-0000-4000-8000-000000000001";
  expect(corDoAvatar(id)).toBe(corDoAvatar(id));
  const usadas = new Set<string>();
  for (let i = 0; i < 200; i++) {
    const c = corDoAvatar(`3f2b8c1e-0000-4000-8000-${String(i).padStart(12, "0")}`);
    expect(PALETA_AVATAR).toContain(c);
    usadas.add(c);
  }
  // O hash espalha: ids parecidos não caem todos na mesma cor.
  expect(usadas.size).toBeGreaterThan(PALETA_AVATAR.length / 2);
});

// Contraste WCAG entre duas cores #rrggbb.
function contraste(a: string, b: string): number {
  const lum = (hex: string) => {
    const [r, g, b2] = [1, 3, 5].map((i) => {
      const c = parseInt(hex.slice(i, i + 2), 16) / 255;
      return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
    });
    return 0.2126 * r + 0.7152 * g + 0.0722 * b2;
  };
  const [x, y] = [lum(a), lum(b)].sort((m, n) => n - m);
  return (x + 0.05) / (y + 0.05);
}

test("iniciais brancas têm contraste AA (≥ 4,5:1) com toda cor da paleta", () => {
  for (const cor of PALETA_AVATAR) expect(contraste(cor, "#ffffff")).toBeGreaterThanOrEqual(4.5);
});
