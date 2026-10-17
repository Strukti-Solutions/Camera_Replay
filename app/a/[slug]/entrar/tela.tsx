import { MarcaDaFaixa } from "@/app/componentes/marca";
import { FormularioEntrarAluno } from "./formulario";

// Tela de entrar do aluno: nome da arena e e-mail e senha, nada mais. Serve à
// página da arena sem sessão e a /entrar?r=<reserva>. Não há cadastro pelo aluno:
// a conta é criada pelo dono no painel.
export function TelaEntrar({ slug, arena, reserva }: { slug: string; arena: string; reserva: string | null }) {
  return (
    <>
      <header className="faixa faixa-so-marca">
        <div className="miolo">
          <MarcaDaFaixa />
        </div>
      </header>
      <main className="miolo entrar">
        <p className="entrar-quadra">{arena}</p>
        <h1>Entrar</h1>
        <FormularioEntrarAluno slug={slug} reserva={reserva} />
      </main>
    </>
  );
}
