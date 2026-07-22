import { describe, it, expect } from 'vitest';
import { graph } from './planGraph';
import { subjects } from '../data/plan';
import ofertaBase from '../data/oferta-base.json';
import { commissionsOverlap, type OfferData } from './conflicts';
import { schedule } from './scheduler';
import { DEFAULT_SETTINGS, TALLER_CODE } from './types';

const offer = ofertaBase as OfferData;

function noOverlapsPerTerm(done: string[]) {
  const universe = new Set(subjects.map((s) => s.code).filter((c) => c !== TALLER_CODE));
  const pending = new Set([...universe].filter((c) => !done.includes(c)));
  const sched = schedule({
    graph,
    pending,
    done: new Set(done),
    settings: {
      ...DEFAULT_SETTINGS,
      restrictAvailability: true,
      // Solo noche Lun-Vie + sábado tarde/noche (como el caso del usuario)
      availableSlots: ['0-n', '1-n', '2-n', '3-n', '4-n', '5-t', '5-n'],
    },
    offer,
    difficult: new Set(),
  });
  for (const t of sched.terms) {
    const comms = t.subjects
      .map((c) => sched.commissionByCode.get(c))
      .filter((x): x is NonNullable<typeof x> => !!x);
    for (let a = 0; a < comms.length; a++) {
      for (let b = a + 1; b < comms.length; b++) {
        const overlap = commissionsOverlap(comms[a], comms[b]);
        expect(overlap, `choque en ${t.year}-${t.term}: ${t.subjects[a]} vs ${t.subjects[b]}`).toBe(false);
      }
    }
  }
}

describe('scheduler: sin solapamientos de horario (disponibilidad solo noche)', () => {
  it('años 1-3 aprobados', () => noOverlapsPerTerm(subjects.filter((s) => s.year <= 3).map((s) => s.code)));
  it('solo 1er año aprobado', () => noOverlapsPerTerm(subjects.filter((s) => s.year <= 1).map((s) => s.code)));
  it('años 1-2 aprobados', () => noOverlapsPerTerm(subjects.filter((s) => s.year <= 2).map((s) => s.code)));
});
