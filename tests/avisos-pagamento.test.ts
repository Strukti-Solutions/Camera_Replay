import { expect, test } from "vitest";
import { mensagemDoLembrete, mensagensDoCancelamento, type DadosAviso } from "../app/lib/avisos-email";

const APP = "https://replay.exemplo";
const BASE: DadosAviso = {
  arena: "Arena Sol", endereco: null, quadra: "Quadra 1", esporte: "", inicio: new Date("2026-11-10T18:00:00-03:00"),
  fim: new Date("2026-11-10T20:00:00-03:00"), jogador: "Ana", jogadorEmail: "ana@x.com", donos: ["dono@arena.com"],
  motivo: null, totalCentavos: 20000, situacao: "cancelada", canceladaPor: "jogador",
  pagamento: "online", estorno: "solicitado", estornoCentavos: 19802,
};
const paraJogador = (d: DadosAviso, quem: "jogador" | "dono") =>
  mensagensDoCancelamento(d, quem, APP).find((m) => m.para === "ana@x.com")!.texto;

test("jogador cancela reserva paga: diz o estorno sem a tarifa e o prazo de Pix e cartão", () => {
  const t = paraJogador(BASE, "jogador");
  expect(t).toContain("Estorno: R$ 198,02 (o valor pago menos a tarifa do Asaas).");
  expect(t).toContain("No Pix o dinheiro volta em instantes; no cartão, aparece na fatura em até 10 dias úteis.");
  const dono = mensagensDoCancelamento(BASE, "jogador", APP).find((m) => m.para === "dono@arena.com")!.texto;
  expect(dono).toContain("O pagamento online foi estornado ao jogador, menos a tarifa do Asaas.");
});

test("dono cancela reserva paga: o jogador recebe tudo de volta", () => {
  const t = paraJogador({ ...BASE, canceladaPor: "dono", estornoCentavos: 20000 }, "dono");
  expect(t).toContain("Estorno: R$ 200,00 (o valor inteiro).");
});

test("estorno pendente: avisa que a Strukti vai concluir; reserva na arena não fala de estorno", () => {
  expect(paraJogador({ ...BASE, estorno: "pendente", estornoCentavos: null }, "jogador"))
    .toContain("O estorno ainda não foi concluído; a Strukti vai resolver e avisar você.");
  const naArena = paraJogador({ ...BASE, pagamento: "arena", estorno: null, estornoCentavos: null }, "jogador");
  expect(naArena).not.toContain("Estorno");
  expect(naArena).not.toContain("estorno");
});

test("lembrete: já pago online ou pagar na arena", () => {
  const agora = new Date("2026-11-09T18:00:00-03:00");
  const online = mensagemDoLembrete({ ...BASE, situacao: "confirmada", estorno: null, estornoCentavos: null }, APP, agora)!;
  expect(online.texto).toContain("Pagamento: R$ 200,00, já pago online.");
  const arena = mensagemDoLembrete({ ...BASE, situacao: "confirmada", pagamento: "arena", estorno: null, estornoCentavos: null }, APP, agora)!;
  expect(arena.texto).toContain("Pagamento: R$ 200,00, na arena.");
});
