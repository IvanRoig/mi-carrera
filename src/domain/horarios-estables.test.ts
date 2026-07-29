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
import { scarcityFromOffer } from './conflicts';
import { DEFAULT_SETTINGS, TALLER_CODE } from './types';

const offer = ofertaBase as OfferData;
const universe = [...subjects.map((s) => s.code).filter((c) => c !== TALLER_CODE)];
const scarcity = scarcityFromOffer(offer);

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
    scarcity,
  });
}

describe('estabilidad de los horarios', () => {
  // El plan automático, igual que lo calcula la app.
  const plano = schedule({
    graph,
    pending: new Set(universe),
    done: new Set<string>(),
    settings: DEFAULT_SETTINGS,
    offer,
    difficult: new Set(),
    scarcity,
  });
  const prefijo = plano.terms.slice(0, 2).map((t) => [...t.subjects]);

  // Con "solo noches" el reparto es apretado y ahí sí se nota si el
  // autocompletado usa las mismas prioridades que el plan automático.
  const noches = {
    ...DEFAULT_SETTINGS,
    restrictAvailability: true,
    availableSlots: ['0-n', '1-n', '2-n', '3-n', '4-n', '5-t', '5-n'],
  };
  const porCuatri = (terms: { subjects: string[] }[]) =>
    terms.map((t) => [...t.subjects].sort().join('+')).join(' || ');

  it('completar desde el primer cuatri devuelve el mismo plan automático', () => {
    // Fijar el primer cuatri y autocompletar el resto plantea el MISMO problema
    // que el plan automático, así que tiene que dar el mismo resultado. Antes no:
    // el automático pesaba la escasez de la oferta (cuántas comisiones tiene cada
    // materia) y el autocompletado no, así que el primer toque te devolvía otro
    // plan sin que hubieras cambiado nada.
    const auto = schedule({
      graph,
      pending: new Set(universe),
      done: new Set<string>(),
      settings: noches,
      offer,
      difficult: new Set(),
      scarcity,
    });
    const soloPrimero = auto.terms.slice(0, 1).map((t) => [...t.subjects]);
    const completado = completarDesde(soloPrimero, (xs) => xs, noches);
    expect(porCuatri(completado.terms)).toBe(porCuatri(auto.terms));
  });

  it('repetirlo no cambia nada', () => {
    const soloPrimero = plano.terms.slice(0, 1).map((t) => [...t.subjects]);
    const a = firma(completarDesde(soloPrimero, (xs) => xs));
    const b = firma(completarDesde(soloPrimero, (xs) => xs));
    expect(b).toBe(a);
  });

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
