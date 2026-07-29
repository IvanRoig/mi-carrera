/**
 * horarios-estables.test.ts — Los mismos cuatris dan siempre los mismos horarios.
 *
 * La asignación de comisiones es un first-fit con backtracking, así que el orden
 * en que le llegan las materias cambia qué comisión le toca a cada una. Y ese
 * orden dependía de cómo habías armado el plan (qué arrastraste, desde qué cuatri
 * autocompletaste), así que el MISMO plan podía mostrarse con horarios distintos
 * de una vez a la otra. Ahora se ordena por código antes de asignar.
 */
import { describe, it, expect } from 'vitest';
import { graph } from './planGraph';
import { subjects } from '../data/plan';
import ofertaBase from '../data/oferta-base.json';
import type { OfferData } from './conflicts';
import { schedule } from './scheduler';
import { DEFAULT_SETTINGS, TALLER_CODE } from './types';

const offer = ofertaBase as OfferData;
const universe = [...subjects.map((s) => s.code).filter((c) => c !== TALLER_CODE)];

/** Firma del plan: qué comisión le tocó a cada materia. */
function firma(res: ReturnType<typeof schedule>) {
  return [...res.commissionByCode.entries()]
    .map(([code, cm]) => `${code}:${cm.meetings.map((m) => `${m.day}-${m.start}`).join('/')}`)
    .sort()
    .join('|');
}

/**
 * Reproduce lo que hace "🪄 completar desde acá": fija los cuatris que ya armaste
 * (via preScheduled) y completa el resto. El orden de `preScheduled` es el orden
 * en que quedaron las materias en cada cuatri del plan manual — y ese orden
 * cambia según cómo lo hayas ido editando.
 */
function completarDesde(
  prefijo: string[][],
  ordenar: (xs: string[]) => string[],
  settings = DEFAULT_SETTINGS,
) {
  const preScheduled = new Map<string, number>();
  prefijo.forEach((codes, i) => ordenar(codes).forEach((c) => preScheduled.set(c, i)));
  const fijadas = new Set(preScheduled.keys());
  const pending = new Set(universe.filter((c) => !fijadas.has(c)));
  return schedule({
    graph,
    pending,
    done: new Set<string>(),
    settings,
    offer,
    difficult: new Set(),
    preScheduled,
    firstFreeTerm: prefijo.length,
  });
}

describe('estabilidad de los horarios', () => {
  // Dos primeros cuatris armados a mano, como si los hubieras dejado fijos.
  const plano = schedule({
    graph,
    pending: new Set(universe),
    done: new Set<string>(),
    settings: DEFAULT_SETTINGS,
    offer,
    difficult: new Set(),
  });
  const prefijo = plano.terms.slice(0, 2).map((t) => [...t.subjects]);

  it('no dependen del orden en que quedaron las materias dentro del cuatri', () => {
    const base = firma(completarDesde(prefijo, (xs) => xs));
    const alRevés = firma(completarDesde(prefijo, (xs) => [...xs].reverse()));
    const porNombre = firma(
      completarDesde(prefijo, (xs) => [...xs].sort((a, b) => b.localeCompare(a))),
    );
    expect(alRevés).toBe(base);
    expect(porNombre).toBe(base);
  });

  it('también con la disponibilidad restringida', () => {
    const settings = {
      ...DEFAULT_SETTINGS,
      restrictAvailability: true,
      availableSlots: ['0-n', '1-n', '2-n', '3-n', '4-n', '5-t', '5-n'],
    };
    expect(firma(completarDesde(prefijo, (xs) => [...xs].reverse(), settings))).toBe(
      firma(completarDesde(prefijo, (xs) => xs, settings)),
    );
  });
});
