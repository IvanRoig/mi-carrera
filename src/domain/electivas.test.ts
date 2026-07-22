import { describe, it, expect } from 'vitest';
import { graph } from './planGraph';
import { subjects } from '../data/plan';
import ofertaBase from '../data/oferta-base.json';
import type { OfferData } from './conflicts';
import { schedule } from './scheduler';
import { DEFAULT_SETTINGS, TALLER_CODE } from './types';

const offer = ofertaBase as OfferData;
const ELECTIVAS = ['03672', '03673', '03674'];

function planFor(done: string[]) {
  const universe = new Set(subjects.map((s) => s.code).filter((c) => c !== TALLER_CODE));
  const pending = new Set([...universe].filter((c) => !done.includes(c)));
  return schedule({
    graph,
    pending,
    done: new Set(done),
    settings: { ...DEFAULT_SETTINGS },
    offer,
    difficult: new Set(),
  });
}

describe('electivas en el cronograma automático', () => {
  it('cada electiva ubicada trae el nombre real (label) de ese día', () => {
    const sched = planFor(['03621', '03622', '03623', '03624', '03625']);
    for (const code of ELECTIVAS) {
      const comm = sched.commissionByCode.get(code);
      expect(comm?.label, `electiva ${code} sin label`).toBeTruthy();
    }
  });

  it('las 3 electivas quedan en días distintos (no sugiere la misma dos veces)', () => {
    const sched = planFor(['03621', '03622', '03623', '03624', '03625']);
    const days = ELECTIVAS.map((c) => sched.commissionByCode.get(c)?.meetings[0]?.day).filter(
      (d): d is number => d != null,
    );
    expect(days.length).toBe(3);
    expect(new Set(days).size).toBe(3);
  });
});
