import { describe, it, expect } from 'vitest';
import { parseDias, normalizeCode, normalizeModality } from './parseOfertaHtml';

describe('parseDias', () => {
  it('parsea un día simple', () => {
    const { meetings } = parseDias('Lu19a23');
    expect(meetings).toEqual([{ day: 0, start: '19:00', end: '23:00' }]);
  });

  it('parsea multi-día con el mismo horario (LuJu17a19)', () => {
    const { meetings } = parseDias('LuJu17a19');
    expect(meetings).toEqual([
      { day: 0, start: '17:00', end: '19:00' },
      { day: 3, start: '17:00', end: '19:00' },
    ]);
  });

  it('reconoce "A distancia"', () => {
    const r = parseDias('A distancia');
    expect(r.distance).toBe(true);
    expect(r.meetings).toEqual([]);
  });

  it('parsea turno mañana (Mi08a12)', () => {
    const { meetings } = parseDias('Mi08a12');
    expect(meetings).toEqual([{ day: 2, start: '08:00', end: '12:00' }]);
  });

  it('distingue Martes (Ma) de Miércoles (Mi)', () => {
    expect(parseDias('Ma14a18').meetings[0].day).toBe(1);
    expect(parseDias('Mi14a18').meetings[0].day).toBe(2);
  });
});

describe('normalizeCode', () => {
  it('completa a 5 dígitos', () => {
    expect(normalizeCode('0901')).toBe('00901');
    expect(normalizeCode('3634')).toBe('03634');
    expect(normalizeCode('03621')).toBe('03621');
  });
});

describe('normalizeModality', () => {
  it('mapea variantes con y sin acento', () => {
    expect(normalizeModality('Semipresencial')).toBe('semipresencial');
    expect(normalizeModality('A distancia')).toBe('distancia');
    expect(normalizeModality('Sincrónica')).toBe('sincronica');
    expect(normalizeModality('Presencial')).toBe('presencial');
  });
});
