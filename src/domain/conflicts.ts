/**
 * conflicts.ts — Oferta de comisiones, choques de horario y turno.
 *
 * Una comisión puede tener VARIOS encuentros (p.ej. Lunes y Jueves 17-19), por
 * eso `meetings` es una lista. Modalidad "distancia" (o sin encuentros) no ocupa
 * franja horaria y nunca choca.
 */

export type Modality =
  | 'presencial'
  | 'semipresencial'
  | 'sincronica'
  | 'distancia'
  | 'virtual';

/** Un encuentro de una comisión: día + franja horaria. */
export type Meeting = {
  /** 0 = Lunes .. 6 = Domingo. */
  day: number;
  start: string; // "HH:MM"
  end: string; // "HH:MM"
};

export type Commission = {
  id: string;
  meetings: Meeting[];
  modality: Modality;
  campus?: string;
  /** Texto original de "Días" (para mostrar tal cual si hace falta). */
  raw?: string;
};

export type Offering = {
  code: string;
  name?: string;
  commissions: Commission[];
};

export type OfferData = {
  cuatrimestre: string;
  offerings: Offering[];
};

export const DAY_NAMES = [
  'Lunes',
  'Martes',
  'Miércoles',
  'Jueves',
  'Viernes',
  'Sábado',
  'Domingo',
];

export const DAY_SHORT = ['Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb', 'Dom'];

/** "HH:MM" → minutos desde medianoche. */
export function toMinutes(hhmm: string): number {
  const [h, m] = hhmm.split(':').map(Number);
  return h * 60 + (m || 0);
}

/** ¿Es una comisión de turno noche? (algún encuentro arranca 18:00 o más). */
export function isNightCommission(c: Commission): boolean {
  if (c.modality === 'distancia') return false;
  return c.meetings.some((m) => toMinutes(m.start) >= 18 * 60);
}

/** ¿Dos encuentros se solapan (mismo día y horario)? */
export function meetingsOverlap(a: Meeting, b: Meeting): boolean {
  if (a.day !== b.day) return false;
  return toMinutes(a.start) < toMinutes(b.end) && toMinutes(b.start) < toMinutes(a.end);
}

/** ¿Dos comisiones chocan? (algún par de encuentros se solapa; distancia nunca). */
export function commissionsOverlap(a: Commission, b: Commission): boolean {
  if (a.modality === 'distancia' || b.modality === 'distancia') return false;
  for (const ma of a.meetings) {
    for (const mb of b.meetings) {
      if (meetingsOverlap(ma, mb)) return true;
    }
  }
  return false;
}

export type SelectedCommission = { code: string; commission: Commission };

export type Conflict = {
  a: SelectedCommission;
  b: SelectedCommission;
};

/** Detecta todos los pares de comisiones elegidas que chocan. */
export function detectConflicts(selected: SelectedCommission[]): Conflict[] {
  const conflicts: Conflict[] = [];
  for (let i = 0; i < selected.length; i++) {
    for (let j = i + 1; j < selected.length; j++) {
      if (commissionsOverlap(selected[i].commission, selected[j].commission)) {
        conflicts.push({ a: selected[i], b: selected[j] });
      }
    }
  }
  return conflicts;
}

/** Índice rápido código → oferta. */
export function offeringMap(offer: OfferData): Map<string, Offering> {
  return new Map(offer.offerings.map((o) => [o.code, o]));
}

/**
 * Escasez por materia a partir de la oferta: menos comisiones = más escasa.
 * scarcity = max(0, 3 - #comisiones).
 */
export function scarcityFromOffer(offer: OfferData): Map<string, number> {
  const m = new Map<string, number>();
  for (const o of offer.offerings) {
    m.set(o.code, Math.max(0, 3 - o.commissions.length));
  }
  return m;
}

/** Códigos ofertados este cuatrimestre. */
export function offeredCodes(offer: OfferData): Set<string> {
  return new Set(offer.offerings.map((o) => o.code));
}

/**
 * ¿Se puede elegir una comisión para cada materia del conjunto sin que ninguna
 * choque? (asignación factible). Devuelve el mapa código→comisión si se puede,
 * o null si es imposible. Backtracking simple (pocas materias por cuatri).
 */
export function findConflictFreeAssignment(
  codes: string[],
  offMap: Map<string, Offering>,
): Map<string, Commission> | null {
  const result = new Map<string, Commission>();

  function backtrack(i: number): boolean {
    if (i >= codes.length) return true;
    const o = offMap.get(codes[i]);
    // Sin oferta para esta materia: no bloquea (no sabemos su horario).
    if (!o || o.commissions.length === 0) return backtrack(i + 1);
    for (const c of o.commissions) {
      const clashes = [...result.values()].some((used) =>
        commissionsOverlap(used, c),
      );
      if (!clashes) {
        result.set(codes[i], c);
        if (backtrack(i + 1)) return true;
        result.delete(codes[i]);
      }
    }
    return false;
  }

  return backtrack(0) ? result : null;
}
