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
  /** Mínimo de materias por cuatrimestre que preferís (preferencia). */
  minPerTerm: number;
  /** Máximo de materias por cuatrimestre (tope real que usa el simulador). */
  maxPerTerm: number;
  /** Año de inicio del cómputo del simulador. */
  startYear: number;
  /** Cuatrimestre de inicio (1 o 2). */
  startTerm: 1 | 2;
  /** Considerar Taller de Integración (materia optativa) en todo. */
  includeTaller: boolean;
  /** (Opcional, poco usado) limitar cuántas materias "difíciles" por cuatri. */
  limitDifficult: boolean;
  /** Máximo de materias difíciles por cuatri si limitDifficult está activo. */
  maxDifficultPerTerm: number;
  /** Filtrar por disponibilidad horaria (día × turno) usando la oferta. */
  restrictAvailability: boolean;
  /** Slots disponibles como "día-turno" (turno: m=mañana, t=tarde, n=noche). */
  availableSlots: string[];
};

/** Todos los slots posibles: Lun..Sáb × {mañana, tarde, noche}. */
export const ALL_SLOTS: string[] = (() => {
  const out: string[] = [];
  for (let d = 0; d < 6; d++) for (const turno of ['m', 't', 'n']) out.push(`${d}-${turno}`);
  return out;
})();

/** Solo turno noche (Lun..Sáb): el caso más común en la carrera. */
export const NIGHT_SLOTS: string[] = [0, 1, 2, 3, 4, 5].map((d) => `${d}-n`);

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
  /** Materias que el usuario marcó como "difíciles" (opcional). */
  difficult: string[];
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
  minPerTerm: 4,
  maxPerTerm: 6,
  startYear: new Date().getFullYear(),
  startTerm: 1,
  includeTaller: true,
  limitDifficult: false,
  maxDifficultPerTerm: 2,
  restrictAvailability: false,
  availableSlots: NIGHT_SLOTS,
};

/** Código de la materia optativa Taller de Integración. */
export const TALLER_CODE = '03680';
