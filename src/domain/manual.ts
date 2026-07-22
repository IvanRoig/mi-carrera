/**
 * manual.ts — Validación en vivo del simulador manual (drag & drop por día).
 * Chequea correlativas, capacidad, calendario y elige comisiones SIN choques
 * (igual que el automático: backtracking), respetando el día que forzaste.
 */
import type { Graph } from './graph';
import type { UserSettings } from './types';
import { calendarOf } from './scheduler';
import type { Commission, OfferData } from './conflicts';
import {
  commissionsOverlap,
  commissionFitsAvailability,
  isNightCommission,
  offeringMap,
  toMinutes,
} from './conflicts';

export type ManualTermInput = { id: string; subjects: string[] };

export type SubjectDiag = {
  code: string;
  ok: boolean;
  missingPrereqs: string[];
  calendarError?: string;
  commission?: Commission;
  /** Día donde se muestra (de la comisión, o el día forzado sin oferta). */
  day?: number;
  hasConflict?: boolean;
  /** No figura en la oferta actual (no tiene comisiones). */
  notOffered?: boolean;
  /** La comisión elegida no entra en tu disponibilidad horaria. */
  notAvailable?: boolean;
  /** Forzaste esta materia a un día que en la oferta actual no tiene comisión. */
  forcedNoDay?: boolean;
};

export type TermDiag = {
  id: string;
  index: number;
  year: number;
  term: 1 | 2;
  isFirstSemester: boolean;
  subjects: SubjectDiag[];
  /** Materias anuales que arrancaron el cuatri anterior y siguen ocupando este. */
  continuing: SubjectDiag[];
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

/** Ordena comisiones por preferencia: disponibilidad, luego noche. */
function sortByPref(comms: Commission[], availableSlots: Set<string> | null): Commission[] {
  const score = (c: Commission) =>
    (availableSlots ? (commissionFitsAvailability(c, availableSlots) ? 0 : 4) : 0) +
    (isNightCommission(c) ? 0 : 1);
  return [...comms].sort((a, b) => score(a) - score(b));
}

/** Asigna a cada código una comisión sin solapamientos (backtracking). null si no se puede. */
function assignAvoiding(
  codes: string[],
  commsByCode: Map<string, Commission[]>,
  taken: Commission[],
): Map<string, Commission> | null {
  const result = new Map<string, Commission>();
  const bt = (i: number): boolean => {
    if (i >= codes.length) return true;
    for (const comm of commsByCode.get(codes[i]) ?? []) {
      const clash =
        taken.some((t) => commissionsOverlap(t, comm)) ||
        [...result.values()].some((u) => commissionsOverlap(u, comm));
      if (!clash) {
        result.set(codes[i], comm);
        if (bt(i + 1)) return true;
        result.delete(codes[i]);
      }
    }
    return false;
  };
  return bt(0) ? result : null;
}

export function validateManualPlan(
  graph: Graph,
  done: Set<string>,
  manualTerms: ManualTermInput[],
  settings: UserSettings,
  offer?: OfferData | null,
  difficult?: Set<string>,
  forcedDay: Record<string, number> = {},
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
    const commsOf = (code: string) => sortByPref(offMap?.get(code)?.commissions ?? [], availableSlots);

    // --- Asignación de comisiones del cuatri (forzadas + automáticas) ---
    const commByCode = new Map<string, Commission>();
    const forcedNoDaySet = new Set<string>();
    const conflictSet = new Set<string>();
    const taken: Commission[] = [];

    // 1) Forzadas por el usuario (día elegido).
    for (const code of t.subjects) {
      const forced = forcedDay[code];
      if (forced === undefined) continue;
      const comms = commsOf(code);
      const onDay =
        forced === -1
          ? comms.filter((c) => c.modality === 'distancia' || c.meetings.length === 0)
          : comms.filter((c) => c.meetings.some((m) => m.day === forced));
      if (onDay.length === 0) {
        if (comms.length > 0) forcedNoDaySet.add(code);
      } else {
        const pick = onDay.find((c) => !taken.some((tk) => commissionsOverlap(tk, c))) ?? onDay[0];
        if (taken.some((tk) => commissionsOverlap(tk, pick))) conflictSet.add(code);
        commByCode.set(code, pick);
        taken.push(pick);
      }
    }

    // 2) Automáticas (sin día forzado): asignación sin choques.
    const autoCodes = t.subjects.filter(
      (c) => forcedDay[c] === undefined && commsOf(c).length > 0,
    );
    const commsByCode = new Map<string, Commission[]>();
    for (const c of autoCodes) commsByCode.set(c, commsOf(c));
    const asg = assignAvoiding(autoCodes, commsByCode, taken);
    if (asg) {
      for (const [c, comm] of asg) commByCode.set(c, comm);
    } else {
      // No hay asignación sin choques: greedy marcando los que chocan.
      for (const c of autoCodes) {
        const comms = commsOf(c);
        const free = comms.find((x) => !taken.some((tk) => commissionsOverlap(tk, x)));
        const pick = free ?? comms[0];
        if (!free) conflictSet.add(c);
        commByCode.set(c, pick);
        taken.push(pick);
      }
    }

    // --- Diagnóstico por materia ---
    const diags: SubjectDiag[] = [];
    let hours = 0;
    let difficultCount = 0;
    let conflictCount = 0;

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

      const commission = commByCode.get(code);
      const forcedNoDay = forcedNoDaySet.has(code);
      const hasConflict = conflictSet.has(code);
      if (hasConflict) conflictCount++;
      const notOffered = !commission && !forcedNoDay && !s.isElective && (offMap?.get(code)?.commissions.length ?? 0) === 0;
      const notAvailable = !!(
        commission &&
        availableSlots &&
        !commissionFitsAvailability(commission, availableSlots)
      );

      let day: number | undefined;
      if (commission) {
        day = commission.meetings.length
          ? [...commission.meetings].sort((a, b) => toMinutes(a.start) - toMinutes(b.start))[0].day
          : undefined;
      } else if (forcedNoDay && forcedDay[code] >= 0) {
        day = forcedDay[code];
      }

      const ok = missing.length === 0 && !calendarError && !hasConflict && !forcedNoDay;
      if (!ok) valid = false;
      diags.push({
        code,
        ok,
        missingPrereqs: missing,
        calendarError,
        commission,
        day,
        hasConflict,
        notOffered,
        notAvailable,
        forcedNoDay,
      });
    }

    // Anuales que arrancaron el cuatri anterior y siguen ocupando este.
    const prev = terms[i - 1];
    const continuing: SubjectDiag[] =
      prev?.subjects
        .filter((sd) => graph.byCode.get(sd.code)?.annual)
        .map((sd) => ({ ...sd, missingPrereqs: [], ok: true })) ?? [];

    const count = t.subjects.length + continuing.length;
    const overCapacity = count > settings.maxPerTerm;
    if (overCapacity) valid = false;

    terms.push({
      id: t.id,
      index: i,
      year: cal.year,
      term: cal.term,
      isFirstSemester: cal.isFirstSemester,
      subjects: diags,
      continuing,
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
  const graduation = { year: lastCal.year, month: lastCal.term === 1 ? 7 : 12 };
  const placedCount = manualTerms.reduce((a, t) => a + t.subjects.length, 0);

  return { terms, makespan, years: makespan / 2, graduation, placedCount, valid };
}
