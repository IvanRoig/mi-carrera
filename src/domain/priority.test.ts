import { describe, it, expect } from 'vitest';
import { buildGraph } from './graph';
import { computePriorityMetrics, comparePriority } from './priority';
import { makeSubject } from './testUtils';

describe('priority', () => {
  // A encabeza cadena larga (A→B→C), X es una hoja independiente.
  const g = buildGraph([
    makeSubject('A'),
    makeSubject('B', ['A']),
    makeSubject('C', ['B']),
    makeSubject('X'),
  ]);
  const pending = new Set(['A', 'B', 'C', 'X']);
  const m = computePriorityMetrics(g, pending);

  it('prioriza la materia que encabeza la cadena más larga (más cuatris)', () => {
    // comparePriority < 0 significa que el primero va antes.
    expect(comparePriority('A', 'X', m)).toBeLessThan(0);
    expect(comparePriority('A', 'B', m)).toBeLessThan(0);
    expect(comparePriority('B', 'C', m)).toBeLessThan(0);
  });

  it('ordena una lista dejando primero la cadena crítica', () => {
    const order = ['X', 'C', 'B', 'A'].sort((a, b) => comparePriority(a, b, m));
    expect(order[0]).toBe('A');
    expect(order.at(-1)).toBe('X');
  });

  it('a igual cadena, desempata por poder de desbloqueo (descendants)', () => {
    // Dos materias hoja: una con más dependientes gana.
    const g2 = buildGraph([
      makeSubject('P'),
      makeSubject('Q', ['P']),
      makeSubject('R', ['P']),
      makeSubject('S'), // hoja sola
    ]);
    const pend = new Set(['P', 'Q', 'R', 'S']);
    const m2 = computePriorityMetrics(g2, pend);
    // P (cadena 2, desbloquea 2) va antes que S (cadena 1).
    expect(comparePriority('P', 'S', m2)).toBeLessThan(0);
  });
});
