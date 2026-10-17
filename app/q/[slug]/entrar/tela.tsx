import { FormularioEntrarAluno } from "./formulario";

// Tela de entrar do aluno: nome da quadra e e-mail e senha, nada mais. Serve à
// página do QR sem sessão e a /entrar?r=<reserva>.
export function TelaEntrar({ slug, quadra, reserva }: { slug: string; quadra: string; reserva: string | null }) {
  return (
    <main className="miolo entrar">
      <p className="entrar-quadra">{quadra}</p>
      <h1>Entrar</h1>
      <FormularioEntrarAluno slug={slug} reserva={reserva} />
    </main>
  );
}
