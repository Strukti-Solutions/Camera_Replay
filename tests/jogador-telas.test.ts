import { expect, test } from "vitest";
import { novoBanco } from "./db";
import { criarContaComLimite } from "../app/lib/cadastro-jogador";
import { mensagemCriarConta, mensagemMinhaConta, MENSAGEM_MUITAS_TENTATIVAS } from "../app/jogador/mensagens";

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
