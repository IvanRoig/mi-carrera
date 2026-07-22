/**
 * scheduler.ts — Simulador de cuatrimestres.
 *
 * Objetivo: recibirte en la MENOR cantidad de cuatrimestres, y — con esa meta
 * asegurada — hacer la MENOR cantidad de materias por cuatri de forma pareja.
 *
 * Cómo:
 *  1. `runSchedule(cap)`: list scheduling greedy por ruta crítica + compactación
 *     + balanceo, con un tope de `cap` materias por cuatri.
 *  2. `schedule()`: busca el MENOR `cap` que sigue logrando el makespan mínimo.
 *     Así, si podés recibirte igual de rápido haciendo 5 por cuatri en vez de 6,
 *     arma cuatris de 5 (más parejo, menos exigido), sin atrasar el egreso.
 *
 * Restricciones: precedencia, capacidad, `annual` (ocupa 2 cuatris, solo arranca
 * en 1er cuatri), `startsOnlyFirstSemester` (Proyecto Final), choques de horario y
 * disponibilidad en el cuatri inmediato (con oferta), y tope opcional de difíciles.
 */

import type { Subject, UserSettings } from './types';
import type { Graph } from './graph';
import { computePriorityMetrics, comparePriority, priorityScore } from './priority';
import { longestDownstreamTerms } from './graph';
import type { OfferData, Offering } from './conflicts';
import {
  findConflictFreeAssignment,
  offeringMap,
  commissionFitsAvailability,
} from './conflicts';

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
  offer?: OfferData | null;
  difficult?: Set<string>;
  scarcity?: Map<string, number>;
  maxTerms?: number;
  /** Modo sicario: sin tope de materias por cuatri (lo antes posible). */
  sicario?: boolean;
  /** Materias fijas (prefijo armado a mano): código → índice de cuatri. */
  preScheduled?: Map<string, number>;
  /** Desde qué cuatri empezar a autocompletar (después del prefijo manual). */
  firstFreeTerm?: number;
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

/**
 * Programa balanceado: busca el menor tope por cuatri que igual logra el makespan
 * mínimo. Resultado: carga pareja sin atrasar el egreso.
 */
export function schedule(input: ScheduleInput): ScheduleResult {
  const effectiveMax = input.sicario
    ? Math.max(1, input.pending.size)
    : Math.max(1, input.settings.maxPerTerm);

  if (input.pending.size === 0) return runSchedule(input, effectiveMax);

  const minMakespan = runSchedule(input, effectiveMax).makespan;

  // makespan es no-creciente en el tope, así que hay un umbral: el menor tope que
  // mantiene el makespan mínimo. Búsqueda binaria.
  let lo = 1;
  let hi = effectiveMax;
  while (lo < hi) {
    const mid = Math.floor((lo + hi) / 2);
    if (runSchedule(input, mid).makespan === minMakespan) hi = mid;
    else lo = mid + 1;
  }
  return runSchedule(input, lo);
}

/** Corre el greedy con un tope fijo `cap` de materias por cuatri. */
function runSchedule(input: ScheduleInput, cap: number): ScheduleResult {
  const { graph, settings } = input;
  const maxTerms = input.maxTerms ?? 60;
  const difficult = input.difficult ?? new Set<string>();
  const offMap = input.offer ? offeringMap(input.offer) : null;

  const availableSlots = settings.restrictAvailability
    ? new Set(settings.availableSlots)
    : null;
  const offMap0: Map<string, Offering> | null = (() => {
    if (!offMap) return null;
    if (!availableSlots) return offMap;
    const m = new Map<string, Offering>();
    for (const [code, off] of offMap) {
      m.set(code, {
        ...off,
        commissions: off.commissions.filter((cm) =>
          commissionFitsAvailability(cm, availableSlots),
        ),
      });
    }
    return m;
  })();

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

  // Prefijo fijo (armado a mano): ocupa cuatris y no se mueve.
  const locked = new Set<string>();
  if (input.preScheduled) {
    for (const [c, tt] of input.preScheduled) {
      const s = sub(c);
      if (!s) continue;
      ensureTerm(tt + (s.annual ? 1 : 0));
      startByCode.set(c, tt);
      finishByCode.set(c, tt + (s.annual ? 1 : 0));
      used[tt]++;
      if (s.annual) used[tt + 1]++;
      if (difficult.has(c)) {
        diffUsed[tt]++;
        if (s.annual) diffUsed[tt + 1]++;
      }
      termsSubjects[tt] = termsSubjects[tt] ?? [];
      termsSubjects[tt].push(c);
      pending.delete(c);
      locked.add(c);
    }
  }

  let t = input.firstFreeTerm ?? 0;
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

    const offeredChosen: string[] = [];
    for (const c of eligible) {
      const s = sub(c);
      const needsNext = s.annual;
      if (needsNext) ensureTerm(t + 1);

      if (used[t] >= cap) continue;
      if (needsNext && used[t + 1] >= cap) continue;

      const isDiff = settings.limitDifficult && difficult.has(c);
      if (isDiff) {
        if (diffUsed[t] >= settings.maxDifficultPerTerm) continue;
        if (needsNext && diffUsed[t + 1] >= settings.maxDifficultPerTerm) continue;
      }

      // Cuatri inmediato (índice 0): disponibilidad + choques.
      if (t === 0 && offMap && offMap.has(c)) {
        const fitting = offMap0!.get(c)?.commissions ?? [];
        if (availableSlots && fitting.length === 0) continue;
        const tentative = [...offeredChosen, c];
        if (!findConflictFreeAssignment(tentative, offMap0!)) continue;
        offeredChosen.push(c);
      }

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
  const compacted = improve(input, result, cap, difficult, locked);
  return balance(input, compacted, cap, difficult, locked);
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
  const graduation = { year: lastCal.year, month: lastCal.term === 1 ? 7 : 12 };

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
  locked: Set<string>,
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
      .filter(([c, tt]) => tt === lastTerm && !locked.has(c))
      .map(([c]) => c);

    for (const c of lastSubjects) {
      const s = graph.byCode.get(c)!;
      const reqs = graph.prereqs.get(c) ?? [];
      let earliest = 0;
      for (const p of reqs) earliest = Math.max(earliest, (finishByCode.get(p) ?? -1) + 1);
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

/**
 * Balanceo: sin cambiar el makespan, empareja la carga llenando los cuatris más
 * flojos con materias de los más cargados (respetando precedencia y calendario).
 */
function balance(
  input: ScheduleInput,
  result: ScheduleResult,
  cap: number,
  difficult: Set<string>,
  locked: Set<string>,
): ScheduleResult {
  const { graph, settings } = input;
  const M = result.makespan;
  if (M <= 1 || cap === Infinity) return result;

  const startByCode = new Map(result.startByCode);
  const finishByCode = new Map(result.finishByCode);

  const occ = Array(M).fill(0);
  const started = Array(M).fill(0);
  for (const [c, t] of startByCode) {
    started[t]++;
    occ[t]++;
    const s = graph.byCode.get(c)!;
    if (s.annual && t + 1 < M) occ[t + 1]++;
  }

  const canMove = (c: string, t2: number): boolean => {
    if (locked.has(c)) return false;
    const s = graph.byCode.get(c)!;
    const cur = startByCode.get(c)!;
    if (t2 === cur || t2 < 0 || t2 >= M) return false;
    const cal = calendarOf(t2, settings.startYear, settings.startTerm);
    if ((s.annual || s.startsOnlyFirstSemester) && !cal.isFirstSemester) return false;
    if (s.annual && t2 + 1 >= M) return false;
    // No tocar el cuatri inmediato si hay oferta (para no romper choques/disponibilidad).
    if (input.offer && (t2 === 0 || cur === 0)) return false;
    if (occ[t2] >= cap) return false;
    if (s.annual && occ[t2 + 1] >= cap) return false;
    for (const p of graph.prereqs.get(c) ?? []) {
      if ((finishByCode.get(p) ?? -1) >= t2) return false;
    }
    const newFinish = t2 + (s.annual ? 1 : 0);
    for (const d of graph.dependents.get(c) ?? []) {
      const ds = startByCode.get(d);
      if (ds !== undefined && ds <= newFinish) return false;
    }
    return true;
  };

  const doMove = (c: string, t2: number) => {
    const s = graph.byCode.get(c)!;
    const cur = startByCode.get(c)!;
    started[cur]--;
    occ[cur]--;
    if (s.annual && cur + 1 < M) occ[cur + 1]--;
    started[t2]++;
    occ[t2]++;
    if (s.annual && t2 + 1 < M) occ[t2 + 1]++;
    startByCode.set(c, t2);
    finishByCode.set(c, t2 + (s.annual ? 1 : 0));
  };

  let guard = 0;
  while (guard++ < 500) {
    // Cuatri menos cargado.
    let lo = 0;
    for (let t = 1; t < M; t++) if (started[t] < started[lo]) lo = t;

    // Traer una materia desde cualquier cuatri con carga suficientemente mayor.
    const sources = [...startByCode.entries()]
      .filter(([, t]) => started[t] > started[lo] + 1)
      .sort((a, b) => started[b[1]] - started[a[1]]);

    let moved = false;
    for (const [c] of sources) {
      if (canMove(c, lo)) {
        doMove(c, lo);
        moved = true;
        break;
      }
    }
    if (!moved) break;
  }

  const termsSubjects: string[][] = [];
  for (const [c, t] of startByCode) {
    termsSubjects[t] = termsSubjects[t] ?? [];
    termsSubjects[t].push(c);
  }
  return buildResult(graph, termsSubjects, startByCode, finishByCode, settings, difficult);
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
