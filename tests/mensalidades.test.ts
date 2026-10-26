import { expect, test, vi } from "vitest";
import { ErroAsaas, type PagamentoAsaas } from "../app/lib/asaas";
import { criarArenaComDono } from "../app/lib/donos";
import {
  definirMensalidade, documentoValido, mensalidadesDaArena, processarCobrancaMensalidade, proximoVencimento,
} from "../app/lib/mensalidades";
import { detalheArenaAdmin, listarArenasAdmin, pendenciasDePagamento } from "../app/lib/plataforma";
import { novoBanco } from "./db";
import { asaasFalso } from "./fixtures-asaas";

const AGORA = new Date("2026-10-26T15:00:00-03:00");
const CPF = "24971563792";

async function arena() {
  const db = await novoBanco();
  const { arenaId } = await criarArenaComDono(db, { arena: "Arena Sol", email: "dono@arena.com", senha: "senha-do-dono-123" });
  return { db, arenaId, f: asaasFalso() };
}
const linha = (db: Awaited<ReturnType<typeof novoBanco>>, id: string) =>
  db.query<Record<string, unknown>>(
    `select mensalidade_centavos, mensalidade_dia, dono_documento, dono_nome_cobranca, asaas_cliente_id, asaas_assinatura_id
       from arenas where id = $1`, [id]).then((r) => r.rows[0]);
const cobranca = (p: Partial<PagamentoAsaas>): PagamentoAsaas => ({
  id: "pay_m1", status: "PENDING", valorCentavos: 14990, liquidoCentavos: 14891, checkout: null, splits: [],
  assinatura: "sub_1", vencimento: "2026-11-10", link: "https://sandbox.asaas.com/i/abc", ...p,
});

test("documentoValido: CPF e CNPJ pelos dígitos verificadores, com ou sem pontuação", () => {
  expect(documentoValido("249.715.637-92")).toBe(CPF);
  expect(documentoValido("11.222.333/0001-81")).toBe("11222333000181");
  expect(documentoValido("249.715.637-93")).toBeNull();
  expect(documentoValido("11111111111")).toBeNull();
  expect(documentoValido("123")).toBeNull();
  expect(documentoValido("")).toBeNull();
});

test("proximoVencimento: próxima data com o dia escolhido, depois de hoje (fuso de São Paulo)", () => {
  expect(proximoVencimento(10, AGORA)).toBe("2026-11-10");
  expect(proximoVencimento(28, AGORA)).toBe("2026-10-28");
  expect(proximoVencimento(26, AGORA)).toBe("2026-11-26"); // hoje não: dá tempo de o e-mail chegar
  expect(proximoVencimento(5, new Date("2026-12-20T12:00:00-03:00"))).toBe("2027-01-05");
});

test("cadastrar: cria o cliente e a assinatura e grava na arena", async () => {
  const { db, arenaId, f } = await arena();
  const r = await definirMensalidade(db, f.asaas, arenaId, { valor: "149,90", dia: "10", documento: "249.715.637-92", nome: "João Dono" }, AGORA);
  expect(r).toEqual({ ok: true });
  expect(f.asaas.criarCliente).toHaveBeenCalledWith({ nome: "João Dono", documento: CPF, email: "dono@arena.com", arenaId });
  expect(f.asaas.criarAssinatura).toHaveBeenCalledWith({
    cliente: "cus_1", valorCentavos: 14990, vencimento: "2026-11-10", descricao: "Mensalidade Replay · Arena Sol", arenaId,
  });
  expect(await linha(db, arenaId)).toEqual({
    mensalidade_centavos: 14990, mensalidade_dia: 10, dono_documento: CPF, dono_nome_cobranca: "João Dono",
    asaas_cliente_id: "cus_1", asaas_assinatura_id: "sub_1",
  });
});

test("alterar valor ou dia: altera a assinatura; nada mudou: não chama o Asaas", async () => {
  const { db, arenaId, f } = await arena();
  await definirMensalidade(db, f.asaas, arenaId, { valor: "149,90", dia: "10", documento: CPF, nome: "João Dono" }, AGORA);
  expect(await definirMensalidade(db, f.asaas, arenaId, { valor: "149,90", dia: "10", documento: CPF, nome: "João Dono" }, AGORA))
    .toEqual({ ok: true });
  expect(f.asaas.alterarAssinatura).not.toHaveBeenCalled();
  await definirMensalidade(db, f.asaas, arenaId, { valor: "199", dia: "15", documento: CPF, nome: "João Dono" }, AGORA);
  // O próximo vencimento atual da assinatura é 10/12 (a cobrança de 10/11 já existe):
  // o dia novo vale a partir de dezembro, sem segunda cobrança em novembro.
  expect(f.asaas.alterarAssinatura).toHaveBeenCalledWith("sub_1", { valorCentavos: 19900, vencimento: "2026-12-15" });
  expect(f.asaas.criarAssinatura).toHaveBeenCalledTimes(1);
  expect(await linha(db, arenaId)).toMatchObject({ mensalidade_centavos: 19900, mensalidade_dia: 15 });
});

test("trocar o CPF/CNPJ com assinatura ativa é recusado (apagar e cadastrar de novo)", async () => {
  const { db, arenaId, f } = await arena();
  await definirMensalidade(db, f.asaas, arenaId, { valor: "149,90", dia: "10", documento: CPF, nome: "João Dono" }, AGORA);
  const r = await definirMensalidade(db, f.asaas, arenaId, { valor: "149,90", dia: "10", documento: "11222333000181", nome: "X" }, AGORA);
  expect(r.ok).toBe(false);
});

test("valor em branco: exclui a assinatura, cancela as cobranças em aberto e mantém o documento", async () => {
  const { db, arenaId, f } = await arena();
  await definirMensalidade(db, f.asaas, arenaId, { valor: "149,90", dia: "10", documento: CPF, nome: "João Dono" }, AGORA);
  await processarCobrancaMensalidade(db, cobranca({}), AGORA);
  expect(await definirMensalidade(db, f.asaas, arenaId, { valor: "", dia: "", documento: CPF, nome: "João Dono" }, AGORA)).toEqual({ ok: true });
  expect(f.asaas.excluirAssinatura).toHaveBeenCalledWith("sub_1");
  expect(await linha(db, arenaId)).toMatchObject({
    mensalidade_centavos: null, mensalidade_dia: null, asaas_assinatura_id: null, dono_documento: CPF, asaas_cliente_id: "cus_1",
  });
  expect((await mensalidadesDaArena(db, arenaId)).map((m) => m.situacao)).toEqual(["cancelada"]);
  // Cadastrar de novo reaproveita o cliente.
  await definirMensalidade(db, f.asaas, arenaId, { valor: "100", dia: "5", documento: CPF, nome: "João Dono" }, AGORA);
  expect(f.asaas.criarCliente).toHaveBeenCalledTimes(1);
});

test("entrada inválida e Asaas fora: nada muda", async () => {
  const { db, arenaId, f } = await arena();
  const base = { valor: "149,90", dia: "10", documento: CPF, nome: "João Dono" };
  for (const e of [{ valor: "abc" }, { dia: "29" }, { dia: "0" }, { documento: "123" }, { nome: "" }]) {
    expect((await definirMensalidade(db, f.asaas, arenaId, { ...base, ...e }, AGORA)).ok).toBe(false);
  }
  expect((await definirMensalidade(db, null, arenaId, base, AGORA)).ok).toBe(false);
  const ruim = asaasFalso(true);
  expect((await definirMensalidade(db, ruim.asaas, arenaId, base, AGORA)).ok).toBe(false);
  expect(await linha(db, arenaId)).toMatchObject({ mensalidade_centavos: null, asaas_assinatura_id: null });
  expect(f.asaas.criarCliente).not.toHaveBeenCalled();
  expect((await definirMensalidade(db, f.asaas, "nao-e-uuid", base, AGORA)).ok).toBe(false);
});

test("Asaas aceita a assinatura mas o banco falha: a assinatura criada é excluída", async () => {
  const { db, arenaId, f } = await arena();
  const original = db.query.bind(db);
  const spy = vi.spyOn(db, "query").mockImplementation(((sql: string, p?: unknown[]) =>
    /set mensalidade_centavos/.test(String(sql)) ? Promise.reject(new Error("banco caiu")) : original(sql, p)) as typeof db.query);
  const r = await definirMensalidade(db, f.asaas, arenaId, { valor: "149,90", dia: "10", documento: CPF, nome: "João Dono" }, AGORA);
  spy.mockRestore();
  expect(r.ok).toBe(false);
  expect(f.asaas.excluirAssinatura).toHaveBeenCalledWith("sub_1");
});

test("cobranças da assinatura: grava, atualiza a situação e ignora assinatura desconhecida", async () => {
  const { db, arenaId, f } = await arena();
  await definirMensalidade(db, f.asaas, arenaId, { valor: "149,90", dia: "10", documento: CPF, nome: "João Dono" }, AGORA);
  expect(await processarCobrancaMensalidade(db, cobranca({}), AGORA)).toBe("ok");
  expect(await processarCobrancaMensalidade(db, cobranca({ status: "OVERDUE" }), AGORA)).toBe("ok");
  let m = await mensalidadesDaArena(db, arenaId);
  expect(m).toEqual([{
    id: "pay_m1", valorCentavos: 14990, vencimento: "2026-11-10", situacao: "atrasada", link: "https://sandbox.asaas.com/i/abc", pagoEm: null,
  }]);
  const depois = new Date("2026-11-12T10:00:00-03:00");
  await processarCobrancaMensalidade(db, cobranca({ status: "RECEIVED" }), depois);
  await processarCobrancaMensalidade(db, cobranca({ status: "RECEIVED" }), AGORA);
  m = await mensalidadesDaArena(db, arenaId);
  expect(m[0]).toMatchObject({ situacao: "paga", pagoEm: depois });
  await processarCobrancaMensalidade(db, cobranca({ status: "REFUNDED" }), AGORA);
  expect((await mensalidadesDaArena(db, arenaId))[0].situacao).toBe("estornada");
  expect(await processarCobrancaMensalidade(db, cobranca({ id: "pay_x", assinatura: "sub_outra" }), AGORA)).toBe("alheia");
});

test("admin: lista, detalhe e pendências mostram a mensalidade e a cobrança atrasada", async () => {
  const { db, arenaId, f } = await arena();
  await definirMensalidade(db, f.asaas, arenaId, { valor: "149,90", dia: "10", documento: CPF, nome: "João Dono" }, AGORA);
  expect((await listarArenasAdmin(db))[0]).toMatchObject({ mensalidadeCentavos: 14990, situacaoMensalidade: null });
  expect(await detalheArenaAdmin(db, arenaId)).toMatchObject({
    mensalidade: { valorCentavos: 14990, dia: 10, documento: CPF, nome: "João Dono" },
  });
  await processarCobrancaMensalidade(db, cobranca({ id: "pay_out", vencimento: "2026-10-10", status: "OVERDUE" }), AGORA);
  await processarCobrancaMensalidade(db, cobranca({ id: "pay_nov", vencimento: "2026-11-10" }), AGORA);
  // Uma atrasada pesa mais que a pendente mais nova.
  expect((await listarArenasAdmin(db))[0].situacaoMensalidade).toBe("atrasada");
  expect((await pendenciasDePagamento(db)).mensalidades).toEqual([{
    id: "pay_out", arenaId, arena: "Arena Sol", valorCentavos: 14990, vencimento: "2026-10-10", link: "https://sandbox.asaas.com/i/abc",
  }]);
  await processarCobrancaMensalidade(db, cobranca({ id: "pay_out", vencimento: "2026-10-10", status: "RECEIVED" }), AGORA);
  expect((await listarArenasAdmin(db))[0].situacaoMensalidade).toBe("pendente");
  expect((await pendenciasDePagamento(db)).mensalidades).toEqual([]);
});

test("vencimento ao alterar: só o valor mantém o próximo vencimento; dia novo fica no mesmo mês dele", async () => {
  const { db, arenaId, f } = await arena();
  await definirMensalidade(db, f.asaas, arenaId, { valor: "149,90", dia: "10", documento: CPF, nome: "João Dono" }, AGORA);
  await definirMensalidade(db, f.asaas, arenaId, { valor: "199", dia: "10", documento: CPF, nome: "João Dono" }, AGORA);
  expect(f.asaas.alterarAssinatura).toHaveBeenLastCalledWith("sub_1", { valorCentavos: 19900, vencimento: "2026-12-10" });
  await definirMensalidade(db, f.asaas, arenaId, { valor: "199", dia: "5", documento: CPF, nome: "João Dono" }, AGORA);
  expect(f.asaas.alterarAssinatura).toHaveBeenLastCalledWith("sub_1", { valorCentavos: 19900, vencimento: "2026-12-05" });
  // Próximo vencimento ainda neste mês e dia novo já passou: vai para o mês seguinte.
  vi.mocked(f.asaas.lerAssinatura).mockResolvedValueOnce({ proximoVencimento: "2026-10-28" });
  await definirMensalidade(db, f.asaas, arenaId, { valor: "199", dia: "20", documento: CPF, nome: "João Dono" }, AGORA);
  expect(f.asaas.alterarAssinatura).toHaveBeenLastCalledWith("sub_1", { valorCentavos: 19900, vencimento: "2026-11-20" });
});

test("dois cadastros ao mesmo tempo: só uma assinatura fica; a outra é excluída no Asaas", async () => {
  const { db, arenaId, f } = await arena();
  const e = { valor: "149,90", dia: "10", documento: CPF, nome: "João Dono" };
  const r = await Promise.all([definirMensalidade(db, f.asaas, arenaId, e, AGORA), definirMensalidade(db, f.asaas, arenaId, e, AGORA)]);
  expect(r.filter((x) => x.ok)).toHaveLength(1);
  const gravada = (await linha(db, arenaId)).asaas_assinatura_id;
  expect(["sub_1", "sub_2"]).toContain(gravada);
  expect(f.asaas.excluirAssinatura).toHaveBeenCalledTimes(1);
  expect(f.asaas.excluirAssinatura).toHaveBeenCalledWith(gravada === "sub_1" ? "sub_2" : "sub_1");
});

test("tirar a mensalidade com a assinatura já excluída no Asaas (404) não trava", async () => {
  const { db, arenaId, f } = await arena();
  await definirMensalidade(db, f.asaas, arenaId, { valor: "149,90", dia: "10", documento: CPF, nome: "João Dono" }, AGORA);
  vi.mocked(f.asaas.excluirAssinatura).mockRejectedValueOnce(new ErroAsaas(404, null));
  expect(await definirMensalidade(db, f.asaas, arenaId, { valor: "", dia: "", documento: CPF, nome: "João Dono" }, AGORA)).toEqual({ ok: true });
  expect(await linha(db, arenaId)).toMatchObject({ asaas_assinatura_id: null });
});

test("cobrança excluída (deleted na API) fica cancelada, mesmo lida com status PENDING", async () => {
  const { db, arenaId, f } = await arena();
  await definirMensalidade(db, f.asaas, arenaId, { valor: "149,90", dia: "10", documento: CPF, nome: "João Dono" }, AGORA);
  await processarCobrancaMensalidade(db, cobranca({}), AGORA);
  expect(await processarCobrancaMensalidade(db, cobranca({ excluida: true }), AGORA)).toBe("ok");
  expect((await mensalidadesDaArena(db, arenaId))[0].situacao).toBe("cancelada");
  // Excluída e nunca gravada: nada a fazer.
  expect(await processarCobrancaMensalidade(db, cobranca({ id: "pay_z", assinatura: "sub_velha", excluida: true }), AGORA)).toBe("alheia");
});

test("cobrança de assinatura ainda não gravada: aguardar se a arena dela ainda não tem assinatura; senão é alheia", async () => {
  const { db, arenaId } = await arena();
  const nova = cobranca({ id: "pay_n", assinatura: "sub_9", referencia: arenaId, criadoEm: "2026-10-26" });
  expect(await processarCobrancaMensalidade(db, nova, AGORA)).toBe("aguardar");
  // Criada em outro dia: não fica esperando (503 seguidos pausariam a fila do Asaas).
  expect(await processarCobrancaMensalidade(db, { ...nova, criadoEm: "2026-10-25" }, AGORA)).toBe("alheia");
  expect(await processarCobrancaMensalidade(db, cobranca({ id: "pay_o", assinatura: "sub_o", referencia: "outra-coisa" }), AGORA)).toBe("alheia");
});
