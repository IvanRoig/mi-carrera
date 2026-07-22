import { describe, it, expect } from 'vitest';
import { buildGraph } from './graph';
import { validateManualPlan, type ManualTermInput } from './manual';
import { DEFAULT_SETTINGS } from './types';
import { makeSubject } from './testUtils';
import type { Commission, OfferData } from './conflicts';

// Una comisión por día (19:00-23:00), estilo electiva, para poder forzar días.
function comm(id: string, day: number, start = '19:00', end = '23:00'): Commission {
  return { id, meetings: [{ day, start, end }], modality: 'sincronica' };
}

function offer(): OfferData {
  return {
    cuatrimestre: 'test',
    offerings: [
      { code: 'A', commissions: [comm('a-lun', 0), comm('a-mar', 1), comm('a-mie', 2)] },
      { code: 'B', commissions: [comm('b-lun', 0), comm('b-mar', 1), comm('b-mie', 2)] },
      { code: 'C', commissions: [comm('c-lun', 0), comm('c-mar', 1), comm('c-mie', 2)] },
    ],
  };
}

const graph = buildGraph([makeSubject('A'), makeSubject('B'), makeSubject('C')]);
const settings = { ...DEFAULT_SETTINGS, startYear: 2026, startTerm: 1 as const, maxPerTerm: 6 };

function dayOf(diag: ReturnType<typeof validateManualPlan>, code: string): number | undefined {
  return diag.terms[0].subjects.find((s) => s.code === code)?.day;
}

describe('validateManualPlan — estabilidad (nada se mueve solo)', () => {
  it('sacar una materia no cambia el día de las demás', () => {
    const terms: ManualTermInput[] = [{ id: 't0', subjects: ['A', 'B', 'C'] }];
    const forcedDay = { A: 0, B: 1, C: 2 }; // Lun, Mar, Mié
    const forcedTurno = { A: 'n' as const, B: 'n' as const, C: 'n' as const };

    const before = validateManualPlan(graph, new Set(), terms, settings, offer(), new Set(), forcedDay, forcedTurno);
    expect(dayOf(before, 'A')).toBe(0);
    expect(dayOf(before, 'B')).toBe(1);
    expect(dayOf(before, 'C')).toBe(2);

    // Saco B (queda A y C con sus mismos días forzados).
    const after = validateManualPlan(
      graph,
      new Set(),
      [{ id: 't0', subjects: ['A', 'C'] }],
      settings,
      offer(),
      new Set(),
      forcedDay,
      forcedTurno,
    );
    expect(dayOf(after, 'A')).toBe(0); // no se movió
    expect(dayOf(after, 'C')).toBe(2); // no se movió
  });

  it('mover una materia al día de otra no reubica a la otra (marca conflicto)', () => {
    const forcedTurno = { A: 'n' as const, B: 'n' as const };
    // A y B ambas forzadas a Lun/noche → conflicto, pero ninguna cambia de día.
    const diag = validateManualPlan(
      graph,
      new Set(),
      [{ id: 't0', subjects: ['A', 'B'] }],
      settings,
      offer(),
      new Set(),
      { A: 0, B: 0 },
      forcedTurno,
    );
    expect(dayOf(diag, 'A')).toBe(0);
    expect(dayOf(diag, 'B')).toBe(0);
    // Ambas marcadas en conflicto (simétrico).
    const a = diag.terms[0].subjects.find((s) => s.code === 'A')!;
    const b = diag.terms[0].subjects.find((s) => s.code === 'B')!;
    expect(a.hasConflict).toBe(true);
    expect(b.hasConflict).toBe(true);
  });

  it('el día mostrado es SIEMPRE el forzado (no el de la comisión)', () => {
    // Forzar A a Mié: aunque el orden de comisiones empiece por Lun, muestra Mié.
    const diag = validateManualPlan(
      graph,
      new Set(),
      [{ id: 't0', subjects: ['A'] }],
      settings,
      offer(),
      new Set(),
      { A: 2 },
      { A: 'n' },
    );
    expect(dayOf(diag, 'A')).toBe(2);
  });

  it('forzar a un día sin oferta deja la materia en ese día (forcedNoDay)', () => {
    // A no tiene comisión el Jueves (día 3).
    const diag = validateManualPlan(
      graph,
      new Set(),
      [{ id: 't0', subjects: ['A'] }],
      settings,
      offer(),
      new Set(),
      { A: 3 },
      { A: 'n' },
    );
    const a = diag.terms[0].subjects.find((s) => s.code === 'A')!;
    expect(a.day).toBe(3);
    expect(a.forcedNoDay).toBe(true);
  });
});
