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

  // Disponibilidad horaria (día×turno). Solo se aplica al cuatri inmediato,
  // que es el único con oferta conocida.
  const availableSlots = settings.restrictAvailability
    ? new Set(settings.availableSlots)
    : null;
  // Oferta del cuatri 0 filtrada por disponibilidad.
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

      // Cuatri inmediato: respetar disponibilidad horaria y choques (si hay oferta).
      if (t === 0 && offMap && offMap.has(c)) {
        const fitting = offMap0!.get(c)?.commissions ?? [];
        // Está ofertada pero ninguna comisión entra en tu disponibilidad → se difiere.
        if (availableSlots && fitting.length === 0) continue;
        const tentative = [...offeredChosen, c];
        if (!findConflictFreeAssignment(tentative, offMap0!)) continue;
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
  const compacted = improve(input, result, cap, difficult);
  return balance(input, compacted, cap, difficult);
}

/**
 * Balanceo de carga: sin cambiar el makespan, reparte materias entre cuatris
 * para que no queden algunos con 6 y otros con 2. Solo mueve materias cuya
 * ventana de precedencia lo permite (típicamente hojas que pueden ir más tarde).
 */
function balance(
  input: ScheduleInput,
  result: ScheduleResult,
  cap: number,
  difficult: Set<string>,
): ScheduleResult {
  const { graph, settings } = input;
  const M = result.makespan;
  if (M <= 1 || cap === Infinity) return result;

  const startByCode = new Map(result.startByCode);
  const finishByCode = new Map(result.finishByCode);

  // Ocupación (incluye arrastre de anuales) y cantidad de materias que ARRANCAN.
  const occ = Array(M).fill(0);
  const started = Array(M).fill(0);
  for (const [c, t] of startByCode) {
    started[t]++;
    occ[t]++;
    const s = graph.byCode.get(c)!;
    if (s.annual && t + 1 < M) occ[t + 1]++;
  }

  const canMove = (c: string, t2: number): boolean => {
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
    // Precedencia: correlativas terminadas antes de t2.
    for (const p of graph.prereqs.get(c) ?? []) {
      if ((finishByCode.get(p) ?? -1) >= t2) return false;
    }
    // Dependientes agendados: deben arrancar después de que c termine.
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
  while (guard++ < 300) {
    let hi = 0;
    let lo = 0;
    for (let t = 0; t < M; t++) {
      if (started[t] > started[hi]) hi = t;
      if (started[t] < started[lo]) lo = t;
    }
    if (started[hi] - started[lo] <= 1) break;

    const candidates = [...startByCode.entries()]
      .filter(([, t]) => t === hi)
      .map(([c]) => c);

    // Intentar mover a los cuatris menos cargados primero.
    const targets = [...Array(M).keys()]
      .filter((t) => started[t] < started[hi] - 1)
      .sort((a, b) => started[a] - started[b]);

    let moved = false;
    outer: for (const t2 of targets) {
      for (const c of candidates) {
        if (canMove(c, t2)) {
          doMove(c, t2);
          moved = true;
          break outer;
        }
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
  // Egreso = fin del último cuatrimestre (1er cuatri ≈ julio, 2do ≈ diciembre).
  const graduation = {
    year: lastCal.year,
    month: lastCal.term === 1 ? 7 : 12,
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
