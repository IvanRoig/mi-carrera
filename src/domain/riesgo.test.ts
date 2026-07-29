/**
 * riesgo.test.ts — "¿Cuáles no puedo desaprobar?" con el caso real.
 *
 * Este análisis estuvo roto de dos formas distintas y las dos se ven acá:
 *
 *  1. A las materias en curso se les aplicaba el filtro de disponibilidad. Con
 *     "solo noches", las seis que este alumno cursa de verdad se peleaban por
 *     cuatro días, así que sacar una del primer cuatrimestre volvía el problema
 *     imposible para CUALQUIER duración. Ya te inscribiste: tu disponibilidad no
 *     corresponde aplicarla ahí.
 *  2. La búsqueda tardaba más de un minuto y dejaba materias "sin determinar".
 *     Con las ventanas propagadas a punto fijo, el mismo caso se resuelve entero
 *     en milisegundos.
 */
import { describe, it, expect } from 'vitest';
import { graph } from './planGraph';
import { subjects } from '../data/plan';
import ofertaBase from '../data/oferta-base.json';
import type { OfferData } from './conflicts';
import { analizarRiesgo } from './optimality';
import { DEFAULT_SETTINGS } from './types';

const offer = ofertaBase as OfferData;
const byName = new Map(subjects.map((s) => [s.name, s]));
const cod = (n: string) => byName.get(n)!.code;

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

const settings = {
  ...DEFAULT_SETTINGS, startYear: 2026, startTerm: 2 as const, maxPerTerm: 6,
  restrictAvailability: true, availableSlots: ['0-n', '1-n', '2-n', '3-n', '4-n', '5-t', '5-n'],
};
const inp = {
  graph,
  pending: new Set(PENDIENTES.map(cod)),
  settings,
  offer,
  actual: 6,
  enCurso: EN_CURSO.map(cod),
};

describe('análisis de riesgo del cuatrimestre en curso', () => {
  const t0 = Date.now();
  const riesgos = analizarRiesgo(inp, inp.enCurso);
  const tardo = Date.now() - t0;
  const por = new Map(riesgos.map((r) => [r.code, r]));

  it('responde por las seis, sin dejar ninguna sin determinar', () => {
    expect(riesgos).toHaveLength(6);
    for (const c of inp.enCurso) {
      expect(por.get(c)?.atraso, `${graph.byCode.get(c)?.name} sin determinar`).not.toBeNull();
    }
  });

  it('las que encabezan la cadena crítica no se pueden desaprobar', () => {
    // Seguridad de la Información → Gestión de Proyectos → Gestión de la Calidad
    // → Proyecto Final: sin margen. Requisitos Avanzados, lo mismo.
    expect(por.get(cod('Seguridad de la Información'))!.atraso).toBe(1);
    expect(por.get(cod('Requisitos Avanzados'))!.atraso).toBe(1);
  });

  it('las que tienen aire dicen hasta cuándo podés dejarlas', () => {
    const rsu = por.get(cod('Responsabilidad Social Universitaria'))!;
    expect(rsu.atraso).toBe(0);
    expect(rsu.limite).toBeGreaterThan(0);
  });

  it('es rápido: el caso entero en menos de dos segundos', () => {
    // Con el modelo roto tardaba 72 s y dejaba dos sin resolver; ahora son ~20 ms.
    // El margen es generoso para no volverse molesto en máquinas lentas.
    expect(tardo).toBeLessThan(2000);
  });
});
