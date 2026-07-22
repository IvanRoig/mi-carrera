/**
 * manual.ts — Validación en vivo del simulador manual (drag & drop).
 * Chequea correlativas, capacidad (materias por cuatri), calendario y choques.
 */
import type { Graph } from './graph';
import type { UserSettings } from './types';
import { calendarOf } from './scheduler';
import type { Commission, OfferData } from './conflicts';
import {
  commissionsOverlap,
  commissionFitsAvailability,
  offeringMap,
} from './conflicts';

export type ManualTermInput = { id: string; subjects: string[] };

export type SubjectDiag = {
  code: string;
  ok: boolean;
  missingPrereqs: string[];
  calendarError?: string;
  commission?: Commission;
  hasConflict?: boolean;
  /** En el 1er cuatri: la materia no figura en la oferta actual. */
  notOffered?: boolean;
  /** En el 1er cuatri: está ofertada pero no en un día/horario que puedas. */
  notAvailable?: boolean;
};

export type TermDiag = {
  id: string;
  index: number;
  year: number;
  term: 1 | 2;
  isFirstSemester: boolean;
  subjects: SubjectDiag[];
  count: number;
  difficultCount: number;
  hours: number;
  overCapacity: boolean;
  conflictCount: number;
};

export type ManualPlanDiag = {
  terms: TermDiag[];
  makespan: number;
  years: number;
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
  difficult?: Set<string>,
): ManualPlanDiag {
  const offMap = offer ? offeringMap(offer) : null;
  const diff = difficult ?? new Set<string>();
  const availableSlots = settings.restrictAvailability
    ? new Set(settings.availableSlots)
    : null;

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
    let hours = 0;
    let difficultCount = 0;
    let conflictCount = 0;
    const assigned: { code: string; commission: Commission }[] = [];

    for (const code of t.subjects) {
      const s = graph.byCode.get(code);
      if (!s) continue;
      hours += s.totalHours;
      if (diff.has(code)) difficultCount++;

      const reqs = graph.prereqs.get(code) ?? [];
      const missing = reqs.filter((p) => (finishByCode.get(p) ?? Infinity) >= i);

      let calendarError: string | undefined;
      if ((s.annual || s.startsOnlyFirstSemester) && !cal.isFirstSemester) {
        calendarError = 'solo puede arrancar en 1er cuatrimestre';
      }

      let commission: Commission | undefined;
      let hasConflict = false;
      let notOffered = false;
      let notAvailable = false;
      if (offMap) {
        const o = offMap.get(code);
        if (o && o.commissions.length) {
          const free = o.commissions.find(
            (c) => !assigned.some((a) => commissionsOverlap(a.commission, c)),
          );
          commission = free ?? o.commissions[0];
          if (!free) {
            hasConflict = true;
            conflictCount++;
          }
          assigned.push({ code, commission });
          // Solo en el 1er cuatri chequeamos contra la oferta cargada.
          if (i === 0 && availableSlots) {
            const fits = o.commissions.some((c) =>
              commissionFitsAvailability(c, availableSlots),
            );
            if (!fits) notAvailable = true;
          }
        } else if (i === 0 && !s.isElective) {
          // 1er cuatri: la materia no está en la oferta actual.
          notOffered = true;
        }
      }

      const ok = missing.length === 0 && !calendarError && !hasConflict;
      if (!ok) valid = false;
      diags.push({
        code,
        ok,
        missingPrereqs: missing,
        calendarError,
        commission,
        hasConflict,
        notOffered,
        notAvailable,
      });
    }

    const count = t.subjects.length;
    const overCapacity = !settings ? false : count > settings.maxPerTerm;
    if (overCapacity) valid = false;

    terms.push({
      id: t.id,
      index: i,
      year: cal.year,
      term: cal.term,
      isFirstSemester: cal.isFirstSemester,
      subjects: diags,
      count,
      difficultCount,
      hours,
      overCapacity,
      conflictCount,
    });
  });

  let lastFinish = -1;
  for (const [, f] of finishByCode) if (f > lastFinish) lastFinish = f;
  const makespan = lastFinish + 1;

  const lastCal = calendarOf(Math.max(0, makespan - 1), settings.startYear, settings.startTerm);
  const graduation = {
    year: lastCal.year,
    month: lastCal.term === 1 ? 7 : 12,
  };

  const placedCount = manualTerms.reduce((a, t) => a + t.subjects.length, 0);

  return { terms, makespan, years: makespan / 2, graduation, placedCount, valid };
}
