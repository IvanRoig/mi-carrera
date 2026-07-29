/**
 * scheduler-quality.test.ts — Red de seguridad del simulador.
 *
 * Corre 400 escenarios distintos (estados de alumno, disponibilidades y topes)
 * y verifica:
 *   1. Que TODO plan sea válido y cursable (correlativas, anuales, tope, horarios).
 *   2. Que NUNCA sea peor que el algoritmo anterior (en los casos donde el
 *      anterior daba un plan válido; donde daba uno imposible, no hay nada que
 *      comparar).
 *   3. Que sea rápido.
 */
import { describe, it, expect } from 'vitest';
import { graph } from './planGraph';
import ofertaBase from '../data/oferta-base.json';
import baseline from './__fixtures__/scheduler-baseline.json';
import type { OfferData } from './conflicts';
import { schedule } from './scheduler';
import { makeScenarios, pendingOf } from './scenarios';
import { problemasDelPlan } from './planCheck';

const offer = ofertaBase as OfferData;
const SCENARIOS = makeScenarios(400);
const base = new Map(baseline.rows.map((r) => [r.id, r]));

const resultados = SCENARIOS.map((sc) => {
  const pending = pendingOf(sc);
  const t0 = performance.now();
  const res = schedule({
    graph, pending, done: new Set(sc.done), settings: sc.settings, offer, difficult: new Set(),
  });
  return { sc, pending, res, ms: performance.now() - t0 };
});

describe('calidad del simulador (400 escenarios)', () => {
  it('todos los planes son válidos y cursables', () => {
    const fallas: string[] = [];
    for (const { sc, pending, res } of resultados) {
      const p = problemasDelPlan({ res, pending, settings: sc.settings, offer });
      if (p.length) fallas.push(`escenario ${sc.id}: ${p.slice(0, 2).join(' | ')}`);
    }
    if (fallas.length) console.error(fallas.slice(0, 10).join('\n'));
    expect(fallas).toEqual([]);
  });

  it('nunca es peor que el algoritmo anterior', () => {
    const peores: string[] = [];
    let mejores = 0;
    let ahorro = 0;
    let comparables = 0;
    for (const { sc, res } of resultados) {
      const antes = base.get(sc.id);
      if (!antes || !antes.valido) continue; // el anterior daba un plan imposible
      comparables++;
      if (res.makespan > antes.makespan) peores.push(`escenario ${sc.id}: ${antes.makespan} → ${res.makespan}`);
      if (res.makespan < antes.makespan) {
        mejores++;
        ahorro += antes.makespan - res.makespan;
      }
    }
    console.error(
      `\ncomparables: ${comparables}/${resultados.length} · mejoró en ${mejores} (${ahorro} cuatrimestres ahorrados)`,
    );
    if (peores.length) console.error('EMPEORÓ:\n' + peores.slice(0, 10).join('\n'));
    expect(peores).toEqual([]);
  });

  it('arregla los planes imposibles que armaba antes', () => {
    const antesInvalidos = baseline.rows.filter((r) => !r.valido).map((r) => r.id);
    console.error(`\nel algoritmo anterior armaba ${antesInvalidos.length} planes imposibles; ahora: 0`);
    expect(antesInvalidos.length).toBeGreaterThan(0);
    for (const id of antesInvalidos) {
      const r = resultados.find((x) => x.sc.id === id)!;
      const p = problemasDelPlan({ res: r.res, pending: r.pending, settings: r.sc.settings, offer });
      expect(p, `escenario ${id}`).toEqual([]);
    }
  });

  it('es rápido', () => {
    const total = resultados.reduce((a, r) => a + r.ms, 0);
    const prom = total / resultados.length;
    const peor = Math.max(...resultados.map((r) => r.ms));
    console.error(`\npromedio ${prom.toFixed(2)}ms · peor caso ${peor.toFixed(1)}ms`);
    expect(prom).toBeLessThan(40);
    expect(peor).toBeLessThan(400);
  });
});
