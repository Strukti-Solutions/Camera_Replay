import { corDoAvatar, iniciais } from "./avatar-cor";

// Avatar do aluno: "squircle" com as iniciais sobre uma cor fixa escolhida
// pelo id (não muda se o nome mudar). aria-hidden: o nome está sempre ao
// lado (ou em texto para leitor de tela), e o avatar não deve repeti-lo.
// SVG próprio e sem JavaScript: um nó leve por linha da tabela.
export function Avatar({ id, nome }: { id: string; nome: string }) {
  return (
    <svg className="avatar" viewBox="0 0 32 32" width="32" height="32" aria-hidden="true" focusable="false">
      {/* Superelipse: cantos mais cheios que um retângulo arredondado. */}
      <path d="M16 0C28.8 0 32 3.2 32 16S28.8 32 16 32 0 28.8 0 16 3.2 0 16 0Z" fill={corDoAvatar(id)} />
      <text x="16" y="16.5" textAnchor="middle" dominantBaseline="central" fill="#ffffff">
        {iniciais(nome)}
      </text>
    </svg>
  );
}

// Avatares sobrepostos (lista de alunos de uma reserva). Os nomes vão em
// texto para o leitor de tela e no title para quem passa o mouse.
export function AvataresEmpilhados({ alunos }: { alunos: { id: string; nome: string }[] }) {
  const nomes = alunos.map((a) => a.nome).join(", ");
  return (
    <span className="avatares" title={nomes}>
      {alunos.map((a) => (
        <Avatar key={a.id} id={a.id} nome={a.nome} />
      ))}
      <span className="so-leitor">{nomes}</span>
    </span>
  );
}
