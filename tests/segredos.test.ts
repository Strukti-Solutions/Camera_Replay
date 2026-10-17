import { expect, test } from "vitest";
import { hashToken, novoSlug, novoToken } from "../app/lib/segredos";

test("novoToken tem 43 caracteres base64url e não repete", () => {
  expect(novoToken()).toMatch(/^[A-Za-z0-9_-]{43}$/);
  expect(novoToken()).not.toBe(novoToken());
});

test("novoSlug tem 22 caracteres base64url e não repete", () => {
  expect(novoSlug()).toMatch(/^[A-Za-z0-9_-]{22}$/);
  expect(novoSlug()).not.toBe(novoSlug());
});

test("hashToken é SHA-256 em hex", () => {
  expect(hashToken("abc")).toBe("ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad");
});
