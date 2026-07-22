import { describe, it, expect } from 'vitest';
import {
  buildGraph,
  computeStatuses,
  longestDownstreamTerms,
  descendantsCount,
  upstreamDepth,
} from './graph';
import { makeSubject } from './testUtils';

describe('buildGraph', () => {
  it('arma dependientes y correlativas correctamente', () => {
    const g = buildGraph([
      makeSubject('A'),
      makeSubject('B', ['A']),
      makeSubject('C', ['B']),
    ]);
    expect(g.dependents.get('A')).toEqual(['B']);
    expect(g.dependents.get('B')).toEqual(['C']);
    expect(g.prereqs.get('C')).toEqual(['B']);
  });

  it('ignora correlativas que no existen en el plan (p.ej. plan viejo)', () => {
    const g = buildGraph([makeSubject('A', ['99999'])]);
    expect(g.prereqs.get('A')).toEqual([]);
  });
});

describe('computeStatuses', () => {
  const subjects = [
    makeSubject('A'),
    makeSubject('B', ['A']),
    makeSubject('C', ['B']),
  ];
  const g = buildGraph(subjects);

  it('marca aprobada, elegible y bloqueada según correlativas', () => {
    const st = computeStatuses(g, {
      approved: [{ code: 'A', grade: 8 }],
      regularized: [],
      inProgress: [],
    });
    expect(st.get('A')).toBe('approved');
    expect(st.get('B')).toBe('eligible'); // A aprobada → B elegible
    expect(st.get('C')).toBe('blocked'); // B no hecha → C bloqueada
  });

  it('una correlativa regularizada habilita a cursar la siguiente', () => {
    const st = computeStatuses(g, {
      approved: [],
      regularized: ['A'],
      inProgress: [],
    });
    expect(st.get('A')).toBe('regularized');
    expect(st.get('B')).toBe('eligible');
  });
});

describe('métricas del grafo', () => {
  const g = buildGraph([
    makeSubject('A'),
    makeSubject('B', ['A']),
    makeSubject('C', ['B']),
    makeSubject('D', ['A']), // rama corta
  ]);

  it('longestDownstreamTerms mide la cadena en cuatrimestres', () => {
    const terms = longestDownstreamTerms(g);
    expect(terms.get('A')).toBe(3); // A → B → C
    expect(terms.get('B')).toBe(2); // B → C
    expect(terms.get('C')).toBe(1); // hoja
    expect(terms.get('D')).toBe(1);
  });

  it('descendantsCount cuenta dependientes transitivos', () => {
    const desc = descendantsCount(g);
    expect(desc.get('A')).toBe(3); // B, C, D
    expect(desc.get('B')).toBe(1); // C
    expect(desc.get('C')).toBe(0);
  });

  it('upstreamDepth mide el nivel de correlatividad', () => {
    const depth = upstreamDepth(g);
    expect(depth.get('A')).toBe(1);
    expect(depth.get('B')).toBe(2);
    expect(depth.get('C')).toBe(3);
  });

  it('longestDownstreamTerms sobre subconjunto (pendientes)', () => {
    // Si A ya está hecha, la cadena pendiente arranca en B.
    const pending = new Set(['B', 'C', 'D']);
    const terms = longestDownstreamTerms(g, pending);
    expect(terms.get('B')).toBe(2); // B → C
    expect(terms.get('D')).toBe(1);
  });
});
