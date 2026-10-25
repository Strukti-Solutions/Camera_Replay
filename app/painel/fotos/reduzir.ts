// Redução da foto no navegador antes do envio: lado maior até 1600 px, em WebP.

export const LADO_MAX = 1600;
const QUALIDADE = 0.82;

// Mantém a proporção e nunca aumenta; lados arredondados, no mínimo 1 px.
export function medidaReduzida(largura: number, altura: number, max = LADO_MAX): { largura: number; altura: number } {
  const escala = Math.min(1, max / Math.max(largura, altura));
  return { largura: Math.max(1, Math.round(largura * escala)), altura: Math.max(1, Math.round(altura * escala)) };
}

const comoBlob = (canvas: HTMLCanvasElement, tipo: string) =>
  new Promise<Blob | null>((ok) => canvas.toBlob(ok, tipo, QUALIDADE));

// Devolve a foto reduzida, ou o arquivo original se o navegador não conseguir
// (formato que ele não abre, sem canvas) ou se a reduzida sair maior.
export async function reduzirFoto(arquivo: File): Promise<Blob> {
  try {
    const imagem = await createImageBitmap(arquivo, { imageOrientation: "from-image" });
    const { largura, altura } = medidaReduzida(imagem.width, imagem.height);
    const canvas = document.createElement("canvas");
    canvas.width = largura;
    canvas.height = altura;
    const ctx = canvas.getContext("2d");
    if (!ctx) return arquivo;
    ctx.drawImage(imagem, 0, 0, largura, altura);
    imagem.close();
    // Navegador sem WebP no canvas devolve PNG: aí vai JPEG.
    let blob = await comoBlob(canvas, "image/webp");
    if (!blob || blob.type !== "image/webp") blob = await comoBlob(canvas, "image/jpeg");
    return blob && blob.size < arquivo.size ? blob : arquivo;
  } catch {
    return arquivo;
  }
}
