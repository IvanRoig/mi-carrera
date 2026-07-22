/**
 * priority.ts — Peso / prioridad de cada materia pendiente.
 *
 * El objetivo SIEMPRE es recibirse en el menor tiempo posible. Por eso el
 * factor dominante es la ruta crítica medida en CUATRIMESTRES: una materia que
 * encabeza una cadena larga de correlativas hay que hacerla lo antes posible,
 * porque define el mínimo de cuatris que quedan.
 *
 * Orden lexicográfico de prioridad (de mayor a menor peso):
 *   1. criticalTerms  — largo de la cadena que encabeza, en cuatrimestres.
 *   2. descendants    — cuántas materias desbloquea (poder de destrabe).
 *   3. scarcity       — qué tan poco se ofrece (si hay datos de oferta).
 *   4. criticalHours  — desempate por horas de la cadena.
 */

import type { Graph } from './graph';
import {
  descendantsCount,
  longestDownstreamHours,
  longestDownstreamTerms,
} from './graph';

export type PriorityMetrics = {
  /** Cuatrimestres de la cadena más larga que encabeza (dentro de pendientes). */
  criticalTerms: Map<string, number>;
  /** Horas de esa cadena (desempate). */
  criticalHours: Map<string, number>;
  /** Cantidad de materias pendientes que dependen de esta. */
  descendants: Map<string, number>;
  /** Escasez de oferta (0 = sin datos / se ofrece siempre). */
  scarcity: Map<string, number>;
};

/**
 * Calcula las métricas de prioridad sobre el subgrafo de materias `pending`
 * (las que todavía no están hechas). Medir sobre pendientes da la ruta crítica
 * RESTANTE, que es lo que importa para el makespan.
 */
export function computePriorityMetrics(
  graph: Graph,
  pending: Set<string>,
  scarcity?: Map<string, number>,
): PriorityMetrics {
  return {
    criticalTerms: longestDownstreamTerms(graph, pending),
    criticalHours: longestDownstreamHours(graph, pending),
    descendants: descendantsCount(graph, pending),
    scarcity: scarcity ?? new Map(),
  };
}

/**
 * Comparador de prioridad. Devuelve < 0 si `a` va ANTES que `b`
 * (mayor prioridad primero). Estable: desempata por código.
 */
export function comparePriority(
  a: string,
  b: string,
  m: PriorityMetrics,
): number {
  const get = (map: Map<string, number>, k: string) => map.get(k) ?? 0;

  const byTerms = get(m.criticalTerms, b) - get(m.criticalTerms, a);
  if (byTerms !== 0) return byTerms;

  const byDesc = get(m.descendants, b) - get(m.descendants, a);
  if (byDesc !== 0) return byDesc;

  const byScarcity = get(m.scarcity, b) - get(m.scarcity, a);
  if (byScarcity !== 0) return byScarcity;

  const byHours = get(m.criticalHours, b) - get(m.criticalHours, a);
  if (byHours !== 0) return byHours;

  return a < b ? -1 : a > b ? 1 : 0;
}

/** Score numérico único (para mostrar/ordenar). Combina las métricas con pesos
 * que preservan el orden lexicográfico en la práctica. */
export function priorityScore(code: string, m: PriorityMetrics): number {
  const terms = m.criticalTerms.get(code) ?? 0;
  const desc = m.descendants.get(code) ?? 0;
  const scarcity = m.scarcity.get(code) ?? 0;
  const hours = m.criticalHours.get(code) ?? 0;
  // Pesos escalonados: cada nivel domina al siguiente en rangos realistas.
  return terms * 100000 + desc * 1000 + scarcity * 100 + hours / 100;
}

/** Explicación legible de por qué una materia pesa. */
export function priorityBreakdown(
  code: string,
  m: PriorityMetrics,
): string {
  const terms = m.criticalTerms.get(code) ?? 0;
  const desc = m.descendants.get(code) ?? 0;
  const scarcity = m.scarcity.get(code) ?? 0;

  const parts: string[] = [];
  if (terms > 1) {
    parts.push(`encabeza una cadena de ${terms} cuatrimestres`);
  } else {
    parts.push('no encadena más correlativas (materia hoja)');
  }
  if (desc > 0) {
    parts.push(`desbloquea ${desc} materia${desc === 1 ? '' : 's'}`);
  }
  if (scarcity > 0) {
    parts.push('se ofrece poco, conviene no dejarla para último momento');
  }
  return parts.join(' · ');
}
