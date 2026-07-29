/**
 * encurso.test.ts — Las materias que estás cursando ocupan el cuatrimestre actual.
 *
 * Antes se las contaba como aprobadas: salían del plan y el simulador empezaba
 * de nuevo en el MISMO cuatrimestre, llegando a agendar una materia junto a su
 * propia correlativa (p.ej. Gestión de Proyectos en el mismo cuatri que
 * Seguridad de la Información, que es su previa).
 */
import { describe, it, expect } from 'vitest';
import { graph } from './planGraph';
import { subjects } from '../data/plan';
import ofertaBase from '../data/oferta-base.json';
import { commissionsOverlap, type OfferData } from './conflicts';
import { schedule, calendarOf } from './scheduler';
import { DEFAULT_SETTINGS, TALLER_CODE } from './types';

const offer = ofertaBase as OfferData;
const byName = new Map(subjects.map((s) => [s.name, s]));
const cod = (n: string) => byName.get(n)!.code;

// Estado real: 26 materias por delante; 6 de ellas ya inscriptas para el 2C2026.
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
const EN_CURSO = [
  'Física II', 'Requisitos Avanzados', 'Seguridad de la Información',
  'Virtualización de Hardware', 'Responsabilidad Social Universitaria', 'Autómatas y Gramáticas',
];

const universe = new Set(subjects.map((s) => s.code).filter((c) => c !== TALLER_CODE));
const pendientes = new Set(PENDIENTES.map(cod));
const enCurso = EN_CURSO.map(cod);
const done = new Set([...universe].filter((c) => !pendientes.has(c)));
const settings = {
  ...DEFAULT_SETTINGS, startYear: 2026, startTerm: 2 as const, maxPerTerm: 6,
  restrictAvailability: true, availableSlots: ['0-n', '1-n', '2-n', '3-n', '4-n', '5-t', '5-n'],
};

/** Igual que hace la app: lo que cursás ahora va fijo en el primer cuatri. */
function planConEnCurso() {
  const resto = new Set([...pendientes].filter((c) => !enCurso.includes(c)));
  return schedule({
    graph, pending: resto, done, settings, offer, difficult: new Set(),
    preScheduled: new Map(enCurso.map((c) => [c, 0])),
    firstFreeTerm: 1,
  });
}

describe('materias en curso', () => {
  const res = planConEnCurso();

  it('el primer cuatrimestre del plan es el que estás cursando', () => {
    expect(new Set(res.terms[0].subjects)).toEqual(new Set(enCurso));
    const cal = calendarOf(0, settings.startYear, settings.startTerm);
    expect(cal.year).toBe(2026);
    expect(cal.term).toBe(2);
  });

  it('nunca agenda una materia en el mismo cuatri que su correlativa en curso', () => {
    // Gestión de Proyectos requiere Seguridad de la Información (que está en curso).
    const gestion = res.startByCode.get(cod('Gestión de Proyectos'))!;
    const seguridad = res.finishByCode.get(cod('Seguridad de la Información'))!;
    expect(gestion).toBeGreaterThan(seguridad);
    // Y en general: toda correlativa termina antes de que arranque la materia.
    for (const [code, inicio] of res.startByCode) {
      for (const p of graph.prereqs.get(code) ?? []) {
        if (!pendientes.has(p)) continue;
        expect(res.finishByCode.get(p)!, `${p} antes de ${code}`).toBeLessThan(inicio);
      }
    }
  });

  it('les asigna horario aunque no entren en tu disponibilidad', () => {
    // A lo que ya cursás no le aplica el filtro de turnos (ya te inscribiste), y
    // si aun así el cuatri no cierra se ubica lo que entre. Antes fallaba la
    // asignación conjunta y las SEIS quedaban sin horario: la grilla vacía.
    for (const c of enCurso) {
      expect(res.commissionByCode.get(c), `${c} sin horario`).toBeDefined();
    }
    // Y las que sí tienen horario no se pisan entre ellas.
    const comms = enCurso.map((c) => res.commissionByCode.get(c)!);
    for (let i = 0; i < comms.length; i++)
      for (let j = i + 1; j < comms.length; j++)
        expect(commissionsOverlap(comms[i], comms[j])).toBe(false);
  });

  it('no infla la duración: sigue dando 6 cuatrimestres', () => {
    // Con las 26 como pendientes normales el mínimo es 6; marcar 6 de ellas como
    // "en curso" describe lo mismo, así que no debe cambiar el total.
    expect(res.makespan).toBe(6);
  });
});
