import { describe, it, expect } from 'vitest';
import { buildGraph } from './graph';
import { validateManualPlan, SUMMER_MAX, type ManualTermInput } from './manual';
import { DEFAULT_SETTINGS } from './types';
import { makeSubject } from './testUtils';

// A → B (correlativa), T1/T2 transversales, AN anual.
const graph = buildGraph([
  makeSubject('A'),
  makeSubject('B', ['A']),
  makeSubject('C'),
  makeSubject('T1', [], { track: 'Transversal' }),
  makeSubject('T2', [], { track: 'Transversal' }),
  makeSubject('AN', [], { annual: true }),
]);

const settings = { ...DEFAULT_SETTINGS, startYear: 2026, startTerm: 1 as const, maxPerTerm: 6 };

function run(terms: ManualTermInput[], forcedDay = {}, forcedTurno = {}) {
  return validateManualPlan(graph, new Set(), terms, settings, null, new Set(), forcedDay, forcedTurno);
}

describe('cuatrimestre de verano (intensivo)', () => {
  it('se ubica entre el 2° cuatri y el 1° del año siguiente, con ese año', () => {
    const diag = run([
      { id: 't0', subjects: [] }, // 1° cuatri 2026
      { id: 't1', subjects: [] }, // 2° cuatri 2026
      { id: 'v', subjects: [], summer: true }, // Verano 2027
      { id: 't2', subjects: [] }, // 1° cuatri 2027
    ]);
    expect(diag.terms[2].summer).toBe(true);
    expect(diag.terms[2].year).toBe(2027);
    // El verano NO consume un cuatri regular: el siguiente sigue siendo 1°/2027.
    expect(diag.terms[3]).toMatchObject({ year: 2027, term: 1, summer: false });
  });

  it(`avisa si ponés más de ${SUMMER_MAX} materias`, () => {
    const diag = run([{ id: 'v', subjects: ['A', 'C', 'T1'], summer: true }]);
    expect(diag.terms[0].overCapacity).toBe(true);
    expect(diag.terms[0].summerErrors?.join(' ')).toContain('hasta 2 materias');
    expect(diag.valid).toBe(false);
  });

  it('no deja dos materias correlativas entre sí', () => {
    const diag = run([{ id: 'v', subjects: ['A', 'B'], summer: true }]);
    expect(diag.terms[0].summerErrors?.join(' ')).toContain('correlativa');
    expect(diag.valid).toBe(false);
  });

  it('no deja dos transversales (Inglés/Computación)', () => {
    const diag = run([{ id: 'v', subjects: ['T1', 'T2'], summer: true }]);
    expect(diag.terms[0].summerErrors?.join(' ')).toContain('transversal');
    expect(diag.valid).toBe(false);
  });

  it('no deja materias anuales en el verano', () => {
    const diag = run([{ id: 'v', subjects: ['AN'], summer: true }]);
    expect(diag.terms[0].subjects[0].calendarError).toContain('anual');
  });

  it('acepta dos materias válidas sin quejarse de la oferta', () => {
    const diag = run([{ id: 'v', subjects: ['A', 'C'], summer: true }], { A: 0, C: 1 }, { A: 'n', C: 'n' });
    expect(diag.terms[0].summerErrors).toBeUndefined();
    expect(diag.valid).toBe(true);
    for (const sd of diag.terms[0].subjects) {
      expect(sd.notOffered).toBe(false);
      expect(sd.forcedNoDay).toBe(false);
      expect(sd.ok).toBe(true);
    }
    // El día elegido se respeta tal cual.
    expect(diag.terms[0].subjects.find((s) => s.code === 'A')?.day).toBe(0);
  });

  it('sigue valiendo una materia por franja: dos en el mismo día y turno chocan', () => {
    const diag = run([{ id: 'v', subjects: ['A', 'C'], summer: true }], { A: 0, C: 0 }, { A: 'n', C: 'n' });
    expect(diag.terms[0].conflictCount).toBe(2);
  });

  it('lo aprobado en verano habilita correlativas en el cuatri siguiente', () => {
    const diag = run([
      { id: 'v', subjects: ['A'], summer: true },
      { id: 't', subjects: ['B'] },
    ]);
    expect(diag.terms[1].subjects[0].missingPrereqs).toEqual([]);
    expect(diag.terms[1].subjects[0].ok).toBe(true);
  });

  it('el verano no suma medio año a la duración de la carrera', () => {
    const sinVerano = run([{ id: 't0', subjects: ['A'] }, { id: 't1', subjects: ['C'] }]);
    const conVerano = run([
      { id: 't0', subjects: ['A'] },
      { id: 't1', subjects: ['C'] },
      { id: 'v', subjects: ['T1'], summer: true },
    ]);
    expect(conVerano.years).toBe(sinVerano.years);
  });
});
