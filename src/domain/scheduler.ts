/**
 * scheduler.ts — Simulador que minimiza el makespan (cuatrimestres hasta recibirse).
 *
 * Es un problema de scheduling con precedencias y capacidad (minimizar makespan),
 * NP-hard en general. Usamos el heurístico estándar: LIST SCHEDULING GREEDY por
 * ruta crítica (critical-path), que da resultados muy buenos, seguido de una
 * pasada de MEJORA LOCAL (compactación) para intentar bajar el makespan.
 *
 * Restricciones que respeta:
 *  - Precedencia: una materia solo se agenda cuando todas sus correlativas están
 *    terminadas (aprobadas/regularizadas de entrada, o agendadas en cuatris previos).
 *  - Capacidad: hasta `maxNightSlots` materias en turno noche y `maxNonNightSlots`
 *    fuera del turno noche por cuatrimestre.
 *  - `annual`: ocupa un slot en este cuatri y en el siguiente; solo arranca en 1er cuatri.
 *  - `startsOnlyFirstSemester`: solo puede empezar en un 1er cuatrimestre.
 *  - Choques de horario: opcional, vía `classifyNight` / datos de oferta (ver conflicts.ts).
 */

import type { Subject, UserSettings } from './types';
import type { Graph } from './graph';
import {
  computePriorityMetrics,
  comparePriority,
  priorityScore,
} from './priority';
import { longestDownstreamTerms } from './graph';

export type PlannedTerm = {
  /** Índice absoluto del cuatrimestre (0 = primero planificado). */
  index: number;
  year: number;
  term: 1 | 2;
  isFirstSemester: boolean;
  /** Códigos de materias que ARRANCAN en este cuatrimestre. */
  subjects: string[];
  nightCount: number;
  nonNightCount: number;
  totalHours: number;
};

export type ScheduleResult = {
  terms: PlannedTerm[];
  /** Cantidad de cuatrimestres usados. */
  makespan: number;
  /** Secuencia de materias que determina el makespan (intocables). */
  criticalChain: string[];
  startByCode: Map<string, number>;
  /** Cuatri en que la materia queda terminada (annual = start+1). */
  finishByCode: Map<string, number>;
  /** Estimación de egreso (fin del último cuatri) + trámite. */
  graduation: { year: number; month: number };
};

export type ScheduleInput = {
  graph: Graph;
  /** Materias a planificar (pendientes: no aprobadas, no en curso). */
  pending: Set<string>;
  /** Materias ya terminadas al arrancar (aprobadas ∪ regularizadas ∪ en curso). */
  done: Set<string>;
  settings: UserSettings;
  /**
   * Clasifica si una materia consume slot NOCHE en un cuatri dado.
   * Por defecto todo es noche (la carrera es mayormente nocturna).
   */
  classifyNight?: (code: string, termIndex: number) => boolean;
  /** Escasez de oferta por código (opcional, pondera prioridad). */
  scarcity?: Map<string, number>;
  /** Tope de cuatrimestres para evitar loops (default 40). */
  maxTerms?: number;
};

/** Traduce un índice de cuatrimestre a (año, cuatri) según el inicio. */
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
 * Ejecuta el simulador greedy por ruta crítica y devuelve el cronograma.
 */
export function schedule(input: ScheduleInput): ScheduleResult {
  const { graph, settings } = input;
  const classifyNight = input.classifyNight ?? (() => true);
  const maxTerms = input.maxTerms ?? 40;

  // Estado mutable del algoritmo.
  const pending = new Set(input.pending);
  const done = new Set(input.done);
  const startByCode = new Map<string, number>();
  const finishByCode = new Map<string, number>();
  // Las ya hechas terminan "antes" del cuatri 0.
  for (const c of done) finishByCode.set(c, -1);

  // Ocupación por cuatri (incluye arrastre de materias anuales).
  const nightUsed: number[] = [];
  const nonNightUsed: number[] = [];
  const ensureTerm = (t: number) => {
    while (nightUsed.length <= t) {
      nightUsed.push(0);
      nonNightUsed.push(0);
    }
  };

  const termsSubjects: string[][] = [];

  const sub = (c: string) => graph.byCode.get(c) as Subject;

  let t = 0;
  while (pending.size > 0 && t < maxTerms) {
    ensureTerm(t);
    termsSubjects[t] = termsSubjects[t] ?? [];
    const cal = calendarOf(t, settings.startYear, settings.startTerm);

    // Recalculamos prioridad sobre las pendientes actuales: la ruta crítica
    // RESTANTE cambia a medida que se vacían las pendientes.
    const metrics = computePriorityMetrics(graph, pending, input.scarcity);

    // Materias elegibles este cuatri: correlativas terminadas antes de t.
    const eligible: string[] = [];
    for (const c of pending) {
      const s = sub(c);
      // Restricción de calendario para materias anuales / solo-1er-cuatri.
      if ((s.annual || s.startsOnlyFirstSemester) && !cal.isFirstSemester) {
        continue;
      }
      const reqs = graph.prereqs.get(c) ?? [];
      const ready = reqs.every((p) => (finishByCode.get(p) ?? Infinity) < t);
      if (ready) eligible.push(c);
    }

    eligible.sort((a, b) => comparePriority(a, b, metrics));

    // Empaquetado greedy respetando capacidad.
    for (const c of eligible) {
      const s = sub(c);
      const isNight = classifyNight(c, t);
      const needsNext = s.annual; // anual ocupa t y t+1
      if (needsNext) ensureTerm(t + 1);

      if (isNight) {
        if (nightUsed[t] >= settings.maxNightSlots) continue;
        if (needsNext && nightUsed[t + 1] >= settings.maxNightSlots) continue;
      } else {
        if (nonNightUsed[t] >= settings.maxNonNightSlots) continue;
        if (needsNext && nonNightUsed[t + 1] >= settings.maxNonNightSlots)
          continue;
      }

      // Ubicamos la materia.
      if (isNight) {
        nightUsed[t]++;
        if (needsNext) nightUsed[t + 1]++;
      } else {
        nonNightUsed[t]++;
        if (needsNext) nonNightUsed[t + 1]++;
      }
      startByCode.set(c, t);
      finishByCode.set(c, needsNext ? t + 1 : t);
      termsSubjects[t].push(c);
      pending.delete(c);
    }

    // Si no se pudo agendar nada y todavía quedan pendientes, avanzamos igual
    // (puede ser por materias anuales que liberan slot recién el cuatri próximo).
    t++;
  }

  const result = buildResult(
    graph,
    termsSubjects,
    startByCode,
    finishByCode,
    settings,
    input.done,
  );

  return improve(input, result);
}

/** Construye el objeto ScheduleResult a partir del agendado. */
function buildResult(
  graph: Graph,
  termsSubjects: string[][],
  startByCode: Map<string, number>,
  finishByCode: Map<string, number>,
  settings: UserSettings,
  done: Set<string>,
): ScheduleResult {
  // El makespan es el último cuatri con materia terminada, +1.
  let lastFinish = -1;
  for (const [, f] of finishByCode) if (f > lastFinish) lastFinish = f;
  const makespan = lastFinish + 1;

  const terms: PlannedTerm[] = [];
  for (let i = 0; i < makespan; i++) {
    const codes = termsSubjects[i] ?? [];
    const cal = calendarOf(i, settings.startYear, settings.startTerm);
    let night = 0;
    let nonNight = 0;
    let hours = 0;
    for (const c of codes) {
      hours += graph.byCode.get(c)?.totalHours ?? 0;
      night++; // clasificación fina se hace en la UI; acá contamos ocupación
    }
    terms.push({
      index: i,
      year: cal.year,
      term: cal.term,
      isFirstSemester: cal.isFirstSemester,
      subjects: codes,
      nightCount: night,
      nonNightCount: nonNight,
      totalHours: hours,
    });
  }

  // Egreso: fin del último cuatri + trámite.
  const lastCal = calendarOf(
    Math.max(0, makespan - 1),
    settings.startYear,
    settings.startTerm,
  );
  // 1er cuatri termina ~julio (mes 7), 2do ~diciembre (mes 12).
  const endMonth = lastCal.term === 1 ? 7 : 12;
  const gradAbsMonth =
    lastCal.year * 12 + (endMonth - 1) + settings.degreeProcessingMonths;
  const graduation = {
    year: Math.floor(gradAbsMonth / 12),
    month: (gradAbsMonth % 12) + 1,
  };

  const pending = new Set([...startByCode.keys()]);
  const criticalChain = extractCriticalChain(graph, pending);

  return {
    terms,
    makespan,
    criticalChain,
    startByCode,
    finishByCode,
    graduation,
  };
  // `done` se recibe por si se necesita en el futuro (no se usa acá).
  void done;
}

/**
 * Mejora local: intenta compactar moviendo materias del último cuatri hacia
 * cuatris previos con capacidad libre, respetando precedencia y calendario.
 * Si logra vaciar el último cuatri, el makespan baja.
 */
function improve(input: ScheduleInput, result: ScheduleResult): ScheduleResult {
  const { graph, settings } = input;
  const classifyNight = input.classifyNight ?? (() => true);

  let current = result;
  let improved = true;
  let guard = 0;

  while (improved && guard++ < 20) {
    improved = false;
    const { startByCode, finishByCode, makespan } = current;
    if (makespan <= 1) break;

    // Recalcular ocupación por cuatri.
    const nightUsed: number[] = Array(makespan).fill(0);
    for (const [c, tStart] of startByCode) {
      const s = graph.byCode.get(c)!;
      nightUsed[tStart] = (nightUsed[tStart] ?? 0) + 1;
      if (s.annual && tStart + 1 < makespan) nightUsed[tStart + 1]++;
    }

    const lastTerm = makespan - 1;
    const lastSubjects = [...startByCode.entries()]
      .filter(([, tt]) => tt === lastTerm)
      .map(([c]) => c);

    for (const c of lastSubjects) {
      const s = graph.byCode.get(c)!;
      // Cuatri más temprano posible por precedencia.
      const reqs = graph.prereqs.get(c) ?? [];
      let earliest = 0;
      for (const p of reqs) {
        earliest = Math.max(earliest, (finishByCode.get(p) ?? -1) + 1);
      }
      // Buscar un cuatri < lastTerm con lugar y calendario válido.
      for (let t = earliest; t < lastTerm; t++) {
        const cal = calendarOf(t, settings.startYear, settings.startTerm);
        if ((s.annual || s.startsOnlyFirstSemester) && !cal.isFirstSemester)
          continue;
        if (classifyNight(c, t) && nightUsed[t] >= settings.maxNightSlots)
          continue;
        if (s.annual && nightUsed[t + 1] >= settings.maxNightSlots) continue;
        // Mover.
        startByCode.set(c, t);
        finishByCode.set(c, s.annual ? t + 1 : t);
        nightUsed[t]++;
        if (s.annual) nightUsed[t + 1]++;
        improved = true;
        break;
      }
    }

    if (improved) {
      // Reconstruir termsSubjects.
      const termsSubjects: string[][] = [];
      for (const [c, tStart] of startByCode) {
        termsSubjects[tStart] = termsSubjects[tStart] ?? [];
        termsSubjects[tStart].push(c);
      }
      current = buildResult(
        graph,
        termsSubjects,
        startByCode,
        finishByCode,
        settings,
        input.done,
      );
    }
  }

  return current;
}

/**
 * Extrae la cadena crítica: la secuencia de correlativas pendientes más larga
 * (en cuatrimestres). Si una de estas se atrasa, se atrasa el egreso.
 */
export function extractCriticalChain(
  graph: Graph,
  pending: Set<string>,
): string[] {
  if (pending.size === 0) return [];
  const down = longestDownstreamTerms(graph, pending);

  // Raíces del subgrafo pendiente: sin correlativas pendientes.
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
    // Fallback: nodo con mayor cadena.
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
    let nextScore = -1;
    for (const d of graph.dependents.get(cur) ?? []) {
      if (!pending.has(d)) continue;
      if ((down.get(d) ?? 0) === target) {
        // Elegimos el de mayor cadena para continuar (desempate estable).
        const score = down.get(d) ?? 0;
        if (score > nextScore || (score === nextScore && d < next)) {
          nextScore = score;
          next = d;
        }
      }
    }
    if (!next) break;
    chain.push(next);
    cur = next;
  }
  return chain;
}

/** Score de prioridad expuesto para la UI (ranking de pendientes). */
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
