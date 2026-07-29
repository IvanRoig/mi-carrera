/**
 * scheduler-optimo.test.ts — Qué tan bueno es el plan que arma.
 *
 * Incluye el caso real que motivó la mejora: con disponibilidad solo de noche,
 * 5 materias se dan únicamente los jueves. El greedy por ruta crítica elegía mal
 * cuál poner el jueves y el Proyecto Final se iba un año entero para atrás.
 */
import { describe, it, expect } from 'vitest';
import { graph } from './planGraph';
import { subjects } from '../data/plan';
import ofertaBase from '../data/oferta-base.json';
import type { OfferData } from './conflicts';
import { schedule, calendarOf } from './scheduler';
import { problemasDelPlan } from './planCheck';
import { DEFAULT_SETTINGS, TALLER_CODE } from './types';
import { makeScenarios, pendingOf } from './scenarios';

const offer = ofertaBase as OfferData;
const NOCHES_Y_SABADO = ['0-n', '1-n', '2-n', '3-n', '4-n', '5-t', '5-n'];
const PFC = '03671';

// Estado real: le faltan estas 26 materias, cursa de noche y sábado.
const PENDIENTES = [
  'Física II', 'Requisitos Avanzados', 'Seguridad de la Información',
  'Virtualización de Hardware', 'Responsabilidad Social Universitaria', 'Autómatas y Gramáticas',
  'Arquitectura de Sistemas Software', 'Sistemas Operativos Avanzados', 'Gestión de Proyectos',
  'Programación Avanzada', 'Auditoría y Legislación', 'Inteligencia Artificial',
  'Gestión Aplicada al Desarrollo de Software I', 'Lenguajes y Compiladores',
  'Gestión Aplicada al Desarrollo de Software II', 'Gestión de la Calidad en Procesos de Sistemas',
  'Innovación y Emprendedorismo', 'Inteligencia Artificial Aplicada', 'Ciencia de Datos',
  'Proyecto Final de Carrera', 'Matemática Aplicada', 'Programación Concurrente',
  'Seguridad Aplicada y Forensia', 'Electiva I', 'Electiva II', 'Electiva III',
];

describe('caso real: cursando de noche, con el jueves saturado', () => {
  const byName = new Map(subjects.map((s) => [s.name, s]));
  const pending = new Set(PENDIENTES.map((n) => byName.get(n)!.code));
  const done = new Set(subjects.map((s) => s.code).filter((c) => !pending.has(c)));
  const settings = {
    ...DEFAULT_SETTINGS,
    startYear: 2026,
    startTerm: 2 as const,
    maxPerTerm: 6,
    restrictAvailability: true,
    availableSlots: NOCHES_Y_SABADO,
  };
  const res = schedule({ graph, pending, done, settings, offer, difficult: new Set() });

  it('arranca el Proyecto Final en 2028 (antes se iba a 2029)', () => {
    const inicio = res.startByCode.get(PFC)!;
    const cal = calendarOf(inicio, settings.startYear, settings.startTerm);
    expect(cal.year).toBe(2028);
    expect(cal.term).toBe(1);
  });

  it('termina en 6 cuatrimestres o menos (antes 7)', () => {
    expect(res.makespan).toBeLessThanOrEqual(6);
  });

  it('el plan es válido y cursable', () => {
    expect(problemasDelPlan({ res, pending, settings, offer })).toEqual([]);
  });
});

describe('qué tan cerca del óptimo teórico queda', () => {
  it('la mayoría de los planes alcanzan la cota inferior', () => {
    // La cota inferior por capacidad y ruta crítica es lo mínimo teórico posible:
    // si el plan la alcanza, es demostrablemente óptimo.
    const scs = makeScenarios(200, 777);
    let optimos = 0;
    let total = 0;
    for (const sc of scs) {
      const pending = pendingOf(sc);
      if (pending.size === 0) continue;
      const res = schedule({
        graph, pending, done: new Set(sc.done), settings: sc.settings, offer, difficult: new Set(),
      });
      // Cota por capacidad y por cadena de correlativas (sin horarios).
      let slots = 0;
      for (const c of pending) slots += graph.byCode.get(c)?.annual ? 2 : 1;
      const capLB = Math.ceil(slots / sc.settings.maxPerTerm);
      const memo = new Map<string, number>();
      const depth = (c: string): number => {
        if (memo.has(c)) return memo.get(c)!;
        memo.set(c, 1);
        let best = 0;
        for (const p of graph.prereqs.get(c) ?? []) if (pending.has(p)) best = Math.max(best, depth(p));
        const v = (graph.byCode.get(c)?.annual ? 2 : 1) + best;
        memo.set(c, v);
        return v;
      };
      let critLB = 0;
      for (const c of pending) critLB = Math.max(critLB, depth(c));
      const lb = Math.max(1, capLB, critLB);
      total++;
      if (res.makespan <= lb) optimos++;
    }
    const pct = (optimos / total) * 100;
    console.error(`\nóptimo demostrable en ${optimos}/${total} escenarios (${pct.toFixed(0)}%)`);
    expect(pct).toBeGreaterThan(60);
  }, 60000);
});

describe('casos límite', () => {
  const base = { graph, done: new Set<string>(), offer, difficult: new Set<string>() };

  it('sin materias pendientes no explota', () => {
    const r = schedule({ ...base, pending: new Set(), settings: { ...DEFAULT_SETTINGS } });
    expect(r.makespan).toBe(0);
    expect(r.terms).toEqual([]);
  });

  it('una sola materia entra en un cuatri', () => {
    const r = schedule({ ...base, pending: new Set(['03621']), settings: { ...DEFAULT_SETTINGS } });
    expect(r.makespan).toBe(1);
  });

  it('modo sicario: no es más largo que el normal', () => {
    const universe = new Set(subjects.map((s) => s.code).filter((c) => c !== TALLER_CODE));
    const normal = schedule({ ...base, pending: new Set(universe), settings: { ...DEFAULT_SETTINGS } });
    const sicario = schedule({ ...base, pending: new Set(universe), settings: { ...DEFAULT_SETTINGS }, sicario: true });
    expect(sicario.makespan).toBeLessThanOrEqual(normal.makespan);
  });

  it('con disponibilidad imposible (nada marcado) igual arma un plan válido', () => {
    const universe = new Set(subjects.map((s) => s.code).filter((c) => c !== TALLER_CODE));
    const settings = { ...DEFAULT_SETTINGS, restrictAvailability: true, availableSlots: [] };
    const r = schedule({ ...base, pending: new Set(universe), settings });
    expect(r.makespan).toBeGreaterThan(0);
    // Todas ubicadas, sin perder ninguna.
    const ubicadas = new Set(r.terms.flatMap((t) => t.subjects));
    expect(ubicadas.size).toBe(universe.size);
  });

  it('respeta las materias ya fijadas (preScheduled)', () => {
    const universe = new Set(subjects.map((s) => s.code).filter((c) => c !== TALLER_CODE));
    const fijadas = new Map([['03621', 0], ['03623', 0]]);
    const resto = new Set([...universe].filter((c) => !fijadas.has(c)));
    const r = schedule({ ...base, pending: resto, settings: { ...DEFAULT_SETTINGS }, preScheduled: fijadas, firstFreeTerm: 1 });
    expect(r.startByCode.get('03621')).toBe(0);
    expect(r.startByCode.get('03623')).toBe(0);
  });
});

describe('estabilidad', () => {
  it('es determinista: la misma entrada da siempre el mismo plan', () => {
    for (const sc of makeScenarios(120, 999)) {
      const pending = pendingOf(sc);
      const run = () =>
        schedule({
          graph, pending: new Set(pending), done: new Set(sc.done),
          settings: sc.settings, offer, difficult: new Set(),
        });
      const a = run();
      const b = run();
      expect(a.makespan, `escenario ${sc.id}`).toBe(b.makespan);
      expect(a.terms.map((t) => [...t.subjects].sort().join(',')).join('|')).toBe(
        b.terms.map((t) => [...t.subjects].sort().join(',')).join('|'),
      );
    }
  }, 60000);
});
