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

  it('días distintos también en un plan DENSO de noche (años 1-3 aprobados)', () => {
    // Tramo final denso: casi todas las noches ocupadas. Antes las electivas
    // caían en el mismo día libre (misma electiva repetida). Ahora no.
    const done = subjects.filter((s) => s.year <= 3).map((s) => s.code);
    const sched = planFor(done);
    const days = ELECTIVAS.map((c) => sched.commissionByCode.get(c)?.meetings[0]?.day).filter(
      (d): d is number => d != null,
    );
    expect(days.length).toBe(3);
    expect(new Set(days).size).toBe(3);
  });

  it('el Proyecto Final se ofrece SIEMPRE los sábados (día 5)', () => {
    const sched = planFor(subjects.filter((s) => s.year <= 3).map((s) => s.code));
    const pfc = sched.commissionByCode.get('03671');
    expect(pfc?.meetings[0]?.day).toBe(5);
  });

  it('si tu disponibilidad no incluye sábado, el PFC igual aparece en sábado (no queda "a distancia")', () => {
    // Disponibilidad solo noches Lun-Vie (sin sábado). El PFC solo se ofrece
    // sábado a la tarde: debe seguir apareciendo ahí, no ocultarse.
    const done = subjects.filter((s) => s.year <= 3).map((s) => s.code);
    const universe = new Set(subjects.map((s) => s.code).filter((c) => c !== TALLER_CODE));
    const pending = new Set([...universe].filter((c) => !done.includes(c)));
    const sched = schedule({
      graph,
      pending,
      done: new Set(done),
      settings: {
        ...DEFAULT_SETTINGS,
        restrictAvailability: true,
        availableSlots: ['0-n', '1-n', '2-n', '3-n', '4-n'],
      },
      offer,
      difficult: new Set(),
    });
    const pfc = sched.commissionByCode.get('03671');
    expect(pfc?.meetings[0]?.day).toBe(5);
  });
});
