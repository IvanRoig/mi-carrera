/**
 * degrees.ts — Título intermedio: Técnico Universitario en Desarrollo de Software.
 *
 * Requisitos (según el usuario):
 *  - Todas las materias de 1° a 3° año.
 *  - Niveles I y II de Inglés Transversal (o sea, NO hacen falta Inglés III y IV).
 * Taller de Integración es optativo, así que no cuenta para el título.
 */
import type { Subject } from './types';

export const INTERMEDIATE_TITLE = 'Técnico Universitario en Desarrollo de Software';

/** Códigos excluidos del requisito del título intermedio. */
const EXCLUDED = new Set([
  '00903', // Inglés Nivel III
  '00904', // Inglés Nivel IV
  '03680', // Taller de Integración (optativo)
]);

/** Conjunto de materias requeridas para el título intermedio. */
export function intermediateRequired(subjects: Subject[]): Set<string> {
  return new Set(
    subjects
      .filter((s) => s.year <= 3 && !EXCLUDED.has(s.code))
      .map((s) => s.code),
  );
}

export type IntermediateProgress = {
  required: number;
  approved: number;
  remaining: number;
  remainingCodes: string[];
  done: boolean;
};

/** Progreso hacia el título intermedio (cuenta finales aprobados). */
export function intermediateProgress(
  subjects: Subject[],
  approvedCodes: Set<string>,
): IntermediateProgress {
  const req = intermediateRequired(subjects);
  const remainingCodes = [...req].filter((c) => !approvedCodes.has(c));
  return {
    required: req.size,
    approved: req.size - remainingCodes.length,
    remaining: remainingCodes.length,
    remainingCodes,
    done: remainingCodes.length === 0,
  };
}
