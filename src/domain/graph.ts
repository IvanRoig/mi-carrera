/**
 * graph.ts — Construcción del DAG de correlativas y métricas estructurales.
 *
 * Convención de aristas: correlativa → materia que la requiere.
 *   - "aguas abajo" (downstream / dependents) de M = lo que M desbloquea.
 *   - "aguas arriba" (upstream / prereqs) de M = lo que M necesita.
 *
 * Métrica clave del proyecto: la ruta crítica se mide en CUATRIMESTRES
 * (niveles de correlatividad), no en horas. El objetivo es recibirse en el
 * menor tiempo posible, y cada eslabón de una cadena de correlativas obliga,
 * como mínimo, un cuatrimestre más. Las horas se usan solo como desempate.
 */

import type { Subject, SubjectStatus, UserState } from './types';

export type Graph = {
  subjects: Subject[];
  byCode: Map<string, Subject>;
  /** correlativa → materias que la requieren (aguas abajo). */
  dependents: Map<string, string[]>;
  /** materia → sus correlativas (aguas arriba). */
  prereqs: Map<string, string[]>;
};

/** Construye el grafo dirigido de correlatividad a partir de las materias. */
export function buildGraph(subjects: Subject[]): Graph {
  const byCode = new Map(subjects.map((s) => [s.code, s]));
  const dependents = new Map<string, string[]>();
  const prereqs = new Map<string, string[]>();

  for (const s of subjects) {
    dependents.set(s.code, dependents.get(s.code) ?? []);
    // Filtramos correlativas que no existan en el plan (p.ej. códigos de plan viejo).
    const validPrereqs = s.prereqs.filter((p) => byCode.has(p));
    prereqs.set(s.code, validPrereqs);
    for (const p of validPrereqs) {
      const arr = dependents.get(p) ?? [];
      arr.push(s.code);
      dependents.set(p, arr);
    }
  }
  return { subjects, byCode, dependents, prereqs };
}

/**
 * Estado de cada materia respecto del usuario.
 * "satisfecha para cursar" = final aprobado O cursada regularizada.
 */
export function computeStatuses(
  graph: Graph,
  user: Pick<UserState, 'approved' | 'regularized' | 'inProgress'>,
): Map<string, SubjectStatus> {
  const approved = new Set(user.approved.map((a) => a.code));
  const regularized = new Set(user.regularized);
  const inProgress = new Set(user.inProgress);
  // Para poder cursar YA, la correlativa debe estar aprobada o regularizada.
  const satisfied = new Set<string>([...approved, ...regularized]);

  const result = new Map<string, SubjectStatus>();
  for (const s of graph.subjects) {
    if (approved.has(s.code)) {
      result.set(s.code, 'approved');
    } else if (inProgress.has(s.code)) {
      result.set(s.code, 'inProgress');
    } else if (regularized.has(s.code)) {
      result.set(s.code, 'regularized');
    } else {
      const reqs = graph.prereqs.get(s.code) ?? [];
      const eligible = reqs.every((p) => satisfied.has(p));
      result.set(s.code, eligible ? 'eligible' : 'blocked');
    }
  }
  return result;
}

/** Orden topológico de los códigos (correlativas antes que dependientes). */
export function topoOrder(graph: Graph): string[] {
  const indeg = new Map<string, number>();
  for (const s of graph.subjects) {
    indeg.set(s.code, (graph.prereqs.get(s.code) ?? []).length);
  }
  const queue = graph.subjects
    .map((s) => s.code)
    .filter((c) => (indeg.get(c) ?? 0) === 0);
  const order: string[] = [];
  while (queue.length) {
    const c = queue.shift()!;
    order.push(c);
    for (const d of graph.dependents.get(c) ?? []) {
      const n = (indeg.get(d) ?? 0) - 1;
      indeg.set(d, n);
      if (n === 0) queue.push(d);
    }
  }
  return order;
}

/**
 * Longitud de la cadena más larga hacia abajo (downstream), en cantidad de
 * materias, contando solo nodos dentro de `included` (si se pasa).
 * Devuelve un mapa código → longitud (incluye el propio nodo si está incluido).
 *
 * Se usa para la ruta crítica en cuatrimestres: la cadena que una materia
 * encabeza fija el mínimo de cuatris restantes.
 */
export function longestDownstreamTerms(
  graph: Graph,
  included?: Set<string>,
): Map<string, number> {
  const inSet = (c: string) => (included ? included.has(c) : true);
  const memo = new Map<string, number>();

  const visit = (code: string): number => {
    if (memo.has(code)) return memo.get(code)!;
    memo.set(code, 0); // guarda anti-ciclos (el plan es DAG, pero por las dudas)
    let best = 0;
    for (const d of graph.dependents.get(code) ?? []) {
      if (!inSet(d)) continue;
      best = Math.max(best, visit(d));
    }
    const val = inSet(code) ? 1 + best : best;
    memo.set(code, val);
    return val;
  };

  const result = new Map<string, number>();
  for (const s of graph.subjects) result.set(s.code, visit(s.code));
  return result;
}

/**
 * Igual que la anterior pero ponderada por horas totales (desempate).
 * Devuelve código → horas de la cadena más larga hacia abajo.
 */
export function longestDownstreamHours(
  graph: Graph,
  included?: Set<string>,
): Map<string, number> {
  const inSet = (c: string) => (included ? included.has(c) : true);
  const memo = new Map<string, number>();

  const visit = (code: string): number => {
    if (memo.has(code)) return memo.get(code)!;
    memo.set(code, 0);
    let best = 0;
    for (const d of graph.dependents.get(code) ?? []) {
      if (!inSet(d)) continue;
      best = Math.max(best, visit(d));
    }
    const hrs = graph.byCode.get(code)?.totalHours ?? 0;
    const val = inSet(code) ? hrs + best : best;
    memo.set(code, val);
    return val;
  };

  const result = new Map<string, number>();
  for (const s of graph.subjects) result.set(s.code, visit(s.code));
  return result;
}

/**
 * Cantidad de materias que dependen transitivamente de cada una (poder de
 * desbloqueo), contando solo nodos dentro de `included` si se pasa.
 */
export function descendantsCount(
  graph: Graph,
  included?: Set<string>,
): Map<string, number> {
  const inSet = (c: string) => (included ? included.has(c) : true);
  const memo = new Map<string, Set<string>>();

  const visit = (code: string): Set<string> => {
    if (memo.has(code)) return memo.get(code)!;
    const acc = new Set<string>();
    memo.set(code, acc);
    for (const d of graph.dependents.get(code) ?? []) {
      if (inSet(d)) acc.add(d);
      for (const t of visit(d)) if (inSet(t)) acc.add(t);
    }
    return acc;
  };

  const result = new Map<string, number>();
  for (const s of graph.subjects) result.set(s.code, visit(s.code).size);
  return result;
}

/**
 * Profundidad de correlatividad hacia arriba (upstream): longitud de la cadena
 * de correlativas por encima. Sirve para ordenar dentro de un cuatrimestre.
 */
export function upstreamDepth(graph: Graph): Map<string, number> {
  const memo = new Map<string, number>();
  const visit = (code: string): number => {
    if (memo.has(code)) return memo.get(code)!;
    memo.set(code, 0);
    let best = 0;
    for (const p of graph.prereqs.get(code) ?? []) {
      best = Math.max(best, visit(p));
    }
    const val = 1 + best;
    memo.set(code, val);
    return val;
  };
  const result = new Map<string, number>();
  for (const s of graph.subjects) result.set(s.code, visit(s.code));
  return result;
}

/** Conjunto de todas las materias aguas arriba (correlativas transitivas). */
export function ancestorsOf(graph: Graph, code: string): Set<string> {
  const acc = new Set<string>();
  const stack = [...(graph.prereqs.get(code) ?? [])];
  while (stack.length) {
    const c = stack.pop()!;
    if (acc.has(c)) continue;
    acc.add(c);
    for (const p of graph.prereqs.get(c) ?? []) stack.push(p);
  }
  return acc;
}

/** Conjunto de todas las materias aguas abajo (dependientes transitivos). */
export function descendantsOf(graph: Graph, code: string): Set<string> {
  const acc = new Set<string>();
  const stack = [...(graph.dependents.get(code) ?? [])];
  while (stack.length) {
    const c = stack.pop()!;
    if (acc.has(c)) continue;
    acc.add(c);
    for (const d of graph.dependents.get(c) ?? []) stack.push(d);
  }
  return acc;
}
