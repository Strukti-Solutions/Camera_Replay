import { MarcaDaFaixa } from "@/app/componentes/marca";
import { MENSAGEM_ARENA_SUSPENSA } from "@/app/entrar/mensagens";
import { FormularioEntrarAluno } from "./formulario";

// Tela de entrar do aluno: nome da arena e e-mail e senha, nada mais. Serve à
// página da arena sem sessão e a /entrar?r=<reserva>. Não há cadastro pelo aluno:
// a conta é criada pelo dono no painel. Arena suspensa: só o nome e o aviso, sem
// formulário.
export function TelaEntrar({
  slug,
  arena,
  reserva,
  suspensa = false,
}: {
  slug: string;
  arena: string;
  reserva: string | null;
  suspensa?: boolean;
}) {
  return (
    <>
      <header className="faixa faixa-so-marca">
        <div className="miolo">
          <MarcaDaFaixa />
        </div>
      </header>
      <main className="miolo entrar">
        {suspensa ? (
          <>
            <h1>{arena}</h1>
            <p>{MENSAGEM_ARENA_SUSPENSA}</p>
          </>
        ) : (
          <>
            <p className="entrar-quadra">{arena}</p>
            <h1>Entrar</h1>
            <FormularioEntrarAluno slug={slug} reserva={reserva} />
          </>
        )}
      </main>
    </>
  );
}
