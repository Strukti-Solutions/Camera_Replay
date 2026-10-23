import { MarcaDaFaixa } from "@/app/componentes/marca";
import { LinkVoltar } from "@/app/componentes/voltar";
import { destinoVoltarEntrar } from "../apresentacao";
import { MENSAGEM_ARENA_SUSPENSA } from "@/app/entrar/mensagens";
import { FormularioEntrarAluno } from "./formulario";

// Tela de entrar do aluno: diz que é a área do aluno e de qual arena, e pede
// e-mail e senha. Serve à
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
        <LinkVoltar href={destinoVoltarEntrar(slug, reserva)} />
        {suspensa ? (
          <>
            <h1>{arena}</h1>
            <p>{MENSAGEM_ARENA_SUSPENSA}</p>
          </>
        ) : (
          <>
            <p className="entrar-quadra">Área do aluno · {arena}</p>
            <h1>Entrar como aluno</h1>
            <p className="entrar-dica">Use o e-mail e a senha que a arena te passou.</p>
            <FormularioEntrarAluno slug={slug} reserva={reserva} />
          </>
        )}
      </main>
    </>
  );
}
