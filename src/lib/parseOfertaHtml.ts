/**
 * parseOfertaHtml.ts — Extrae la oferta de comisiones desde el HTML de la
 * intraconsulta de la UNLaM. Pensado para ser MUY tolerante a variaciones de
 * formato: detecta columnas por encabezado, arrastra el código cuando viene
 * vacío, y parsea el campo "Días" en cualquiera de sus variantes.
 *
 * Formato típico de la columna "Días":
 *   Lu19a23        → Lunes 19:00 a 23:00
 *   LuJu17a19      → Lunes y Jueves 17:00 a 19:00
 *   A distancia    → sin franja (modalidad a distancia)
 */
import { subjectByCode } from '@/data/plan';
import type { Commission, Meeting, Modality, OfferData, Offering } from '@/domain/conflicts';

const DAY_MAP: Record<string, number> = {
  lu: 0, ma: 1, mi: 2, ju: 3, vi: 4, sa: 5, do: 6,
};

/** Normaliza un código a 5 dígitos (la oferta a veces trae "0901" → "00901"). */
export function normalizeCode(raw: string): string | null {
  const digits = raw.replace(/\D/g, '');
  if (!digits) return null;
  return digits.padStart(5, '0');
}

function stripAccents(s: string): string {
  return s.normalize('NFD').replace(/[̀-ͯ]/g, '');
}

/** Normaliza el texto de modalidad. */
export function normalizeModality(raw: string): Modality {
  const s = stripAccents(raw.toLowerCase());
  if (s.includes('semipres')) return 'semipresencial';
  if (s.includes('sincron')) return 'sincronica';
  if (s.includes('distan')) return 'distancia';
  if (s.includes('virtual')) return 'virtual';
  if (s.includes('presen')) return 'presencial';
  return 'presencial';
}

/**
 * Parsea el campo "Días" → lista de encuentros. Devuelve [] si es a distancia o
 * no tiene franja reconocible.
 */
export function parseDias(raw: string): { meetings: Meeting[]; distance: boolean } {
  const text = stripAccents(raw.trim().toLowerCase());
  if (!text || text.includes('distan')) return { meetings: [], distance: true };

  const meetings: Meeting[] = [];
  // Grupos: uno o más días (lu/ma/mi/ju/vi/sa/do) + hora inicio + 'a' + hora fin.
  const re =
    /((?:lu|ma|mi|ju|vi|sa|do)+)\s*(\d{1,2})(?::?(\d{2}))?\s*a\s*(\d{1,2})(?::?(\d{2}))?/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    const daysRun = m[1];
    const startH = m[2].padStart(2, '0');
    const startM = m[3] ?? '00';
    const endH = m[4].padStart(2, '0');
    const endM = m[5] ?? '00';
    const start = `${startH}:${startM}`;
    const end = `${endH}:${endM}`;
    // Partir la corrida de días en tokens de 2 letras.
    for (let i = 0; i + 2 <= daysRun.length; i += 2) {
      const tok = daysRun.slice(i, i + 2);
      const day = DAY_MAP[tok];
      if (day !== undefined) meetings.push({ day, start, end });
    }
  }
  return { meetings, distance: false };
}

/** Extrae las filas de la tabla como matriz de strings. */
function extractRows(htmlOrDoc: string | Document): { headers: string[]; rows: string[][] } {
  let doc: Document;
  if (typeof htmlOrDoc === 'string') {
    doc = new DOMParser().parseFromString(htmlOrDoc, 'text/html');
  } else {
    doc = htmlOrDoc;
  }

  // Elegir la tabla con más celdas (la de la oferta).
  const tables = [...doc.querySelectorAll('table')];
  let best: HTMLTableElement | null = null;
  let bestCells = 0;
  for (const t of tables) {
    const cells = t.querySelectorAll('td').length;
    if (cells > bestCells) {
      bestCells = cells;
      best = t as HTMLTableElement;
    }
  }
  if (!best) return { headers: [], rows: [] };

  const headers = [...best.querySelectorAll('th')].map((th) =>
    (th.textContent ?? '').replace(/\s+/g, ' ').trim(),
  );
  const rows: string[][] = [];
  for (const tr of best.querySelectorAll('tr')) {
    const tds = [...tr.querySelectorAll('td')];
    if (tds.length === 0) continue;
    rows.push(tds.map((td) => (td.textContent ?? '').replace(/\s+/g, ' ').trim()));
  }
  return { headers, rows };
}

/** Ubica el índice de cada columna por su encabezado (con fallback posicional). */
function columnIndexes(headers: string[]): {
  code: number; name: number; comm: number; dias: number; mod: number; sede: number;
} {
  const norm = headers.map((h) => stripAccents(h.toLowerCase()));
  const find = (kw: string, fallback: number) => {
    const i = norm.findIndex((h) => h.includes(kw));
    return i >= 0 ? i : fallback;
  };
  return {
    code: find('codigo', 0),
    name: find('descrip', 1),
    comm: find('comis', 2),
    dias: find('dias', 4),
    mod: find('modalidad', 5),
    sede: find('sede', 6),
  };
}

/** Parser principal: HTML string (o Document) → OfferData. */
export function parseOfertaHtml(
  htmlOrDoc: string | Document,
  cuatrimestre = 'Oferta importada',
): OfferData {
  const { headers, rows } = extractRows(htmlOrDoc);
  const col = columnIndexes(headers);

  const byCode = new Map<string, Offering>();
  let lastCode: string | null = null;
  let lastName = '';

  for (const cells of rows) {
    if (cells.length < 3) continue;
    const rawCode = cells[col.code] ?? '';
    const name = cells[col.name] ?? '';
    const commId = cells[col.comm] ?? '';
    const diasRaw = cells[col.dias] ?? '';
    const modRaw = cells[col.mod] ?? '';
    const sede = cells[col.sede] ?? '';

    // Arrastrar código/nombre cuando la fila continúa la materia anterior.
    let code = normalizeCode(rawCode);
    if (code) {
      lastCode = code;
      lastName = name || lastName;
    } else {
      code = lastCode;
    }
    if (!code) continue;
    // Solo materias que existan en el plan.
    if (!subjectByCode.has(code)) continue;
    if (!commId) continue; // fila sin comisión válida

    const { meetings } = parseDias(diasRaw);
    let modality = normalizeModality(modRaw);
    if (meetings.length === 0 && modality !== 'distancia') {
      // Sin franja reconocible: la tratamos como a distancia para no romper.
      modality = 'distancia';
    }

    const commission: Commission = {
      id: commId,
      meetings,
      modality,
      campus: sede || undefined,
      raw: diasRaw || undefined,
    };

    let off = byCode.get(code);
    if (!off) {
      off = { code, name: lastName || subjectByCode.get(code)?.name, commissions: [] };
      byCode.set(code, off);
    }
    // Evitar comisiones duplicadas por id.
    if (!off.commissions.some((c) => c.id === commission.id)) {
      off.commissions.push(commission);
    }
  }

  return { cuatrimestre, offerings: [...byCode.values()] };
}
