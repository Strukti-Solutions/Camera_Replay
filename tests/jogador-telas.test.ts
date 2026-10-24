import { expect, test } from "vitest";
import { novoBanco } from "./db";
import { apagarContaComLimite, criarContaComLimite, trocarSenhaComLimite } from "../app/lib/cadastro-jogador";
import { criarContaJogador } from "../app/lib/jogadores";
import { conferirSenha } from "../app/lib/senha";
import { mensagemApagarConta, mensagemCriarConta, mensagemMinhaConta, MENSAGEM_MUITAS_TENTATIVAS } from "../app/jogador/mensagens";

test("mensagemCriarConta devolve o texto de cada erro", () => {
  expect(mensagemCriarConta("nome")).toBe("Informe seu nome (até 80 caracteres).");
  expect(mensagemCriarConta("email")).toBe("Informe um e-mail válido.");
  expect(mensagemCriarConta("senha")).toBe("A senha precisa ter pelo menos 8 caracteres.");
  expect(mensagemCriarConta("termos")).toBe("Para criar a conta, aceite os termos de uso e a política de privacidade.");
  expect(mensagemCriarConta("email_em_uso")).toBe('Este e-mail já tem conta. Entre ou use "Esqueci a senha".');
});

test("mensagemMinhaConta devolve o texto de cada erro", () => {
  expect(mensagemMinhaConta("nome")).toBe("Informe seu nome (até 80 caracteres).");
  expect(mensagemMinhaConta("senha")).toBe("A senha precisa ter pelo menos 8 caracteres.");
  expect(mensagemMinhaConta("senha_atual")).toBe("Senha atual incorreta.");
});

test("mensagemApagarConta devolve o texto de cada recusa", () => {
  expect(mensagemApagarConta("reservas_futuras")).toBe("Cancele suas reservas futuras antes de apagar a conta.");
  expect(mensagemApagarConta("senha")).toBe("Senha incorreta.");
  expect(mensagemApagarConta("limite")).toBe(MENSAGEM_MUITAS_TENTATIVAS);
});

test("cadastro limita as tentativas por e-mail e não cria conta quando bloqueado", async () => {
  const db = await novoBanco();
  const d = { nome: "Ana", email: "Ana@X.com", senha: "senha-boa-1", aceitouTermos: false };
  // aceitouTermos=false: cada chamada falha por "termos" mas conta como tentativa.
  for (let i = 0; i < 5; i++) expect(await criarContaComLimite(db, d, "1.1.1.1")).toEqual({ ok: false, erro: "termos" });
  expect(await criarContaComLimite(db, { ...d, aceitouTermos: true }, "1.1.1.1")).toEqual({ ok: false, erro: "limite" });
  const c = await db.query<{ n: number }>("select count(*)::int as n from jogadores");
  expect(c.rows[0].n).toBe(0);
  expect(MENSAGEM_MUITAS_TENTATIVAS).toBe("Muitas tentativas. Espere 15 minutos e tente de novo.");
  // e-mail normalizado: outro e-mail não está bloqueado
  const ok = await criarContaComLimite(db, { ...d, email: "outra@x.com", aceitouTermos: true }, "1.1.1.1");
  expect(ok.ok).toBe(true);
});

async function contaPronta() {
  const db = await novoBanco();
  const r = await criarContaJogador(db, { nome: "Ana", email: "ana@x.com", senha: "senha-boa-1", aceitouTermos: true });
  if (!r.ok) throw new Error("conta");
  return { db, id: r.jogadorId };
}

test("trocar senha: depois de 5 senhas atuais erradas a 6a, mesmo certa, é bloqueada", async () => {
  const { db, id } = await contaPronta();
  for (let i = 0; i < 5; i++) {
    expect(await trocarSenhaComLimite(db, id, "errada", "nova-senha-1", "", "2.2.2.2")).toEqual({ ok: false, erro: "senha_atual" });
  }
  expect(await trocarSenhaComLimite(db, id, "senha-boa-1", "nova-senha-1", "", "2.2.2.2")).toEqual({ ok: false, erro: "limite" });
  const h = await db.query<{ senha_hash: string }>("select senha_hash from jogadores where id = $1", [id]);
  expect(await conferirSenha("senha-boa-1", h.rows[0].senha_hash)).toBe(true);
});

test("apagar conta: depois de 5 senhas erradas a 6a, mesmo certa, é bloqueada e a conta fica", async () => {
  const { db, id } = await contaPronta();
  for (let i = 0; i < 5; i++) expect(await apagarContaComLimite(db, id, "errada", "2.2.2.2")).toEqual({ ok: false, erro: "senha" });
  expect(await apagarContaComLimite(db, id, "senha-boa-1", "2.2.2.2")).toEqual({ ok: false, erro: "limite" });
  const c = await db.query<{ n: number }>("select count(*)::int as n from jogadores");
  expect(c.rows[0].n).toBe(1);
});

test("senha certa zera as tentativas do jogador", async () => {
  const { db, id } = await contaPronta();
  for (let i = 0; i < 4; i++) await trocarSenhaComLimite(db, id, "errada", "nova-senha-1", "", "3.3.3.3");
  expect((await trocarSenhaComLimite(db, id, "senha-boa-1", "nova-senha-1", "", "3.3.3.3")).ok).toBe(true);
  const n = await db.query<{ n: number }>("select count(*)::int as n from tentativas_login where email = $1", [`senha-jogador:${id}`]);
  expect(n.rows[0].n).toBe(0);
});
