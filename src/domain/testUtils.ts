import type { Subject } from './types';

/** Helper para construir materias sintéticas en los tests. */
export function makeSubject(
  code: string,
  prereqs: string[] = [],
  extra: Partial<Subject> = {},
): Subject {
  return {
    code,
    name: `Materia ${code}`,
    year: 1,
    prereqs,
    weeklyHours: 4,
    totalHours: 64,
    track: 'Test',
    annual: false,
    startsOnlyFirstSemester: false,
    isElective: false,
    ...extra,
  };
}
