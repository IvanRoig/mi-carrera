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
  turnoOf,
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
  /** Turno donde se muestra (forzado, o el de la comisión). */
  turno?: 'm' | 't' | 'n';
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

export function validateManualPlan(
  graph: Graph,
  done: Set<string>,
  manualTerms: ManualTermInput[],
  settings: UserSettings,
  offer?: OfferData | null,
  difficult?: Set<string>,
  forcedDay: Record<string, number> = {},
  forcedTurno: Record<string, 'm' | 't' | 'n'> = {},
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

    // --- Posición de cada materia: función PURA de su propio día/turno forzado ---
    // Nada depende de las otras materias: mover o sacar una jamás reubica a otra.
    const commByCode = new Map<string, Commission>();
    const dayByCode = new Map<string, number>();
    const forcedNoDaySet = new Set<string>();

    for (const code of t.subjects) {
      const comms = commsOf(code);
      const forced = forcedDay[code];

      // Sin día forzado: posición automática estable (1ra comisión por preferencia).
      if (forced === undefined) {
        if (comms.length > 0) {
          const pick = comms[0];
          commByCode.set(code, pick);
          if (pick.meetings.length) {
            dayByCode.set(
              code,
              [...pick.meetings].sort((a, b) => toMinutes(a.start) - toMinutes(b.start))[0].day,
            );
          }
        }
        continue;
      }

      // Modalidad a distancia (día -1): sin día en la grilla (va a "sin día").
      if (forced === -1) {
        const dist = comms.filter((c) => c.modality === 'distancia' || c.meetings.length === 0);
        if (dist.length > 0) commByCode.set(code, dist[0]);
        else if (comms.length > 0) forcedNoDaySet.add(code);
        continue;
      }

      // Día (y turno) concreto forzado: elegí la comisión de ESE slot, de forma
      // determinística e independiente del resto. Si no hay oferta en ese slot,
      // la materia se queda igual donde la dejaste, marcada como forcedNoDay.
      const ft = forcedTurno[code];
      const onDay = comms.filter((c) =>
        c.meetings.some((m) => m.day === forced && (!ft || turnoOf(toMinutes(m.start)) === ft)),
      );
      if (onDay.length > 0) commByCode.set(code, onDay[0]);
      else if (comms.length > 0) forcedNoDaySet.add(code);
      dayByCode.set(code, forced); // el día que se muestra es SIEMPRE el que forzaste
    }

    // --- Conflictos: simétrico, no mueve nada. Marca a ambas materias que chocan. ---
    const conflictSet = new Set<string>();
    const placed = t.subjects.filter((c) => commByCode.has(c));
    for (let a = 0; a < placed.length; a++) {
      for (let b = a + 1; b < placed.length; b++) {
        if (commissionsOverlap(commByCode.get(placed[a])!, commByCode.get(placed[b])!)) {
          conflictSet.add(placed[a]);
          conflictSet.add(placed[b]);
        }
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

      // El día mostrado sale de dayByCode (el que forzaste, o el de la comisión
      // automática) — nunca se recalcula en base a otras materias.
      let day = dayByCode.get(code);
      if (day === undefined && commission && commission.meetings.length) {
        day = [...commission.meetings].sort((a, b) => toMinutes(a.start) - toMinutes(b.start))[0].day;
      }
      // Turno mostrado: el forzado; si no, el de la comisión en ese día.
      let turno = forcedTurno[code];
      if (!turno && commission && day !== undefined) {
        const m = commission.meetings.find((mm) => mm.day === day) ?? commission.meetings[0];
        if (m) turno = turnoOf(toMinutes(m.start));
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
        turno,
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
