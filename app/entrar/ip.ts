// IP do cliente a partir dos cabeçalhos da plataforma (na Vercel ambos são
// definidos por ela, não pelo navegador).
export function ipDoCliente(cabecalhos: Headers): string {
  const real = cabecalhos.get("x-real-ip")?.trim();
  if (real) return real;
  const primeiro = cabecalhos.get("x-forwarded-for")?.split(",")[0]?.trim();
  return primeiro || "desconhecido";
}
