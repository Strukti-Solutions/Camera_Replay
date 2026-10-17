import { readFileSync } from "node:fs";
import { expect, test, vi } from "vitest";
import {
  cifrarCredenciais,
  decifrarCredenciais,
  lerChave,
  type CredenciaisCamera,
} from "../app/lib/cripto";

const cred: CredenciaisCamera = {
  authcode: "authcode-secreto-123",
  local_user: "admin",
  local_pwd: "senha-da-camera-ç✓",
};
const chave = Buffer.alloc(32, 1);

const partes = (s: string) => s.split(":");
const remontar = (p: string[]) => p.join(":");

test("ida e volta preserva os três campos", () => {
  expect(decifrarCredenciais(cifrarCredenciais(cred, chave), chave)).toEqual(cred);
});

test("formato v1:<iv 12>:<tag 16>:<cifra>, cada parte em base64", () => {
  const p = partes(cifrarCredenciais(cred, chave));
  expect(p).toHaveLength(4);
  expect(p[0]).toBe("v1");
  expect(Buffer.from(p[1], "base64")).toHaveLength(12);
  expect(Buffer.from(p[2], "base64")).toHaveLength(16);
  expect(Buffer.from(p[3], "base64").length).toBeGreaterThan(0);
});

test("duas cifras do mesmo valor saem diferentes (IV aleatório)", () => {
  const a = cifrarCredenciais(cred, chave);
  const b = cifrarCredenciais(cred, chave);
  expect(a).not.toBe(b);
  expect(partes(a)[1]).not.toBe(partes(b)[1]);
});

test("o texto cifrado não contém as credenciais em claro", () => {
  const s = cifrarCredenciais(cred, chave);
  for (const v of Object.values(cred)) expect(s).not.toContain(v);
});

test("um byte trocado na cifra, na tag ou no IV faz lançar", () => {
  const original = cifrarCredenciais(cred, chave);
  for (const i of [1, 2, 3]) {
    const p = partes(original);
    const bytes = Buffer.from(p[i], "base64");
    bytes[0] ^= 0x01;
    p[i] = bytes.toString("base64");
    expect(() => decifrarCredenciais(remontar(p), chave)).toThrow();
  }
});

test("outra chave faz lançar", () => {
  const s = cifrarCredenciais(cred, chave);
  expect(() => decifrarCredenciais(s, Buffer.alloc(32, 2))).toThrow();
});

test("versão diferente de v1 faz lançar", () => {
  const p = partes(cifrarCredenciais(cred, chave));
  for (const v of ["v2", "V1", "", "v1 "]) {
    expect(() => decifrarCredenciais(remontar([v, ...p.slice(1)]), chave)).toThrow();
  }
});

test("formato malformado faz lançar: partes a mais/a menos, tamanhos de IV e tag, base64 inválido", () => {
  const p = partes(cifrarCredenciais(cred, chave));
  const ruins = [
    "",
    "v1",
    remontar(p.slice(0, 3)),
    remontar([...p, "x"]),
    remontar([p[0], Buffer.alloc(11).toString("base64"), p[2], p[3]]),
    remontar([p[0], Buffer.alloc(16).toString("base64"), p[2], p[3]]),
    remontar([p[0], p[1], Buffer.alloc(15).toString("base64"), p[3]]),
    remontar([p[0], p[1], Buffer.alloc(8).toString("base64"), p[3]]),
    remontar([p[0], "***", p[2], p[3]]),
    remontar([p[0], p[1], p[2], "!!"]),
  ];
  for (const s of ruins) expect(() => decifrarCredenciais(s, chave)).toThrow();
});

test("base64 não canônico (quebra de linha, espaço, sem padding) é recusado mesmo com conteúdo autêntico", () => {
  const p = partes(cifrarCredenciais(cred, chave));
  for (const i of [1, 2, 3]) {
    for (const mutar of [(x: string) => x + "\n", (x: string) => " " + x, (x: string) => x.replace(/=+$/, "") + "=="]) {
      const q = [...p];
      q[i] = mutar(q[i]);
      if (q[i] === p[i]) continue;
      expect(() => decifrarCredenciais(remontar(q), chave)).toThrow();
    }
  }
});

test("cifra autêntica com JSON sem os três campos como string faz lançar", async () => {
  const { createCipheriv, randomBytes } = await import("node:crypto");
  const selar = (valor: unknown) => {
    const iv = randomBytes(12);
    const c = createCipheriv("aes-256-gcm", chave, iv);
    const cifra = Buffer.concat([c.update(JSON.stringify(valor), "utf8"), c.final()]);
    return ["v1", iv, c.getAuthTag(), cifra].map((x) => (typeof x === "string" ? x : x.toString("base64"))).join(":");
  };
  expect(decifrarCredenciais(selar(cred), chave)).toEqual(cred); // o selo de teste é válido
  const ruins = [
    { authcode: "a", local_user: "u" },
    { authcode: "a", local_user: "u", local_pwd: 1 },
    { authcode: null, local_user: "u", local_pwd: "p" },
    ["a", "u", "p"],
    "texto",
    null,
  ];
  for (const r of ruins) expect(() => decifrarCredenciais(selar(r), chave)).toThrow();
});

test("decifrar devolve só os três campos, mesmo se o JSON tiver extras", async () => {
  const { createCipheriv, randomBytes } = await import("node:crypto");
  const iv = randomBytes(12);
  const c = createCipheriv("aes-256-gcm", chave, iv);
  const cifra = Buffer.concat([c.update(JSON.stringify({ ...cred, extra: "x" }), "utf8"), c.final()]);
  const s = ["v1", iv.toString("base64"), c.getAuthTag().toString("base64"), cifra.toString("base64")].join(":");
  expect(decifrarCredenciais(s, chave)).toEqual(cred);
});

test("chave com tamanho errado faz cifrar e decifrar lançarem", () => {
  const s = cifrarCredenciais(cred, chave);
  for (const k of [Buffer.alloc(16, 1), Buffer.alloc(31, 1), Buffer.alloc(33, 1), Buffer.alloc(0)]) {
    expect(() => cifrarCredenciais(cred, k)).toThrow();
    expect(() => decifrarCredenciais(s, k)).toThrow();
  }
});

test("erros não vazam credencial, chave nem o texto recebido", () => {
  const s = cifrarCredenciais(cred, chave);
  const p = partes(s);
  p[3] = Buffer.from("adulterado-" + cred.local_pwd).toString("base64");
  const tentativas: Array<() => unknown> = [
    () => decifrarCredenciais(remontar(p), chave),
    () => decifrarCredenciais(s, Buffer.alloc(32, 9)),
    () => decifrarCredenciais(`v2:${cred.local_pwd}:x:y`, chave),
    () => lerChave({ CAMERA_CRED_KEY: Buffer.alloc(31, 7).toString("base64") }),
  ];
  const log = vi.spyOn(console, "error").mockImplementation(() => {});
  for (const t of tentativas) {
    const e = (() => {
      try {
        t();
      } catch (x) {
        return x as Error;
      }
      throw new Error("devia lançar");
    })();
    const texto = `${e.message} ${e.stack}`;
    for (const segredo of [cred.authcode, cred.local_pwd, chave.toString("base64"), Buffer.alloc(31, 7).toString("base64")]) {
      expect(texto).not.toContain(segredo);
    }
  }
  expect(log).not.toHaveBeenCalled();
  log.mockRestore();
});

test("lerChave aceita 32 bytes em base64 e lança em tudo mais", () => {
  const k = Buffer.alloc(32, 5);
  expect(lerChave({ CAMERA_CRED_KEY: k.toString("base64") })).toEqual(k);
  expect(lerChave({ CAMERA_CRED_KEY: ` ${k.toString("base64")}\n` })).toEqual(k);
  const ruins: Array<string | undefined> = [
    undefined,
    "",
    "   ",
    Buffer.alloc(31, 5).toString("base64"),
    Buffer.alloc(33, 5).toString("base64"),
    Buffer.alloc(16, 5).toString("base64"),
    "x".repeat(44), // 44 caracteres, mas não decodifica para 32 bytes válidos
    k.toString("hex"), // 64 hex não é base64 de 32 bytes
    "não é base64 !!!",
  ];
  for (const v of ruins) expect(() => lerChave({ CAMERA_CRED_KEY: v })).toThrow(/CAMERA_CRED_KEY/);
});

test("lerChave lê process.env por padrão", () => {
  const k = Buffer.alloc(32, 6);
  vi.stubEnv("CAMERA_CRED_KEY", k.toString("base64"));
  expect(lerChave()).toEqual(k);
  vi.unstubAllEnvs();
});

// O worker Python vai decifrar este vetor no plano do loop de produção.
test("vetor fixo (chave 0x01*32, IV 0x02*12) bate com tests/vetor-credenciais.json e decifra", () => {
  const vetor = JSON.parse(readFileSync(new URL("./vetor-credenciais.json", import.meta.url), "utf8"));
  expect(vetor.chave_base64).toBe(Buffer.alloc(32, 1).toString("base64"));
  expect(vetor.iv_base64).toBe(Buffer.alloc(12, 2).toString("base64"));
  const k = Buffer.from(vetor.chave_base64, "base64");
  const gerado = cifrarCredenciais(vetor.credenciais, k, Buffer.alloc(12, 2));
  expect(gerado).toBe(vetor.cifrado);
  expect(decifrarCredenciais(vetor.cifrado, k)).toEqual(vetor.credenciais);
});

test("iv de tamanho errado em cifrar lança", () => {
  expect(() => cifrarCredenciais(cred, chave, Buffer.alloc(11, 2))).toThrow();
});
