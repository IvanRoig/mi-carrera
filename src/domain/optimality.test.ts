import { describe, it, expect } from 'vitest';
import { graph } from './planGraph';
import { subjects } from '../data/plan';
import ofertaBase from '../data/oferta-base.json';
import type { OfferData } from './conflicts';
import { schedule } from './scheduler';
import { analizarOptimo, cuelloDeBotella, franjasQueDestraban } from './optimality';
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

  it('demuestra que 6 cuatrimestres es el mínimo (5 es imposible)', () => {
    const t0 = performance.now();
    const v = analizarOptimo(inp);
    const ms = performance.now() - t0;
    console.error(`\nveredicto: ${v.estado} (${ms.toFixed(0)}ms)`);
    if (v.estado === 'optimo') console.error(`  motivo: ${v.motivo}`);
    expect(res.makespan).toBe(6);
    expect(v.estado).toBe('optimo');
  }, 60000);

  it('identifica el cuello de botella (el jueves a la noche)', () => {
    const c = cuelloDeBotella(inp);
    console.error(`\ncuello de botella: ${c?.cantidad} materias en ${c?.franja}`);
    expect(c?.cantidad).toBe(5);
    expect(c?.franja).toBe('3-n'); // jueves noche
  });

  it('detecta que liberando el viernes a la mañana se ahorraría un cuatrimestre', () => {
    const t0 = performance.now();
    const fs = franjasQueDestraban(inp);
    console.error(`\nfranjas que destraban (${(performance.now() - t0).toFixed(0)}ms):`, fs.map((f) => f.etiqueta));
    expect(fs.map((f) => f.slot)).toContain('4-m'); // viernes mañana
  }, 120000);
});

describe('análisis de óptimo: casos generales', () => {
  it('sin filtro de disponibilidad no sugiere franjas', () => {
    const universe = new Set(subjects.map((s) => s.code).filter((c) => c !== TALLER_CODE));
    const inp = {
      graph, pending: universe, settings: { ...DEFAULT_SETTINGS }, offer, actual: 11,
    };
    expect(franjasQueDestraban(inp)).toEqual([]);
  });

  it('no explota sin materias pendientes', () => {
    const inp = {
      graph, pending: new Set<string>(), settings: { ...DEFAULT_SETTINGS }, offer, actual: 0,
    };
    expect(analizarOptimo(inp).estado).toBe('optimo');
    expect(cuelloDeBotella(inp)).toBeNull();
  });
});
