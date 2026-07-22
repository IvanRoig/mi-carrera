import planJson from './plan-estudios.json';
import type { StudyPlan, Subject } from '@/domain/types';

/** Plan de estudios tipado y precargado (común a todos los usuarios). */
export const studyPlan = planJson as StudyPlan;

/** Todas las materias del plan. */
export const subjects: Subject[] = studyPlan.subjects;

/** Índice rápido código → materia. */
export const subjectByCode: Map<string, Subject> = new Map(
  subjects.map((s) => [s.code, s]),
);

/** Devuelve una materia por código (o undefined). */
export function getSubject(code: string): Subject | undefined {
  return subjectByCode.get(code);
}

/** Lista de trayectos únicos, en orden de aparición. */
export const tracks: string[] = [...new Set(subjects.map((s) => s.track))];

/** Años únicos ordenados. */
export const years: number[] = [...new Set(subjects.map((s) => s.year))].sort(
  (a, b) => a - b,
);

/** Códigos de las 3 electivas (placeholders). */
export const electiveCodes: string[] = subjects
  .filter((s) => s.isElective)
  .map((s) => s.code);
