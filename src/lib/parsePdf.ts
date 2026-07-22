/**
 * parsePdf.ts — Lee la historia académica en PDF (descargada del campus) y
 * extrae materias, notas y condición. Reconstruye las filas de la tabla a partir
 * de las posiciones del texto y las pasa por el parser tabular existente.
 *
 * pdf.js se carga con import dinámico (solo cuando el usuario sube un PDF), así
 * no infla el bundle inicial.
 */
import { parseTabular, type ParseResult } from './parseTabular';

type TextItem = { str: string; transform: number[] };

/** Extrae las líneas de texto del PDF, respetando el orden visual. */
export async function extractPdfLines(file: File | ArrayBuffer): Promise<string[]> {
  const pdfjs = await import('pdfjs-dist');
  const workerMod = await import('pdfjs-dist/build/pdf.worker.min.mjs?url');
  pdfjs.GlobalWorkerOptions.workerSrc = workerMod.default;

  const data = file instanceof ArrayBuffer ? file : await file.arrayBuffer();
  const pdf = await pdfjs.getDocument({ data }).promise;

  const lines: string[] = [];
  for (let p = 1; p <= pdf.numPages; p++) {
    const page = await pdf.getPage(p);
    const content = await page.getTextContent();

    // Agrupar ítems por coordenada Y (con tolerancia) para reconstruir filas.
    const byY = new Map<number, { x: number; str: string }[]>();
    for (const item of content.items as TextItem[]) {
      const str = item.str;
      if (!str || !str.trim()) continue;
      const y = Math.round(item.transform[5]);
      let key = y;
      for (const k of byY.keys()) {
        if (Math.abs(k - y) <= 3) {
          key = k;
          break;
        }
      }
      const arr = byY.get(key) ?? [];
      arr.push({ x: item.transform[4], str });
      byY.set(key, arr);
    }

    // De arriba hacia abajo (Y decreciente), cada fila ordenada por X.
    const ys = [...byY.keys()].sort((a, b) => b - a);
    for (const y of ys) {
      const parts = byY
        .get(y)!
        .sort((a, b) => a.x - b.x)
        .map((it) => it.str);
      const line = parts.join(' ').replace(/\s+/g, ' ').trim();
      if (line) lines.push(line);
    }
  }
  return lines;
}

/** Lee un PDF de historia académica y devuelve las materias detectadas. */
export async function parseHistoriaPdf(file: File): Promise<ParseResult> {
  const lines = await extractPdfLines(file);
  return parseTabular(lines.join('\n'));
}
