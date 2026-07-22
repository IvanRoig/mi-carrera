/**
 * useStore.ts — Estado global con Zustand, persistido en localStorage.
 * Clave versionada: `unlam-planner-v1`. 100% en el navegador, sin backend.
 */

import { create } from 'zustand';
import type {
  ApprovedSubject,
  UserSettings,
  UserState,
} from '@/domain/types';
import { DEFAULT_SETTINGS } from '@/domain/types';
import type { OfferData } from '@/domain/conflicts';
import { subjectByCode } from '@/data/plan';
import exampleState from '@/data/mi-estado-ejemplo.json';
import ofertaBase from '@/data/oferta-base.json';

/** Oferta precargada (base). El usuario puede subir una actualizada. */
export const baseOffer = ofertaBase as OfferData;

/** Un escenario del comparador: variante de configuración del simulador. */
export type Scenario = {
  id: string;
  name: string;
  maxPerTerm: number;
  sicario?: boolean;
};

/** Un cuatrimestre armado a mano en el simulador manual. */
export type ManualTerm = {
  id: string;
  /** Códigos de materias ubicadas en este cuatri. */
  subjects: string[];
};

type RawState = {
  approved?: { code: string; grade: number }[];
  regularized?: string[];
  inProgress?: string[];
};

export type StoreState = {
  user: UserState;
  /** Nombres personalizados de las electivas (código → nombre real cursado). */
  electiveNames: Record<string, string>;
  /** Escenarios guardados para comparar. */
  scenarios: Scenario[];
  /** Plan armado a mano (simulador manual). */
  manualTerms: ManualTerm[];
  /** Día forzado por materia en el manual (0=Lun..5=Sáb, -1=distancia). Sin
   * entrada = elección automática de comisión. */
  manualForcedDay: Record<string, number>;
  /** Turno forzado por materia en el manual ('m'|'t'|'n'). Opcional. */
  manualForcedTurno: Record<string, 'm' | 't' | 'n'>;
  /** Modo activo del simulador. Se recuerda al cambiar de pestaña (arranca en
   * 'auto', pero si lo dejaste en 'manual', al volver seguís en 'manual'). */
  simMode: 'auto' | 'sicario' | 'manual';
  /** Oferta de comisiones del cuatrimestre cargada (opcional). */
  offer: OfferData | null;

  // --- Acciones sobre materias ---
  setApproved: (code: string, grade: number) => void;
  toggleApproved: (code: string, grade?: number) => void;
  setGrade: (code: string, grade: number) => void;
  toggleRegularized: (code: string) => void;
  toggleInProgress: (code: string) => void;
  toggleDifficult: (code: string) => void;
  clearStatus: (code: string) => void;
  importApproved: (rows: { code: string; grade: number }[]) => void;
  importState: (raw: RawState) => void;

  // --- Configuración ---
  updateSettings: (patch: Partial<UserSettings>) => void;
  renameElective: (code: string, name: string) => void;

  // --- Datos ---
  loadExampleData: () => void;
  resetAll: () => void;
  importFullState: (state: Partial<StoreState>) => void;

  // --- Escenarios ---
  addScenario: (s: Omit<Scenario, 'id'>) => void;
  removeScenario: (id: string) => void;

  // --- Simulador ---
  setSimMode: (mode: 'auto' | 'sicario' | 'manual') => void;
  setManualTerms: (terms: ManualTerm[]) => void;
  /** Setea el plan manual fijando el día/turno de cada materia (estable). */
  seedManual: (
    terms: ManualTerm[],
    forcedDay: Record<string, number>,
    forcedTurno: Record<string, 'm' | 't' | 'n'>,
  ) => void;
  moveToManualTerm: (code: string, termId: string | null) => void;
  /** Coloca una materia en un cuatri y un día específico (elige la comisión de
   * ese día; si no hay, la deja "forzada" a ese día con aviso). */
  placeOnDay: (code: string, termId: string, day: number) => void;
  /** Coloca una materia en un cuatri, día y turno específicos. */
  placeOnSlot: (code: string, termId: string, day: number, turno: 'm' | 't' | 'n') => void;
  addManualTerm: () => void;
  removeManualTerm: (termId: string) => void;

  // --- Oferta ---
  setOffer: (offer: OfferData | null) => void;
};

function normalizeApproved(rows: { code: string; grade: number }[]): ApprovedSubject[] {
  // Solo códigos que existan en el plan 2023-2 (ignora plan viejo).
  return rows.filter((r) => subjectByCode.has(r.code));
}

function stateFromRaw(raw: RawState): UserState {
  return {
    approved: normalizeApproved(raw.approved ?? []),
    regularized: (raw.regularized ?? []).filter((c) => subjectByCode.has(c)),
    inProgress: (raw.inProgress ?? []).filter((c) => subjectByCode.has(c)),
    difficult: [],
    settings: { ...DEFAULT_SETTINGS },
  };
}

const emptyUser: UserState = {
  approved: [],
  regularized: [],
  inProgress: [],
  difficult: [],
  settings: { ...DEFAULT_SETTINGS },
};

// Sin persistencia local: en modo invitado el estado vive solo en memoria (se
// reinicia en cada carga). Con cuenta, la persistencia es la nube (cloudSync).
export const useStore = create<StoreState>()(
    (set) => ({
      user: emptyUser,
      electiveNames: {},
      scenarios: [],
      manualTerms: [],
      manualForcedDay: {},
      manualForcedTurno: {},
      simMode: 'auto',
      offer: baseOffer,

      setApproved: (code, grade) =>
        set((s) => {
          if (!subjectByCode.has(code)) return s;
          const approved = s.user.approved.filter((a) => a.code !== code);
          approved.push({ code, grade });
          return {
            user: {
              ...s.user,
              approved,
              regularized: s.user.regularized.filter((c) => c !== code),
              inProgress: s.user.inProgress.filter((c) => c !== code),
            },
          };
        }),

      toggleApproved: (code, grade = 4) =>
        set((s) => {
          const isApproved = s.user.approved.some((a) => a.code === code);
          if (isApproved) {
            return {
              user: {
                ...s.user,
                approved: s.user.approved.filter((a) => a.code !== code),
              },
            };
          }
          const approved = s.user.approved.filter((a) => a.code !== code);
          approved.push({ code, grade });
          return {
            user: {
              ...s.user,
              approved,
              regularized: s.user.regularized.filter((c) => c !== code),
              inProgress: s.user.inProgress.filter((c) => c !== code),
            },
          };
        }),

      setGrade: (code, grade) =>
        set((s) => ({
          user: {
            ...s.user,
            approved: s.user.approved.map((a) =>
              a.code === code ? { ...a, grade } : a,
            ),
          },
        })),

      toggleRegularized: (code) =>
        set((s) => {
          if (!subjectByCode.has(code)) return s;
          const has = s.user.regularized.includes(code);
          return {
            user: {
              ...s.user,
              regularized: has
                ? s.user.regularized.filter((c) => c !== code)
                : [...s.user.regularized, code],
              approved: s.user.approved.filter((a) => a.code !== code),
              inProgress: s.user.inProgress.filter((c) => c !== code),
            },
          };
        }),

      toggleInProgress: (code) =>
        set((s) => {
          if (!subjectByCode.has(code)) return s;
          const has = s.user.inProgress.includes(code);
          return {
            user: {
              ...s.user,
              inProgress: has
                ? s.user.inProgress.filter((c) => c !== code)
                : [...s.user.inProgress, code],
              approved: s.user.approved.filter((a) => a.code !== code),
              regularized: s.user.regularized.filter((c) => c !== code),
            },
          };
        }),

      toggleDifficult: (code) =>
        set((s) => {
          if (!subjectByCode.has(code)) return s;
          const has = s.user.difficult.includes(code);
          return {
            user: {
              ...s.user,
              difficult: has
                ? s.user.difficult.filter((c) => c !== code)
                : [...s.user.difficult, code],
            },
          };
        }),

      clearStatus: (code) =>
        set((s) => ({
          user: {
            ...s.user,
            approved: s.user.approved.filter((a) => a.code !== code),
            regularized: s.user.regularized.filter((c) => c !== code),
            inProgress: s.user.inProgress.filter((c) => c !== code),
          },
        })),

      importState: (raw) =>
        set((s) => ({
          user: {
            ...stateFromRaw(raw),
            // Conservamos la configuración actual del usuario.
            settings: { ...s.user.settings },
          },
          manualTerms: [],
        })),

      importApproved: (rows) =>
        set((s) => {
          const clean = normalizeApproved(rows);
          const map = new Map(s.user.approved.map((a) => [a.code, a] as const));
          for (const r of clean) map.set(r.code, r);
          const codes = new Set(clean.map((r) => r.code));
          return {
            user: {
              ...s.user,
              approved: [...map.values()],
              regularized: s.user.regularized.filter((c) => !codes.has(c)),
              inProgress: s.user.inProgress.filter((c) => !codes.has(c)),
            },
          };
        }),

      updateSettings: (patch) =>
        set((s) => ({
          user: { ...s.user, settings: { ...s.user.settings, ...patch } },
        })),

      renameElective: (code, name) =>
        set((s) => ({
          electiveNames: { ...s.electiveNames, [code]: name },
        })),

      loadExampleData: () =>
        set(() => ({
          user: stateFromRaw(exampleState as RawState),
          manualTerms: [],
        })),

      resetAll: () =>
        set(() => ({
          user: emptyUser,
          electiveNames: {},
          scenarios: [],
          manualTerms: [],
          manualForcedDay: {},
          manualForcedTurno: {},
          simMode: 'auto',
          offer: baseOffer,
        })),

      importFullState: (state) => set(() => ({ ...state })),

      addScenario: (sc) =>
        set((s) => ({
          scenarios: [
            ...s.scenarios,
            { ...sc, id: crypto.randomUUID() },
          ],
        })),

      removeScenario: (id) =>
        set((s) => ({ scenarios: s.scenarios.filter((x) => x.id !== id) })),

      setSimMode: (mode) => set(() => ({ simMode: mode })),

      setManualTerms: (terms) =>
        set(() => ({ manualTerms: terms, manualForcedDay: {}, manualForcedTurno: {} })),

      seedManual: (terms, forcedDay, forcedTurno) =>
        set(() => ({ manualTerms: terms, manualForcedDay: forcedDay, manualForcedTurno: forcedTurno })),

      moveToManualTerm: (code, termId) =>
        set((s) => {
          const terms = s.manualTerms.map((t) => ({
            ...t,
            subjects: t.subjects.filter((c) => c !== code),
          }));
          if (termId) {
            const idx = terms.findIndex((t) => t.id === termId);
            if (idx >= 0 && !terms[idx].subjects.includes(code)) {
              terms[idx] = { ...terms[idx], subjects: [...terms[idx].subjects, code] };
            }
          }
          // Al mover a un cuatri (sin día), vuelve a elección automática de comisión.
          const forced = { ...s.manualForcedDay };
          const turno = { ...s.manualForcedTurno };
          delete forced[code];
          delete turno[code];
          return { manualTerms: terms, manualForcedDay: forced, manualForcedTurno: turno };
        }),

      placeOnDay: (code, termId, day) =>
        set((s) => {
          const terms = s.manualTerms.map((t) => ({
            ...t,
            subjects: t.subjects.filter((c) => c !== code),
          }));
          const idx = terms.findIndex((t) => t.id === termId);
          if (idx >= 0 && !terms[idx].subjects.includes(code)) {
            terms[idx] = { ...terms[idx], subjects: [...terms[idx].subjects, code] };
          }
          const turno = { ...s.manualForcedTurno };
          delete turno[code];
          return {
            manualTerms: terms,
            manualForcedDay: { ...s.manualForcedDay, [code]: day },
            manualForcedTurno: turno,
          };
        }),

      placeOnSlot: (code, termId, day, turno) =>
        set((s) => {
          const terms = s.manualTerms.map((t) => ({
            ...t,
            subjects: t.subjects.filter((c) => c !== code),
          }));
          const idx = terms.findIndex((t) => t.id === termId);
          if (idx >= 0 && !terms[idx].subjects.includes(code)) {
            terms[idx] = { ...terms[idx], subjects: [...terms[idx].subjects, code] };
          }
          return {
            manualTerms: terms,
            manualForcedDay: { ...s.manualForcedDay, [code]: day },
            manualForcedTurno: { ...s.manualForcedTurno, [code]: turno },
          };
        }),

      addManualTerm: () =>
        set((s) => ({
          manualTerms: [
            ...s.manualTerms,
            { id: crypto.randomUUID(), subjects: [] },
          ],
        })),

      removeManualTerm: (termId) =>
        set((s) => ({
          manualTerms: s.manualTerms.filter((t) => t.id !== termId),
        })),

      setOffer: (offer) => set(() => ({ offer })),
    }),
);
