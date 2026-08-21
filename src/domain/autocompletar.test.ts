/**
 * autocompletar.test.ts — El verano no se borra.
 *
 * "🪄 Completar desde acá" reconstruía los cuatrimestres del prefijo perdiendo la
 * marca de verano, así que un verano se convertía en un cuatrimestre regular (y
 * su materia pasaba a tener horario, cuando el verano justamente no lo tiene).
 * Y usaba el índice del array como número de cuatrimestre, lo que corría todo el
 * calendario un lugar cuando había un verano en el prefijo.
 */
import { describe, it, expect } from 'vitest';
import { graph } from './planGraph';
import { subjects } from '../data/plan';
import ofertaBase from '../data/oferta-base.json';
import { scarcityFromOffer, type OfferData } from './conflicts';
import { completarDesde, type TramoManual } from './autocompletar';
import { DEFAULT_SETTINGS, TALLER_CODE } from './types';

const offer = ofertaBase as OfferData;
const byName = new Map(subjects.map((s) => [s.name, s]));
const cod = (n: string) => byName.get(n)!.code;
const universe = new Set(subjects.map((s) => s.code).filter((c) => c !== TALLER_CODE));

/** Estado chico y realista: unas pocas materias por delante. */
const PENDIENTES = [
  'Sistemas Operativos Avanzados',
  'Gestión de la Calidad en Procesos de Sistemas',
  'Virtualización de Hardware',
  'Inteligencia Artificial',
  'Ciencia de Datos',
  'Inglés Nivel II',
];
const pending = new Set(PENDIENTES.map(cod));
const done = new Set([...universe].filter((c) => !pending.has(c)));
const ctx = {
  graph,
  pending,
  done,
  settings: { ...DEFAULT_SETTINGS, startYear: 2026, startTerm: 2 as const, maxPerTerm: 3 },
  offer,
  scarcity: scarcityFromOffer(offer),
};

/** Plan con un verano en el medio, como el de la captura del reporte. */
const conVerano = (): TramoManual[] => [
  { subjects: [cod('Sistemas Operativos Avanzados'), cod('Gestión de la Calidad en Procesos de Sistemas')] },
  { subjects: [cod('Inglés Nivel II')], summer: true },
  { subjects: [] },
];

describe('completar desde acá', () => {
  it('no borra el cuatrimestre de verano al completar DESDE el verano', () => {
    const { terms } = completarDesde(conVerano(), 1, ctx);
    expect(terms[1].summer, 'el verano dejó de ser verano').toBe(true);
    expect(terms[1].subjects).toEqual([cod('Inglés Nivel II')]);
  });

  it('tampoco lo borra al completar desde un cuatri POSTERIOR al verano', () => {
    const { terms } = completarDesde(conVerano(), 2, ctx);
    expect(terms[1].summer).toBe(true);
    expect(terms[1].subjects).toEqual([cod('Inglés Nivel II')]);
  });

  it('el verano no corre el calendario: los cuatris nuevos siguen al último regular', () => {
    // El prefijo tiene UN cuatrimestre regular (índice 0) y un verano. Lo que se
    // agregue tiene que arrancar en el cuatrimestre regular 1, no en el 2.
    const { res } = completarDesde(conVerano(), 1, ctx);
    const regularesDelPrefijo = 1;
    for (let i = 0; i < regularesDelPrefijo; i++) {
      expect(res.terms[i].subjects.length).toBeGreaterThan(0);
    }
    // Y la materia de verano no aparece en ningún cuatrimestre regular.
    for (const t of res.terms) {
      expect(t.subjects).not.toContain(cod('Inglés Nivel II'));
    }
  });

  it('lo que se cursa en verano habilita las correlativas de lo que sigue', () => {
    const { terms } = completarDesde(conVerano(), 1, ctx);
    const ubicadas = new Set(terms.flatMap((t) => t.subjects));
    // Todas las pendientes quedan ubicadas: si el verano no contara como hecho,
    // lo que dependa de esa materia no podría entrar.
    for (const c of pending) expect(ubicadas.has(c), `${c} quedó sin ubicar`).toBe(true);
  });

  it('tampoco lo borra al completar desde un cuatri ANTERIOR al verano', () => {
    // El verano queda dentro de la cola que se rearma. Como el simulador nunca
    // inventa veranos, rearmarlo solo puede borrarlo: se conserva donde estaba.
    const conVeranoDespues: TramoManual[] = [
      { subjects: [cod('Sistemas Operativos Avanzados')] },
      { subjects: [cod('Gestión de la Calidad en Procesos de Sistemas')] },
      { subjects: [cod('Inglés Nivel II')], summer: true },
      { subjects: [] },
    ];
    const { terms } = completarDesde(conVeranoDespues, 0, ctx);
    const veranos = terms.filter((t) => t.summer);
    expect(veranos).toHaveLength(1);
    expect(veranos[0].subjects).toEqual([cod('Inglés Nivel II')]);
  });

  it('nunca duplica ni pierde materias', () => {
    for (const desde of [0, 1, 2]) {
      const { terms } = completarDesde(conVerano(), desde, ctx);
      const todas = terms.flatMap((t) => t.subjects);
      expect(new Set(todas).size, `desde ${desde}: hay duplicadas`).toBe(todas.length);
      for (const c of pending) {
        expect(todas.includes(c), `desde ${desde}: falta ${c}`).toBe(true);
      }
    }
  });

  it('sin veranos se comporta igual que antes', () => {
    const plano: TramoManual[] = [
      { subjects: [cod('Sistemas Operativos Avanzados')] },
      { subjects: [] },
    ];
    const { terms } = completarDesde(plano, 0, ctx);
    expect(terms[0].subjects).toEqual([cod('Sistemas Operativos Avanzados')]);
    expect(terms.some((t) => t.summer)).toBe(false);
    const ubicadas = new Set(terms.flatMap((t) => t.subjects));
    for (const c of pending) expect(ubicadas.has(c), `${c} quedó sin ubicar`).toBe(true);
  });
});
