/**
 * scheduler.ts — Simulador de cuatrimestres.
 *
 * Objetivo: recibirte en la MENOR cantidad de cuatrimestres, con carga pareja y
 * — clave — SIN choques de horario: nunca dos materias el mismo día y horario.
 *
 * Cómo:
 *  1. `runSchedule(cap)`: list scheduling greedy por ruta crítica, pero cada
 *     cuatri se arma verificando que exista una asignación de comisiones sin
 *     solapamientos (usa la oferta cargada como referencia para TODOS los cuatris).
 *  2. `schedule()`: busca el menor tope por cuatri que igual logra el makespan
 *     mínimo (carga pareja) y calcula la comisión asignada a cada materia.
 */

import type { Subject, UserSettings } from './types';
import type { Graph } from './graph';
import { computePriorityMetrics, comparePriority, priorityScore } from './priority';
import { longestDownstreamTerms } from './graph';
import type { OfferData, Offering, Commission } from './conflicts';
import {
  findConflictFreeAssignment,
  offeringMap,
  commissionFitsAvailability,
  commissionsOverlap,
  isNightCommission,
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
  /** Comisión (día/horario) asignada a cada materia, sin choques. */
  commissionByCode: Map<string, Commission>;
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
  sicario?: boolean;
  preScheduled?: Map<string, number>;
  firstFreeTerm?: number;
  /** Preferencia de electiva: código de cupo (Electiva I/II/III) → día elegido
   * (0=Lun..4=Vie). Fuerza esa electiva al día elegido. Sin entrada = sin
   * preferencia (el simulador elige el óptimo). */
  electivePref?: Record<string, number>;
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

/** Ordena comisiones por preferencia: primero las de tu disponibilidad, luego noche. */
function preferenceComparator(availableSlots: Set<string> | null) {
  return (a: Commission, b: Commission) => {
    const score = (c: Commission) =>
      (availableSlots ? (commissionFitsAvailability(c, availableSlots) ? 0 : 4) : 0) +
      (isNightCommission(c) ? 0 : 1);
    return score(a) - score(b);
  };
}

/** Prepara los mapas de oferta que usa el scheduler para evitar choques. */
function buildOfferMaps(input: ScheduleInput) {
  const offMap = input.offer ? offeringMap(input.offer) : null;
  const availableSlots = input.settings.restrictAvailability
    ? new Set(input.settings.availableSlots)
    : null;
  if (!offMap) return { offMapPref: null, offMap0: null, availableSlots };

  const cmp = preferenceComparator(availableSlots);
  const base = new Map<string, Offering>();
  for (const [code, o] of offMap) {
    let comms = [...o.commissions].sort(cmp);
    if (availableSlots) {
      // Tu disponibilidad aplica a todos los cuatris. Si la materia tiene alguna
      // comisión que podés, usamos SOLO esas. Si NINGUNA entra (p.ej. el Proyecto
      // Final que solo se ofrece sábados y no marcaste ese slot), dejamos todas:
      // es obligatoria, mejor mostrarla en su día real que ocultarla "a distancia".
      const avail = comms.filter((c) => commissionFitsAvailability(c, availableSlots));
      if (avail.length > 0) comms = avail;
    }
    // Preferencia de electiva: si elegiste una electiva puntual (un día), dejamos
    // SOLO la comisión de ese día, así el simulador la ubica ahí (respetando
    // choques). Sin preferencia, quedan todas y elige la óptima.
    const prefDay = input.electivePref?.[code];
    if (prefDay != null) {
      comms = comms.filter((c) => c.meetings.some((m) => m.day === prefDay));
    }
    base.set(code, { ...o, commissions: comms });
  }
  return { offMapPref: base, offMap0: base, availableSlots };
}

/** ¿Se pueden cursar todas estas materias juntas sin choque de horario? */
function termFeasible(codes: string[], offMap: Map<string, Offering> | null): boolean {
  if (!offMap) return true;
  const offered = codes.filter((c) => (offMap.get(c)?.commissions.length ?? 0) > 0);
  return findConflictFreeAssignment(offered, offMap) !== null;
}

/** RNG determinístico (mulberry32) para reintentos reproducibles. */
function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Cota inferior de makespan: por capacidad y por ruta crítica (lo que sea mayor). */
function lowerBound(input: ScheduleInput, cap: number): number {
  let slots = 0;
  for (const c of input.pending) slots += input.graph.byCode.get(c)?.annual ? 2 : 1;
  const capLB = isFinite(cap) ? Math.ceil(slots / cap) : 1;
  const down = longestDownstreamTerms(input.graph, input.pending);
  let critLB = 0;
  for (const v of down.values()) critLB = Math.max(critLB, v);
  return Math.max(1, capLB, critLB);
}

/** Carga aproximada por día según las materias NO electivas (para elegir los
 * días más libres para las electivas). */
function estimateDayLoad(input: ScheduleInput): Map<number, number> {
  const load = new Map<number, number>();
  if (!input.offer) return load;
  const offMap = offeringMap(input.offer);
  for (const c of input.pending) {
    if (input.graph.byCode.get(c)?.isElective) continue;
    const comms = offMap.get(c)?.commissions ?? [];
    const days = [...new Set(comms.flatMap((cm) => cm.meetings.map((m) => m.day)))];
    for (const d of days) load.set(d, (load.get(d) ?? 0) + 1 / days.length);
  }
  return load;
}

/**
 * Asigna a cada electiva un día DISTINTO (restricción dura, no preferencia): así
 * nunca te sugiere la misma electiva dos veces. Respeta la preferencia que hayas
 * puesto y, para el resto, elige los días más libres. Devuelve un input con
 * `electivePref` completado.
 */
function withDistinctElectiveDays(input: ScheduleInput): ScheduleInput {
  const electivas = [...input.pending].filter((c) => input.graph.byCode.get(c)?.isElective);
  if (electivas.length <= 1 || !input.offer) return input;
  const offMap = offeringMap(input.offer);
  const pref: Record<string, number> = { ...(input.electivePref ?? {}) };
  const used = new Set<number>(Object.values(pref));
  const load = estimateDayLoad(input);
  for (const code of electivas) {
    if (pref[code] != null) continue;
    // días que ESTA electiva ofrece y que ninguna otra ya tomó, del más libre al más cargado
    const offered = [
      ...new Set((offMap.get(code)?.commissions ?? []).flatMap((c) => c.meetings.map((m) => m.day))),
    ];
    const pick = offered
      .filter((d) => !used.has(d))
      .sort((a, b) => (load.get(a) ?? 0) - (load.get(b) ?? 0))[0];
    if (pick != null) {
      pref[code] = pick;
      used.add(pick);
    }
  }
  return { ...input, electivePref: pref };
}

/**
 * Programa óptimo: minimiza el makespan (con reintentos aleatorios para no
 * quedarse en un óptimo local del greedy) y, con esa meta, arma cuatris parejos
 * buscando el menor tope por cuatri que igual la logra.
 */
export function schedule(inputRaw: ScheduleInput): ScheduleResult {
  const input = withDistinctElectiveDays(inputRaw);
  const effectiveMax = input.sicario
    ? Math.max(1, input.pending.size)
    : Math.max(1, input.settings.maxPerTerm);
  const maps = buildOfferMaps(input);

  if (input.pending.size === 0) {
    const r = runSchedule(input, effectiveMax, maps);
    r.commissionByCode = assignAllCommissions(r, maps);
    return r;
  }

  // 1) Mejor makespan: greedy determinístico. Solo reintenta (pocas veces) si no
  //    alcanzó la cota inferior teórica; si ya la alcanzó, es óptimo → no reintenta.
  const lb = lowerBound(input, effectiveMax);
  let bestM = runSchedule(input, effectiveMax, maps).makespan;
  for (let i = 1; i <= 8 && bestM > lb; i++) {
    const m = runSchedule(input, effectiveMax, maps, mulberry32(i * 2654435761)).makespan;
    if (m < bestM) bestM = m;
  }

  // 2) Carga pareja: menor tope que sigue logrando bestM (determinístico).
  let lo = 1;
  let hi = effectiveMax;
  while (lo < hi) {
    const mid = Math.floor((lo + hi) / 2);
    if (runSchedule(input, mid, maps).makespan === bestM) hi = mid;
    else lo = mid + 1;
  }

  const result = runSchedule(input, lo, maps);
  result.commissionByCode = assignAllCommissions(result, maps);
  return result;
}

/** Asigna comisiones SIN choques a cada cuatri del resultado final.
 * Las electivas ya vienen fijadas a un día distinto cada una (ver
 * withDistinctElectiveDays), así que acá basta con una asignación conjunta sin
 * solapamientos: el backtracking ubica al resto de las materias alrededor de las
 * electivas (mismo criterio que usó el packing, así nunca queda un choque). */
function assignAllCommissions(
  result: ScheduleResult,
  maps: ReturnType<typeof buildOfferMaps>,
): Map<string, Commission> {
  const out = new Map<string, Commission>();
  if (!maps.offMapPref) return out;
  result.terms.forEach((t) => {
    const offMap = t.index === 0 ? maps.offMap0! : maps.offMapPref!;
    const offered = t.subjects.filter((c) => (offMap.get(c)?.commissions.length ?? 0) > 0);
    const asg = findConflictFreeAssignment(offered, offMap);
    if (asg) for (const [code, comm] of asg) out.set(code, comm);
  });
  return out;
}

/** Corre el greedy con un tope fijo `cap`, evitando choques en cada cuatri.
 * Con `rng`, aleatoriza el desempate de prioridad (para reintentos). */
function runSchedule(
  input: ScheduleInput,
  cap: number,
  maps: ReturnType<typeof buildOfferMaps>,
  rng?: () => number,
): ScheduleResult {
  const { graph, settings } = input;
  const maxTerms = input.maxTerms ?? 60;
  const difficult = input.difficult ?? new Set<string>();
  const { offMapPref, offMap0 } = maps;

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
    const termOff = t === 0 ? offMap0 : offMapPref;

    const eligible: string[] = [];
    for (const c of pending) {
      const s = sub(c);
      if ((s.annual || s.startsOnlyFirstSemester) && !cal.isFirstSemester) continue;
      const reqs = graph.prereqs.get(c) ?? [];
      if (reqs.every((p) => (finishByCode.get(p) ?? Infinity) < t)) eligible.push(c);
    }
    // Prioridad por ruta crítica; con rng, desempate aleatorio (mantiene el
    // factor dominante pero explora distintos empaquetados).
    if (rng) {
      const crit = metrics.criticalTerms;
      eligible.sort(
        (a, b) => (crit.get(b) ?? 0) - (crit.get(a) ?? 0) || rng() - 0.5,
      );
    } else {
      eligible.sort((a, b) => comparePriority(a, b, metrics));
    }

    // Comisiones ya elegidas este cuatri (para chequear choques, incremental).
    const chosenOffered: string[] = [];
    let chosenComms: Commission[] = [];
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

      // Choques: la materia debe poder cursarse junto con las ya elegidas sin
      // solaparse. First-fit rápido; si falla, un backtracking (raro).
      const comms = termOff?.get(c)?.commissions;
      if (comms && comms.length > 0) {
        const pick = comms.find((cm) => !chosenComms.some((u) => commissionsOverlap(u, cm)));
        if (pick) {
          chosenOffered.push(c);
          chosenComms.push(pick);
        } else {
          const asg = findConflictFreeAssignment([...chosenOffered, c], termOff!);
          if (!asg) continue; // no entra sin choque
          chosenOffered.push(c);
          chosenComms = chosenOffered.map((x) => asg.get(x)!);
        }
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
  const compacted = improve(input, result, cap, difficult, locked, offMapPref);
  return balance(input, compacted, cap, difficult, locked, offMapPref);
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

  return {
    terms,
    makespan,
    years: makespan / 2,
    criticalChain: extractCriticalChain(graph, pending),
    startByCode,
    finishByCode,
    commissionByCode: new Map(),
    graduation,
  };
}

/** Cuatri → códigos (desde startByCode). */
function codesByTerm(startByCode: Map<string, number>, makespan: number): string[][] {
  const out: string[][] = Array.from({ length: makespan }, () => []);
  for (const [c, t] of startByCode) if (t < makespan) out[t].push(c);
  return out;
}

/** Compactación: mueve materias del último cuatri a cuatris previos con lugar. */
function improve(
  input: ScheduleInput,
  result: ScheduleResult,
  cap: number,
  difficult: Set<string>,
  locked: Set<string>,
  offMapPref: Map<string, Offering> | null,
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
    const termCodes = codesByTerm(startByCode, makespan);

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
        if (!termFeasible([...termCodes[t], c], offMapPref)) continue;
        startByCode.set(c, t);
        finishByCode.set(c, s.annual ? t + 1 : t);
        used[t]++;
        if (s.annual) used[t + 1]++;
        termCodes[t].push(c);
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

/** Balanceo: empareja la carga entre cuatris (respetando precedencia y choques). */
function balance(
  input: ScheduleInput,
  result: ScheduleResult,
  cap: number,
  difficult: Set<string>,
  locked: Set<string>,
  offMapPref: Map<string, Offering> | null,
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
  const termCodes = codesByTerm(startByCode, M);

  const canMove = (c: string, t2: number): boolean => {
    if (locked.has(c)) return false;
    const s = graph.byCode.get(c)!;
    const cur = startByCode.get(c)!;
    if (t2 === cur || t2 < 0 || t2 >= M) return false;
    const cal = calendarOf(t2, settings.startYear, settings.startTerm);
    if ((s.annual || s.startsOnlyFirstSemester) && !cal.isFirstSemester) return false;
    if (s.annual && t2 + 1 >= M) return false;
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
    if (!termFeasible([...termCodes[t2], c], offMapPref)) return false;
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
    termCodes[cur] = termCodes[cur].filter((x) => x !== c);
    termCodes[t2].push(c);
    startByCode.set(c, t2);
    finishByCode.set(c, t2 + (s.annual ? 1 : 0));
  };

  let guard = 0;
  while (guard++ < 500) {
    let lo = 0;
    for (let t = 1; t < M; t++) if (started[t] < started[lo]) lo = t;
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
