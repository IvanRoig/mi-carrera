/**
 * scenarios.ts — Generador determinístico de escenarios de prueba.
 *
 * Se usa para validar el simulador: cientos de estados de alumno distintos
 * (con distintas disponibilidades y topes) para comprobar que los planes que
 * arma son válidos y nunca peores que antes.
 */
import { subjects } from '../data/plan';
import { graph } from './planGraph';
import { topoOrder } from './graph';
import { DEFAULT_SETTINGS, TALLER_CODE, type UserSettings } from './types';

export type Scenario = {
  id: number;
  done: string[];
  settings: UserSettings;
};

/** RNG determinístico (mulberry32). */
export function rng32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const ALL_SLOTS: string[] = [];
for (let d = 0; d <= 5; d++) for (const t of ['m', 't', 'n']) ALL_SLOTS.push(`${d}-${t}`);

/** Disponibilidades típicas (más una aleatoria) para cubrir casos reales. */
function availabilityFor(r: () => number): { restrict: boolean; slots: string[] } {
  const kind = Math.floor(r() * 5);
  if (kind === 0) return { restrict: false, slots: [] }; // sin filtro
  if (kind === 1) return { restrict: true, slots: ['0-n', '1-n', '2-n', '3-n', '4-n', '5-t', '5-n'] }; // noches + sábado
  if (kind === 2) return { restrict: true, slots: ['0-n', '1-n', '2-n', '3-n', '4-n'] }; // solo noches
  if (kind === 3) return { restrict: true, slots: ['0-m', '1-m', '2-m', '3-m', '4-m', '5-m'] }; // solo mañanas
  const slots = ALL_SLOTS.filter(() => r() < 0.5);
  return { restrict: true, slots: slots.length ? slots : ['0-n', '1-n', '2-n'] };
}

/**
 * Genera escenarios: aprueba materias en orden topológico (como un alumno real
 * que va avanzando) y varía configuración y disponibilidad.
 */
export function makeScenarios(count: number, seed = 12345): Scenario[] {
  const order = topoOrder(graph).filter((c) => c !== TALLER_CODE);
  const out: Scenario[] = [];
  for (let i = 0; i < count; i++) {
    const r = rng32(seed + i * 7919);
    // Cuántas materias lleva aprobadas (de 0 a casi todas).
    const n = Math.floor(r() * (order.length - 2));
    const done = order.slice(0, n).filter(() => r() < 0.92); // algunos huecos
    const av = availabilityFor(r);
    out.push({
      id: i,
      done,
      settings: {
        ...DEFAULT_SETTINGS,
        maxPerTerm: 4 + Math.floor(r() * 3), // 4..6
        startYear: 2026,
        startTerm: r() < 0.5 ? 1 : 2,
        includeTaller: r() < 0.5,
        restrictAvailability: av.restrict,
        availableSlots: av.slots,
      },
    });
  }
  return out;
}

/** Materias pendientes de un escenario. */
export function pendingOf(sc: Scenario): Set<string> {
  const universe = new Set(
    subjects.map((s) => s.code).filter((c) => sc.settings.includeTaller || c !== TALLER_CODE),
  );
  const done = new Set(sc.done.filter((c) => universe.has(c)));
  return new Set([...universe].filter((c) => !done.has(c)));
}
