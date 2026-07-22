/**
 * conflicts.ts — Oferta de comisiones, choques de horario y turno (noche vs no-noche).
 */

export type Modality =
  | 'presencial'
  | 'semipresencial'
  | 'sincronica'
  | 'distancia';

export type Commission = {
  id: string;
  /** 0 = Lunes .. 6 = Domingo. */
  day: number;
  start: string; // "HH:MM"
  end: string; // "HH:MM"
  modality: Modality;
  campus?: string;
};

export type Offering = {
  code: string;
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

/** "HH:MM" → minutos desde medianoche. */
export function toMinutes(hhmm: string): number {
  const [h, m] = hhmm.split(':').map(Number);
  return h * 60 + (m || 0);
}

/** ¿La comisión es de turno noche? (arranca 18:00 o más y no es a distancia). */
export function isNightCommission(c: Commission): boolean {
  if (c.modality === 'distancia') return false;
  return toMinutes(c.start) >= 18 * 60;
}

/** ¿Dos comisiones se solapan en día y horario? (a distancia nunca choca). */
export function commissionsOverlap(a: Commission, b: Commission): boolean {
  if (a.modality === 'distancia' || b.modality === 'distancia') return false;
  if (a.day !== b.day) return false;
  const aStart = toMinutes(a.start);
  const aEnd = toMinutes(a.end);
  const bStart = toMinutes(b.start);
  const bEnd = toMinutes(b.end);
  return aStart < bEnd && bStart < aEnd;
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
 * scarcity = max(0, 3 - #comisiones). Materias no ofertadas quedan sin score.
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
