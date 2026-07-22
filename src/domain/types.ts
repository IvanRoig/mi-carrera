/**
 * Tipos del dominio del planificador de carrera (UNLaM · Ing. en Informática · plan 2023-2).
 * Estos tipos son la fuente de verdad para todo el resto de la app.
 */

/** Una materia del plan de estudios (dato común a todos los usuarios). */
export type Subject = {
  /** Código UNLaM, p.ej. "03621". */
  code: string;
  name: string;
  /** Año sugerido en el plan (1..5). */
  year: number;
  /** Códigos de materias correlativas necesarias para cursar. */
  prereqs: string[];
  weeklyHours: number;
  totalHours: number;
  /** Trayecto / orientación de la materia. */
  track: string;
  /** Ocupa los dos cuatrimestres del año (materia anual). */
  annual: boolean;
  /** Solo puede arrancar en 1er cuatrimestre (p.ej. Proyecto Final). */
  startsOnlyFirstSemester: boolean;
  /** Es un slot de electiva (placeholder). */
  isElective: boolean;
};

/** Plan de estudios completo tal como viene en plan-estudios.json. */
export type StudyPlan = {
  career: string;
  university: string;
  planVersion: string;
  totalSubjects: number;
  electiveSlots: number;
  subjects: Subject[];
};

/** Materia aprobada por el usuario, con su nota (1..10). */
export type ApprovedSubject = {
  code: string;
  grade: number;
};

/** Configuración editable del usuario. */
export type UserSettings = {
  /** Cuántas materias en turno noche tolera por cuatrimestre. */
  maxNightSlots: number;
  /** Cuántas materias fuera del turno noche (mañana/tarde/distancia) tolera. */
  maxNonNightSlots: number;
  /** Año de inicio del cómputo del simulador. */
  startYear: number;
  /** Cuatrimestre de inicio (1 o 2). */
  startTerm: 1 | 2;
  /** Meses de trámite de título a sumar a la fecha de egreso (editable). */
  degreeProcessingMonths: number;
  /** Cantidad de aplazos (finales desaprobados) para el promedio con aplazos.
   * La historia académica del campus no los muestra, se cargan a mano. */
  aplazos: number;
};

/** Estado propio del usuario (lo que se guarda en localStorage). */
export type UserState = {
  approved: ApprovedSubject[];
  /**
   * Materias regularizadas: cursada aprobada, falta el final.
   * Importante en UNLaM: para CURSAR una materia suele alcanzar con tener
   * la correlativa regularizada. La historia académica del campus NO las
   * muestra, así que el usuario las carga a mano.
   */
  regularized: string[];
  /** Materias que está cursando ahora (cuentan como aprobadas al cierre). */
  inProgress: string[];
  settings: UserSettings;
};

/** Estado posible de una materia respecto del usuario. */
export type SubjectStatus =
  | 'approved' // final aprobado
  | 'regularized' // cursada aprobada, falta final
  | 'inProgress' // cursando ahora
  | 'eligible' // se puede cursar ya (correlativas cumplidas)
  | 'blocked'; // faltan correlativas

export const DEFAULT_SETTINGS: UserSettings = {
  maxNightSlots: 5,
  maxNonNightSlots: 1,
  startYear: new Date().getFullYear(),
  startTerm: 1,
  degreeProcessingMonths: 6,
  aplazos: 0,
};
