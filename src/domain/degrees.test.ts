import { describe, it, expect } from 'vitest';
import { subjects } from '../data/plan';
import { intermediateRequired, intermediateProgress } from './degrees';

describe('título intermedio', () => {
  it('requiere materias de 1° a 3° excluyendo Inglés III/IV y Taller', () => {
    const req = intermediateRequired(subjects);
    // No incluye Inglés III (00903), Inglés IV (00904) ni Taller (03680).
    expect(req.has('00903')).toBe(false);
    expect(req.has('00904')).toBe(false);
    expect(req.has('03680')).toBe(false);
    // Sí incluye Inglés I y II.
    expect(req.has('00901')).toBe(true);
    expect(req.has('00902')).toBe(true);
    // No incluye materias de 4° o 5°.
    expect(req.has('03671')).toBe(false); // Proyecto Final (5°)
  });

  it('cuenta el progreso con finales aprobados', () => {
    const req = intermediateRequired(subjects);
    const allApproved = new Set(req);
    const p = intermediateProgress(subjects, allApproved);
    expect(p.remaining).toBe(0);
    expect(p.done).toBe(true);

    const none = intermediateProgress(subjects, new Set());
    expect(none.remaining).toBe(req.size);
    expect(none.done).toBe(false);
  });
});
