/**
 * scheduler.ts — Simulador que minimiza el makespan (cuatrimestres hasta recibirse).
 *
 * Problema de scheduling con precedencias y capacidad (minimizar makespan),
 * NP-hard. Heurístico: LIST SCHEDULING GREEDY por ruta crítica (medida en
 * cuatrimestres) + una pasada de compactación.
 *
 * Restricciones:
 *  - Precedencia: una materia solo entra cuando sus correlativas terminaron.
 *  - Capacidad: hasta `maxPerTerm` materias por cuatri (modo sicario: sin tope,
 *    solo limitado por correlativas y por choques de horario si hay oferta).
 *  - `annual`: ocupa este cuatri y el siguiente; solo arranca en 1er cuatri.
 *  - `startsOnlyFirstSemester`: solo arranca en un 1er cuatrimestre (Proyecto Final).
 *  - Choques de horario: en el cuatri inmediato, si hay oferta cargada, no se
 *    ubican dos materias que no puedan tener comisiones sin solaparse.
 *  - (Opcional) tope de materias "difíciles" por cuatri.
 */

import type { Subject, UserSettings } from './types';
import type { Graph } from './graph';
import { computePriorityMetrics, comparePriority, priorityScore } from './priority';
import { longestDownstreamTerms } from './graph';
import type { OfferData } from './conflicts';
import { findConflictFreeAssignment, offeringMap } from './conflicts';

export type PlannedTerm = {
  index: number;
  year: number;
  term: 1 | 2;
  isFirstSemester: boolean;
  subjects: string[];
  totalHours: number;
  difficultCount: number;
};

export type ScheduleResult = {
  terms: PlannedTerm[];
  makespan: number;
  /** Años equivalentes (cada año = 2 cuatrimestres). */
  years: number;
  criticalChain: string[];
  startByCode: Map<string, number>;
  finishByCode: Map<string, number>;
  graduation: { year: number; month: number };
};

export type ScheduleInput = {
  graph: Graph;
  pending: Set<string>;
  done: Set<string>;
  settings: UserSettings;
  /** Oferta del cuatri inmediato (para choques de horario). */
  offer?: OfferData | null;
  /** Materias marcadas como difíciles. */
  difficult?: Set<string>;
  scarcity?: Map<string, number>;
  maxTerms?: number;
  /** Modo sicario: sin tope de materias por cuatri. */
  sicario?: boolean;
};

export function calendarOf(
  index: number,
  startYear: number,
  startTerm: 1 | 2,
): { year: number; term: 1 | 2; isFirstSemester: boolean } {
  const absolute = startYear * 2 + (startTerm - 1) + index;
  const year = Math.floor(absolute / 2);
  const term = ((absolute % 2) + 1) as 1 | 2;
  return { year, term, isFirstSemester: term === 1 };
}

export function schedule(input: ScheduleInput): ScheduleResult {
  const { graph, settings } = input;
  const maxTerms = input.maxTerms ?? 60;
  const cap = input.sicario ? Infinity : Math.max(1, settings.maxPerTerm);
  const difficult = input.difficult ?? new Set<string>();
  const offMap = input.offer ? offeringMap(input.offer) : null;

  const pending = new Set(input.pending);
  const done = new Set(input.done);
  const startByCode = new Map<string, number>();
  const finishByCode = new Map<string, number>();
  for (const c of done) finishByCode.set(c, -1);

  const used: number[] = [];
  const diffUsed: number[] = [];
  const ensureTerm = (t: number) => {
    while (used.length <= t) {
      used.push(0);
      diffUsed.push(0);
    }
  };

  const termsSubjects: string[][] = [];
  const sub = (c: string) => graph.byCode.get(c) as Subject;

  let t = 0;
  while (pending.size > 0 && t < maxTerms) {
    ensureTerm(t);
    termsSubjects[t] = termsSubjects[t] ?? [];
    const cal = calendarOf(t, settings.startYear, settings.startTerm);

    const metrics = computePriorityMetrics(graph, pending, input.scarcity);

    const eligible: string[] = [];
    for (const c of pending) {
      const s = sub(c);
      if ((s.annual || s.startsOnlyFirstSemester) && !cal.isFirstSemester) continue;
      const reqs = graph.prereqs.get(c) ?? [];
      if (reqs.every((p) => (finishByCode.get(p) ?? Infinity) < t)) eligible.push(c);
    }
    eligible.sort((a, b) => comparePriority(a, b, metrics));

    // Materias ofertadas ya elegidas en este cuatri (para chequear choques).
    const offeredChosen: string[] = [];

    for (const c of eligible) {
      const s = sub(c);
      const needsNext = s.annual;
      if (needsNext) ensureTerm(t + 1);

      // Capacidad.
      if (used[t] >= cap) continue;
      if (needsNext && used[t + 1] >= cap) continue;

      // Tope de difíciles (opcional).
      const isDiff = settings.limitDifficult && difficult.has(c);
      if (isDiff) {
        if (diffUsed[t] >= settings.maxDifficultPerTerm) continue;
        if (needsNext && diffUsed[t + 1] >= settings.maxDifficultPerTerm) continue;
      }

      // Choques de horario en el cuatri inmediato (si hay oferta).
      if (t === 0 && offMap && offMap.has(c)) {
        const tentative = [...offeredChosen, c];
        if (!findConflictFreeAssignment(tentative, offMap)) continue;
        offeredChosen.push(c);
      }

      // Ubicar.
      used[t]++;
      if (needsNext) used[t + 1]++;
      if (isDiff) {
        diffUsed[t]++;
        if (needsNext) diffUsed[t + 1]++;
      }
      startByCode.set(c, t);
      finishByCode.set(c, needsNext ? t + 1 : t);
      termsSubjects[t].push(c);
      pending.delete(c);
    }

    t++;
  }

  const result = buildResult(graph, termsSubjects, startByCode, finishByCode, settings, difficult);
  return improve(input, result, cap, difficult);
}

function buildResult(
  graph: Graph,
  termsSubjects: string[][],
  startByCode: Map<string, number>,
  finishByCode: Map<string, number>,
  settings: UserSettings,
  difficult: Set<string>,
): ScheduleResult {
  let lastFinish = -1;
  for (const [, f] of finishByCode) if (f > lastFinish) lastFinish = f;
  const makespan = lastFinish + 1;

  const terms: PlannedTerm[] = [];
  for (let i = 0; i < makespan; i++) {
    const codes = termsSubjects[i] ?? [];
    const cal = calendarOf(i, settings.startYear, settings.startTerm);
    let hours = 0;
    let diff = 0;
    for (const c of codes) {
      hours += graph.byCode.get(c)?.totalHours ?? 0;
      if (difficult.has(c)) diff++;
    }
    terms.push({
      index: i,
      year: cal.year,
      term: cal.term,
      isFirstSemester: cal.isFirstSemester,
      subjects: codes,
      totalHours: hours,
      difficultCount: diff,
    });
  }

  const lastCal = calendarOf(Math.max(0, makespan - 1), settings.startYear, settings.startTerm);
  const endMonth = lastCal.term === 1 ? 7 : 12;
  const gradAbsMonth = lastCal.year * 12 + (endMonth - 1) + settings.degreeProcessingMonths;
  const graduation = {
    year: Math.floor(gradAbsMonth / 12),
    month: (gradAbsMonth % 12) + 1,
  };

  const pending = new Set([...startByCode.keys()]);
  const criticalChain = extractCriticalChain(graph, pending);

  return {
    terms,
    makespan,
    years: makespan / 2,
    criticalChain,
    startByCode,
    finishByCode,
    graduation,
  };
}

/** Compactación: mueve materias del último cuatri a cuatris previos con lugar. */
function improve(
  input: ScheduleInput,
  result: ScheduleResult,
  cap: number,
  difficult: Set<string>,
): ScheduleResult {
  const { graph, settings } = input;
  let current = result;
  let improved = true;
  let guard = 0;

  while (improved && guard++ < 30) {
    improved = false;
    const { startByCode, finishByCode, makespan } = current;
    if (makespan <= 1) break;

    const used: number[] = Array(makespan).fill(0);
    for (const [c, tStart] of startByCode) {
      const s = graph.byCode.get(c)!;
      used[tStart]++;
      if (s.annual && tStart + 1 < makespan) used[tStart + 1]++;
    }

    const lastTerm = makespan - 1;
    const lastSubjects = [...startByCode.entries()]
      .filter(([, tt]) => tt === lastTerm)
      .map(([c]) => c);

    for (const c of lastSubjects) {
      const s = graph.byCode.get(c)!;
      const reqs = graph.prereqs.get(c) ?? [];
      let earliest = 0;
      for (const p of reqs) earliest = Math.max(earliest, (finishByCode.get(p) ?? -1) + 1);
      // No mover al cuatri inmediato si hay oferta (evita meter choques).
      const minTarget = input.offer ? Math.max(earliest, 1) : earliest;

      for (let t = minTarget; t < lastTerm; t++) {
        const cal = calendarOf(t, settings.startYear, settings.startTerm);
        if ((s.annual || s.startsOnlyFirstSemester) && !cal.isFirstSemester) continue;
        if (used[t] >= cap) continue;
        if (s.annual && used[t + 1] >= cap) continue;
        startByCode.set(c, t);
        finishByCode.set(c, s.annual ? t + 1 : t);
        used[t]++;
        if (s.annual) used[t + 1]++;
        improved = true;
        break;
      }
    }

    if (improved) {
      const termsSubjects: string[][] = [];
      for (const [c, tStart] of startByCode) {
        termsSubjects[tStart] = termsSubjects[tStart] ?? [];
        termsSubjects[tStart].push(c);
      }
      current = buildResult(graph, termsSubjects, startByCode, finishByCode, settings, difficult);
    }
  }

  return current;
}

export function extractCriticalChain(graph: Graph, pending: Set<string>): string[] {
  if (pending.size === 0) return [];
  const down = longestDownstreamTerms(graph, pending);
  const isRoot = (c: string) =>
    (graph.prereqs.get(c) ?? []).every((p) => !pending.has(p));

  let start = '';
  let best = -1;
  for (const c of pending) {
    if (isRoot(c) && (down.get(c) ?? 0) > best) {
      best = down.get(c) ?? 0;
      start = c;
    }
  }
  if (!start) {
    for (const c of pending) {
      if ((down.get(c) ?? 0) > best) {
        best = down.get(c) ?? 0;
        start = c;
      }
    }
  }

  const chain = [start];
  let cur = start;
  while (true) {
    const target = (down.get(cur) ?? 0) - 1;
    let next = '';
    for (const d of graph.dependents.get(cur) ?? []) {
      if (!pending.has(d)) continue;
      if ((down.get(d) ?? 0) === target && (next === '' || d < next)) next = d;
    }
    if (!next) break;
    chain.push(next);
    cur = next;
  }
  return chain;
}

export function rankPending(
  graph: Graph,
  pending: Set<string>,
  scarcity?: Map<string, number>,
): { code: string; score: number }[] {
  const metrics = computePriorityMetrics(graph, pending, scarcity);
  return [...pending]
    .map((code) => ({ code, score: priorityScore(code, metrics) }))
    .sort((a, b) => b.score - a.score);
}
