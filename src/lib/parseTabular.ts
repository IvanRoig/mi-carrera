/**
 * parseTabular.ts — Parsea texto pegado de la intraconsulta / historia académica
 * de la UNLaM y lo matchea contra el plan 2023-2.
 *
 * Es tolerante al formato: por cada línea busca un código de 5 dígitos que
 * exista en el plan y una nota (1..10). Detecta condición por palabras clave.
 * Ignora códigos que no estén en el plan (p.ej. materias del plan viejo).
 */
import { subjectByCode, subjects } from '@/data/plan';

export type ParsedRow = {
  code: string;
  grade: number | null;
  condition: 'approved' | 'regularized' | 'unknown';
};

export type ParseResult = {
  approved: { code: string; grade: number }[];
  regularized: string[];
  /** Líneas con datos que no matchearon ninguna materia del plan. */
  ignored: string[];
  rows: ParsedRow[];
};

const APPROVED_WORDS = /(aprob|promoci|examen|equivalen|acredit)/i;
const REGULAR_WORDS = /(regular|cursad|libre no|en curso|cursando)/i;

// Normaliza nombres para matchear por texto si no hay código.
function normalize(s: string): string {
  return s
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9 ]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

const byNormalizedName = new Map(subjects.map((s) => [normalize(s.name), s.code]));

export function parseTabular(text: string): ParseResult {
  const approved: { code: string; grade: number }[] = [];
  const regularized: string[] = [];
  const ignored: string[] = [];
  const rows: ParsedRow[] = [];
  const seen = new Set<string>();

  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line) continue;

    // 1) Buscar código de 5 dígitos que exista en el plan.
    const codeTokens = line.match(/\b\d{5}\b/g) ?? [];
    let code = codeTokens.find((c) => subjectByCode.has(c)) ?? null;

    // 2) Si no hay código válido, intentar matchear por nombre.
    if (!code) {
      const norm = normalize(line);
      for (const [name, c] of byNormalizedName) {
        if (name.length > 6 && norm.includes(name)) {
          code = c;
          break;
        }
      }
    }

    if (!code) {
      // ¿Tenía algún código de 5 dígitos (plan viejo) pero no matcheó?
      if (codeTokens.length > 0) ignored.push(line);
      continue;
    }
    if (seen.has(code)) continue;

    // 3) Nota: último número entre 1 y 10 (evita confundir con el código).
    const numMatches = [...line.matchAll(/\b(10|[1-9])\b/g)].map((m) => +m[1]);
    const grade = numMatches.length ? numMatches[numMatches.length - 1] : null;

    // 4) Condición.
    let condition: ParsedRow['condition'] = 'unknown';
    if (APPROVED_WORDS.test(line)) condition = 'approved';
    else if (REGULAR_WORDS.test(line)) condition = 'regularized';
    else if (grade != null && grade >= 4) condition = 'approved';

    seen.add(code);
    rows.push({ code, grade, condition });
    if (condition === 'approved') {
      approved.push({ code, grade: grade ?? 4 });
    } else if (condition === 'regularized') {
      regularized.push(code);
    } else if (grade != null) {
      approved.push({ code, grade });
    }
  }

  return { approved, regularized, ignored, rows };
}
