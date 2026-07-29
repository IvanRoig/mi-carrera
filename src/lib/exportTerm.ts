/**
 * exportTerm.ts — Texto de un cuatrimestre para copiar al portapapeles.
 *
 * Pensado para tenerlo a mano el día de la inscripción: agrupado por día (y
 * turno si hay más de una ese día), con código de materia y de comisión.
 */
import type { Commission } from '@/domain/conflicts';
import { toMinutes, turnoOf } from '@/domain/conflicts';

export type TermItem = {
  code: string;
  name: string;
  commission?: Commission;
  /** Día forzado (si no hay comisión, p.ej. verano o una materia sin oferta). */
  day?: number;
  /** Turno forzado (mismo caso). */
  turno?: 'm' | 't' | 'n';
};

const DAY_LONG = ['Lunes', 'Martes', 'Miércoles', 'Jueves', 'Viernes', 'Sábado', 'Domingo'];
const DAY_2 = ['Lu', 'Ma', 'Mi', 'Ju', 'Vi', 'Sá', 'Do'];
const TURNO_LONG: Record<'m' | 't' | 'n', string> = {
  m: 'Mañana',
  t: 'Tarde',
  n: 'Noche',
};
const SEP = '-----------------------------------------';

/** "03648" → "3648" (como figura en la inscripción). */
function shortCode(code: string): string {
  return code.replace(/^0+/, '') || code;
}

/** "19:00" → "19" ; "08:00" → "08" ; "08:30" → "08:30" (como en la inscripción). */
function shortTime(hhmm: string): string {
  const [h, m] = hhmm.split(':');
  return m && m !== '00' ? `${h}:${m}` : h;
}

/** El horario de una comisión tal como se lee en la inscripción: "Lu 19-23". */
function scheduleText(c: Commission): string {
  if (!c.meetings.length) return 'sin horario fijo';
  return [...c.meetings]
    .sort((a, b) => a.day - b.day || toMinutes(a.start) - toMinutes(b.start))
    .map((m) => `${DAY_2[m.day] ?? '??'} ${shortTime(m.start)}-${shortTime(m.end)}`)
    .join(' / ');
}

/** Códigos de comisión reales son numéricos ("1900"); los sintéticos, no. */
function commissionCode(c?: Commission): string | null {
  if (!c) return null;
  return /^\d+$/.test(c.id) ? c.id : null;
}

/** Día y turno donde cae un item (de su comisión, o el forzado). */
function slotOf(it: TermItem): { day: number; turno: 'm' | 't' | 'n'; start: number } | null {
  const m = it.commission?.meetings.length
    ? [...it.commission.meetings].sort((a, b) => toMinutes(a.start) - toMinutes(b.start))[0]
    : null;
  if (m) {
    return { day: it.day ?? m.day, turno: it.turno ?? turnoOf(toMinutes(m.start)), start: toMinutes(m.start) };
  }
  if (it.day != null && it.day >= 0) {
    const turno = it.turno ?? 'n';
    return { day: it.day, turno, start: turno === 'm' ? 480 : turno === 't' ? 840 : 1140 };
  }
  return null;
}

/**
 * Arma el texto del cuatrimestre listo para pegar (WhatsApp, notas, etc.).
 * `title` es opcional: si lo pasás, encabeza el texto.
 */
export function termToClipboardText(items: TermItem[], title?: string): string {
  const withSlot = items
    .map((it) => ({ it, slot: slotOf(it) }))
    .filter((x): x is { it: TermItem; slot: NonNullable<ReturnType<typeof slotOf>> } => !!x.slot)
    .sort((a, b) => a.slot.day - b.slot.day || a.slot.start - b.slot.start);
  const noSlot = items.filter((it) => !slotOf(it));

  // ¿Cuántas materias hay por día? (si hay más de una, el título lleva el turno)
  const perDay = new Map<number, number>();
  for (const { slot } of withSlot) perDay.set(slot.day, (perDay.get(slot.day) ?? 0) + 1);

  const blocks: string[] = [];

  for (const { it, slot } of withSlot) {
    const dayName = DAY_LONG[slot.day] ?? 'Día';
    const header =
      (perDay.get(slot.day) ?? 0) > 1 ? `${dayName} ${TURNO_LONG[slot.turno]}` : dayName;
    // Para las electivas, el código que se inscribe es el de la electiva concreta.
    const matCode = it.commission?.subjectCode ?? it.code;
    const lines = [`*${header}*`, it.name, `Cod Mat: ${shortCode(matCode)}`];
    const cc = commissionCode(it.commission);
    const horario = it.commission ? scheduleText(it.commission) : `${DAY_2[slot.day]} (a confirmar)`;
    lines.push(cc ? `Cod Com: ${cc} (${horario})` : `Cod Com: a confirmar (${horario})`);
    blocks.push(lines.join('\n'));
  }

  for (const it of noSlot) {
    const lines = [`*Sin día fijo*`, it.name, `Cod Mat: ${shortCode(it.code)}`];
    const cc = commissionCode(it.commission);
    lines.push(cc ? `Cod Com: ${cc}` : `Cod Com: a confirmar`);
    blocks.push(lines.join('\n'));
  }

  const body = blocks.join(`\n${SEP}\n`);
  return title ? `*${title}*\n${SEP}\n${body}` : body;
}

/** Copia texto al portapapeles. Devuelve true si se pudo. */
export async function copyToClipboard(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    // Fallback para navegadores/contextos sin permiso de clipboard.
    try {
      const ta = document.createElement('textarea');
      ta.value = text;
      ta.style.position = 'fixed';
      ta.style.opacity = '0';
      document.body.appendChild(ta);
      ta.select();
      const ok = document.execCommand('copy');
      document.body.removeChild(ta);
      return ok;
    } catch {
      return false;
    }
  }
}
