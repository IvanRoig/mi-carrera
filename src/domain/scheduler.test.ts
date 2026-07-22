import { describe, it, expect } from 'vitest';
import { buildGraph } from './graph';
import { schedule, calendarOf, type ScheduleInput } from './scheduler';
import { DEFAULT_SETTINGS, type UserSettings } from './types';
import { makeSubject } from './testUtils';

function settings(over: Partial<UserSettings> = {}): UserSettings {
  return { ...DEFAULT_SETTINGS, startYear: 2026, startTerm: 1, ...over };
}

function run(over: Partial<ScheduleInput>): ReturnType<typeof schedule> {
  const base: ScheduleInput = {
    graph: buildGraph([makeSubject('A')]),
    pending: new Set(['A']),
    done: new Set(),
    settings: settings(),
    ...over,
  };
  return schedule(base);
}

describe('calendarOf', () => {
  it('traduce índices a (año, cuatri)', () => {
    expect(calendarOf(0, 2026, 1)).toMatchObject({ year: 2026, term: 1 });
    expect(calendarOf(1, 2026, 1)).toMatchObject({ year: 2026, term: 2 });
    expect(calendarOf(2, 2026, 1)).toMatchObject({ year: 2027, term: 1 });
    expect(calendarOf(1, 2026, 2)).toMatchObject({ year: 2027, term: 1 });
  });
});

describe('scheduler — precedencias', () => {
  it('respeta una cadena de correlativas (A→B→C) en cuatris sucesivos', () => {
    const g = buildGraph([
      makeSubject('A'),
      makeSubject('B', ['A']),
      makeSubject('C', ['B']),
    ]);
    const r = run({ graph: g, pending: new Set(['A', 'B', 'C']) });
    expect(r.startByCode.get('A')).toBe(0);
    expect(r.startByCode.get('B')).toBe(1);
    expect(r.startByCode.get('C')).toBe(2);
    expect(r.makespan).toBe(3);
  });

  it('nunca agenda una materia antes de terminar sus correlativas', () => {
    const g = buildGraph([
      makeSubject('A'),
      makeSubject('B', ['A']),
      makeSubject('C', ['A', 'B']),
      makeSubject('D', ['C']),
    ]);
    const r = run({
      graph: g,
      pending: new Set(['A', 'B', 'C', 'D']),
      settings: settings({ maxNightSlots: 5 }),
    });
    for (const s of g.subjects) {
      for (const p of s.prereqs) {
        expect(r.finishByCode.get(p)!).toBeLessThan(r.startByCode.get(s.code)!);
      }
    }
  });
});

describe('scheduler — capacidad', () => {
  it('no supera maxNightSlots por cuatrimestre', () => {
    const subs = ['A', 'B', 'C', 'D'].map((c) => makeSubject(c));
    const g = buildGraph(subs);
    const r = run({
      graph: g,
      pending: new Set(['A', 'B', 'C', 'D']),
      settings: settings({ maxNightSlots: 2 }),
    });
    // 4 materias independientes, 2 por cuatri → 2 cuatris.
    expect(r.makespan).toBe(2);
    for (const t of r.terms) {
      expect(t.subjects.length).toBeLessThanOrEqual(2);
    }
  });
});

describe('scheduler — materia anual', () => {
  it('una materia anual ocupa dos cuatrimestres', () => {
    const g = buildGraph([makeSubject('X', [], { annual: true })]);
    const r = run({
      graph: g,
      pending: new Set(['X']),
      settings: settings({ maxNightSlots: 1 }),
    });
    expect(r.startByCode.get('X')).toBe(0);
    expect(r.finishByCode.get('X')).toBe(1); // termina un cuatri después
    expect(r.makespan).toBe(2);
  });

  it('la anual bloquea el slot en su segundo cuatri (capacidad 1)', () => {
    const g = buildGraph([
      makeSubject('X', [], { annual: true }),
      makeSubject('Y'),
    ]);
    const r = run({
      graph: g,
      pending: new Set(['X', 'Y']),
      settings: settings({ maxNightSlots: 1 }),
    });
    // X ocupa cuatri 0 y 1; Y (capacidad 1) recién en cuatri 2.
    expect(r.startByCode.get('X')).toBe(0);
    expect(r.startByCode.get('Y')).toBe(2);
  });

  it('una materia solo-1er-cuatri arranca en un 1er cuatri', () => {
    const g = buildGraph([
      makeSubject('P', [], { startsOnlyFirstSemester: true }),
    ]);
    // startTerm=2 ⇒ cuatri 0 es 2do; debe esperar al cuatri 1 (1er del año siguiente).
    const r = run({
      graph: g,
      pending: new Set(['P']),
      settings: settings({ startTerm: 2, maxNightSlots: 3 }),
    });
    expect(r.startByCode.get('P')).toBe(1);
    expect(calendarOf(1, 2026, 2).isFirstSemester).toBe(true);
  });
});

describe('scheduler — makespan válido', () => {
  it('el cronograma cubre todas las pendientes exactamente una vez', () => {
    const g = buildGraph([
      makeSubject('A'),
      makeSubject('B', ['A']),
      makeSubject('C', ['A']),
      makeSubject('D', ['B', 'C']),
      makeSubject('E'),
    ]);
    const pending = new Set(['A', 'B', 'C', 'D', 'E']);
    const r = run({ graph: g, pending, settings: settings({ maxNightSlots: 2 }) });
    const scheduled = r.terms.flatMap((t) => t.subjects);
    expect(scheduled.sort()).toEqual([...pending].sort());
  });
});
