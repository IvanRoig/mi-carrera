import { describe, it, expect } from 'vitest';
import { graph } from './planGraph';
import { subjects } from '../data/plan';
import ofertaBase from '../data/oferta-base.json';
import type { OfferData } from './conflicts';
import { schedule } from './scheduler';
import { buscarMinimo, cuelloDeBotella } from './optimality';
import { DEFAULT_SETTINGS, TALLER_CODE } from './types';

const offer = ofertaBase as OfferData;
const NOCHES_Y_SABADO = ['0-n', '1-n', '2-n', '3-n', '4-n', '5-t', '5-n'];

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

describe('análisis de óptimo (caso real: solo noches + sábado)', () => {
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
  const inp = { graph, pending, settings, offer, actual: res.makespan };

  const t0 = performance.now();
  const r = buscarMinimo(inp);
  const ms = performance.now() - t0;

  it('demuestra que 6 cuatrimestres es el mínimo (5 es imposible)', () => {
    console.error(`\nmínimo demostrado: ${r.minimo} (${ms.toFixed(0)}ms)`);
    console.error(`  motivo: ${r.motivo}`);
    expect(res.makespan).toBe(6);
    expect(r.minimo).toBe(6);
    expect(r.plan).toBeNull(); // no hay nada mejor que aplicar
  }, 120000);

  it('identifica el cuello de botella (el jueves a la noche)', () => {
    const c = cuelloDeBotella(inp);
    console.error(`\ncuello de botella: ${c?.cantidad} materias en ${c?.franja}`);
    expect(c?.cantidad).toBe(5);
    expect(c?.franja).toBe('3-n'); // jueves noche
  });

  it('detecta que liberando el viernes a la mañana se ahorraría un cuatrimestre', () => {
    console.error('\nfranjas que destraban:', r.franjas.map((f) => f.etiqueta));
    expect(r.franjas.map((f) => f.slot)).toContain('4-m'); // viernes mañana
  }, 120000);

  it('si le decimos que el actual es peor, encuentra el plan de 6 y lo devuelve', () => {
    // Simulamos un plan malo de 7: debe encontrar que se puede en 6 y darnos el plan.
    const peor = buscarMinimo({ ...inp, actual: 7 });
    expect(peor.minimo).toBe(6);
    expect(peor.plan).not.toBeNull();
    // El plan devuelto usa exactamente 6 cuatrimestres y ubica todas las materias.
    const cuatris = new Set([...peor.plan!.values()].map((v) => v.t));
    expect(peor.plan!.size).toBe(pending.size);
    expect(Math.max(...cuatris)).toBeLessThanOrEqual(5);
  }, 120000);
});

describe('análisis de óptimo: casos generales', () => {
  it('sin filtro de disponibilidad no sugiere franjas', () => {
    const universe = new Set(subjects.map((s) => s.code).filter((c) => c !== TALLER_CODE));
    const r = buscarMinimo({
      graph, pending: universe, settings: { ...DEFAULT_SETTINGS }, offer, actual: 11,
    });
    expect(r.franjas).toEqual([]);
  }, 300000);

  it('no explota sin materias pendientes', () => {
    const inp = {
      graph, pending: new Set<string>(), settings: { ...DEFAULT_SETTINGS }, offer, actual: 0,
    };
    expect(buscarMinimo(inp).minimo).toBe(0);
    expect(cuelloDeBotella(inp)).toBeNull();
  });
});

describe('respeta la electiva que elegiste a mano', () => {
  const byName2 = new Map(subjects.map((s) => [s.name, s]));
  const pend = new Set(PENDIENTES.map((n) => byName2.get(n)!.code));
  const settings2 = {
    ...DEFAULT_SETTINGS, startYear: 2026, startTerm: 2 as const, maxPerTerm: 6,
    restrictAvailability: true, availableSlots: NOCHES_Y_SABADO,
  };

  it('el plan que propone ubica la electiva en el día que pediste', () => {
    const pref = { '03672': 3 }; // Electiva I → Jueves
    const r = buscarMinimo({
      graph, pending: pend, settings: settings2, offer, actual: 7, electivePref: pref,
    });
    expect(r.plan).not.toBeNull();
    const e1 = r.plan!.get('03672');
    expect(e1?.slot?.startsWith('3-')).toBe(true); // jueves
  }, 120000);

  it('avisa cuánto te cuesta fijar una electiva en un día saturado', () => {
    const pref = { '03672': 3 };
    const r = buscarMinimo({
      graph, pending: pend, settings: settings2, offer, actual: 6, electivePref: pref,
    });
    // Con la electiva fijada al jueves no baja de 6; sin fijarla, tampoco menos.
    expect(r.minimo).toBe(6);
  }, 120000);
});
