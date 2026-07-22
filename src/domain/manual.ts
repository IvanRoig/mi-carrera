/**
 * manual.ts — Validación en vivo del simulador manual (drag & drop).
 * Chequea correlativas, capacidad, calendario y choques de horario.
 */
import type { Graph } from './graph';
import type { UserSettings } from './types';
import { calendarOf } from './scheduler';
import type { Commission, OfferData } from './conflicts';
import { commissionsOverlap, isNightCommission, offeringMap } from './conflicts';

export type ManualTermInput = { id: string; subjects: string[] };

export type SubjectDiag = {
  code: string;
  ok: boolean;
  missingPrereqs: string[];
  calendarError?: string;
  /** Comisión asignada sin choque (si hay oferta). */
  commission?: Commission;
  hasConflict?: boolean;
};

export type TermDiag = {
  id: string;
  index: number;
  year: number;
  term: 1 | 2;
  isFirstSemester: boolean;
  subjects: SubjectDiag[];
  nightCount: number;
  nonNightCount: number;
  hours: number;
  overCapacityNight: boolean;
  overCapacityNonNight: boolean;
  conflictCount: number;
};

export type ManualPlanDiag = {
  terms: TermDiag[];
  makespan: number;
  graduation: { year: number; month: number };
  placedCount: number;
  valid: boolean;
};

export function validateManualPlan(
  graph: Graph,
  done: Set<string>,
  manualTerms: ManualTermInput[],
  settings: UserSettings,
  offer?: OfferData | null,
): ManualPlanDiag {
  const offMap = offer ? offeringMap(offer) : null;

  // finishByCode: cuatri en que queda terminada cada materia colocada.
  const finishByCode = new Map<string, number>();
  for (const c of done) finishByCode.set(c, -1);
  manualTerms.forEach((t, i) => {
    for (const c of t.subjects) {
      const s = graph.byCode.get(c);
      finishByCode.set(c, i + (s?.annual ? 1 : 0));
    }
  });

  const terms: TermDiag[] = [];
  let valid = true;

  manualTerms.forEach((t, i) => {
    const cal = calendarOf(i, settings.startYear, settings.startTerm);
    const diags: SubjectDiag[] = [];
    let night = 0;
    let nonNight = 0;
    let hours = 0;
    let conflictCount = 0;
    const assigned: { code: string; commission: Commission }[] = [];

    for (const code of t.subjects) {
      const s = graph.byCode.get(code);
      if (!s) continue;
      hours += s.totalHours;

      // Correlativas: deben terminar antes de este cuatri.
      const reqs = graph.prereqs.get(code) ?? [];
      const missing = reqs.filter((p) => (finishByCode.get(p) ?? Infinity) >= i);

      // Calendario.
      let calendarError: string | undefined;
      if ((s.annual || s.startsOnlyFirstSemester) && !cal.isFirstSemester) {
        calendarError = 'solo puede arrancar en 1er cuatrimestre';
      }

      // Oferta / choques.
      let commission: Commission | undefined;
      let hasConflict = false;
      let isNight = true;
      if (offMap) {
        const o = offMap.get(code);
        if (o && o.commissions.length) {
          // Greedy: primera comisión que no choque con las ya asignadas.
          const free = o.commissions.find(
            (c) => !assigned.some((a) => commissionsOverlap(a.commission, c)),
          );
          commission = free ?? o.commissions[0];
          if (!free) {
            hasConflict = true;
            conflictCount++;
          }
          assigned.push({ code, commission });
          isNight = isNightCommission(commission);
        }
      }
      if (isNight) night++;
      else nonNight++;

      const ok = missing.length === 0 && !calendarError && !hasConflict;
      if (!ok) valid = false;
      diags.push({ code, ok, missingPrereqs: missing, calendarError, commission, hasConflict });
    }

    const overNight = night > settings.maxNightSlots;
    const overNonNight = nonNight > settings.maxNonNightSlots;
    if (overNight || overNonNight) valid = false;

    terms.push({
      id: t.id,
      index: i,
      year: cal.year,
      term: cal.term,
      isFirstSemester: cal.isFirstSemester,
      subjects: diags,
      nightCount: night,
      nonNightCount: nonNight,
      hours,
      overCapacityNight: overNight,
      overCapacityNonNight: overNonNight,
      conflictCount,
    });
  });

  // Makespan = último cuatri con materias (considerando cierre de anuales).
  let lastFinish = -1;
  for (const [, f] of finishByCode) if (f > lastFinish) lastFinish = f;
  const makespan = lastFinish + 1;

  const lastCal = calendarOf(
    Math.max(0, makespan - 1),
    settings.startYear,
    settings.startTerm,
  );
  const endMonth = lastCal.term === 1 ? 7 : 12;
  const gradAbsMonth =
    lastCal.year * 12 + (endMonth - 1) + settings.degreeProcessingMonths;
  const graduation = {
    year: Math.floor(gradAbsMonth / 12),
    month: (gradAbsMonth % 12) + 1,
  };

  const placedCount = manualTerms.reduce((a, t) => a + t.subjects.length, 0);

  return { terms, makespan, graduation, placedCount, valid };
}
