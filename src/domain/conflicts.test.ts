import { describe, it, expect } from 'vitest';
import {
  commissionsOverlap,
  commissionFitsAvailability,
  turnoOf,
  toMinutes,
  type Commission,
} from './conflicts';

function comm(meetings: [number, string, string][], modality: Commission['modality'] = 'presencial'): Commission {
  return { id: 'x', modality, meetings: meetings.map(([day, start, end]) => ({ day, start, end })) };
}

describe('turnoOf', () => {
  it('clasifica mañana/tarde/noche', () => {
    expect(turnoOf(toMinutes('08:00'))).toBe('m');
    expect(turnoOf(toMinutes('14:00'))).toBe('t');
    expect(turnoOf(toMinutes('19:00'))).toBe('n');
  });
});

describe('commissionsOverlap (multi-encuentro)', () => {
  it('detecta choque en uno de varios días', () => {
    const a = comm([[0, '17:00', '19:00'], [3, '17:00', '19:00']]); // Lun y Jue
    const b = comm([[3, '18:00', '22:00']]); // Jue
    expect(commissionsOverlap(a, b)).toBe(true);
  });
  it('no choca si son días distintos', () => {
    const a = comm([[0, '19:00', '23:00']]);
    const b = comm([[1, '19:00', '23:00']]);
    expect(commissionsOverlap(a, b)).toBe(false);
  });
  it('a distancia nunca choca', () => {
    const a = comm([[0, '19:00', '23:00']], 'distancia');
    const b = comm([[0, '19:00', '23:00']]);
    expect(commissionsOverlap(a, b)).toBe(false);
  });
});

describe('commissionFitsAvailability', () => {
  const disponibilidad = new Set(['0-n', '1-n', '2-n', '3-n', '4-n', '4-m']); // noche + viernes mañana

  it('acepta noche si está disponible', () => {
    expect(commissionFitsAvailability(comm([[0, '19:00', '23:00']]), disponibilidad)).toBe(true);
  });
  it('rechaza una materia a la mañana no disponible (ej. Física II lunes mañana)', () => {
    expect(commissionFitsAvailability(comm([[0, '08:00', '12:00']]), disponibilidad)).toBe(false);
  });
  it('acepta RSU el viernes a la mañana (marcado disponible)', () => {
    expect(commissionFitsAvailability(comm([[4, '08:00', '12:00']]), disponibilidad)).toBe(true);
  });
  it('a distancia siempre entra', () => {
    expect(commissionFitsAvailability(comm([], 'distancia'), disponibilidad)).toBe(true);
  });
});
