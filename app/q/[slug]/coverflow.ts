// Geometria do carrossel de lances (coverflow), sem DOM: o componente só
// aplica o resultado no estilo de cada cartão. "pos" é o índice fracionário
// do cartão que está no centro; é a única fonte da verdade da animação.

// Ajustes do visual, herdados do componente de referência.
const GIRO = 44; // graus do primeiro vizinho
const RECUO = 0.6; // quanto o primeiro vizinho afunda, em larguras de cartão
const QUEDA = 0.56; // expoente na distância: abaixo de 1 o efeito alivia ao se afastar
const APAGAR = 0.1; // opacidade perdida por passo a partir do centro
export const VAO = 0.05; // espaço entre cartões, em larguras de cartão
export const PERSPECTIVA = 3; // distância do observador, em larguras de cartão

const GIRO_MAXIMO = 82; // nunca de lado total, senão o cartão mostra as costas
const LIMIAR_ARRASTE = 6; // px; abaixo disso é toque, não arraste
const ARREMESSO_MAXIMO = 2; // cartões que um peteleco pode levar
const LOOP_MINIMO = 4; // com 2 ou 3 lances o vizinho cairia na emenda do anel e sumiria

export function usaLoop(total: number): boolean {
  return total >= LOOP_MINIMO;
}

// Cartão inteiro mais próximo do centro, dobrado para 0..total-1.
export function indiceEm(pos: number, total: number): number {
  return ((Math.round(pos) % total) + total) % total;
}

// Distância do cartão ao centro. Com loop, dobra pelo lado mais curto do
// anel: é todo o mecanismo de loop, sem clonar nem reordenar nós.
export function deslocamento(indice: number, pos: number, total: number, loop: boolean): number {
  let d = indice - pos;
  if (loop) {
    d = ((d % total) + total) % total;
    if (d > total / 2) d -= total;
  }
  return d;
}

export function limitar(pos: number, total: number, loop: boolean): number {
  return loop ? pos : Math.max(0, Math.min(total - 1, pos));
}

// Alvo para ir ao índice pelo caminho mais curto a partir do alvo atual.
export function alvoMaisCurto(indice: number, alvoAtual: number, total: number, loop: boolean): number {
  return loop ? indice + Math.round((alvoAtual - indice) / total) * total : indice;
}

// Velocidade do arraste (cartões/s) vira quantos cartões a inércia ainda anda.
export function arremesso(velocidade: number): number {
  return Math.max(-ARREMESSO_MAXIMO, Math.min(ARREMESSO_MAXIMO, velocidade * 0.18));
}

export function foiArraste(dx: number, dy: number): boolean {
  return Math.hypot(dx, dy) > LIMIAR_ARRASTE;
}

export type Pose = { x: number; z: number; giro: number; opacidade: number; camada: number };

// Posição de um cartão a "desloc" passos do centro, com cartões de "largura" px.
export function poseDoCartao(desloc: number, largura: number, total: number, loop: boolean): Pose {
  const distancia = Math.abs(desloc);
  // Giro e recuo aliviam com a distância: o segundo cartão continua legível.
  const rampa = Math.pow(distancia, QUEDA);
  const giro = Math.min(GIRO * rampa, GIRO_MAXIMO) * Math.sign(desloc);
  // Com loop o cartão salta de lado a meia volta: tem de estar invisível ali.
  const borda = loop ? Math.min(1, Math.max(0, total / 2 - distancia)) : 1;
  return {
    x: desloc * largura * (1 + VAO),
    z: -RECUO * largura * rampa,
    // Sem "-0" no centro: fica igual nos testes e no estilo.
    giro: giro === 0 ? 0 : -giro,
    opacidade: Math.max(0, 1 - APAGAR * distancia) * borda,
    camada: 100 - Math.round(distancia),
  };
}
