/**
 * useStore.ts — Estado global con Zustand, persistido en localStorage.
 * Clave versionada: `unlam-planner-v1`. 100% en el navegador, sin backend.
 */

import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import type {
  ApprovedSubject,
  UserSettings,
  UserState,
} from '@/domain/types';
import { DEFAULT_SETTINGS } from '@/domain/types';
import type { OfferData } from '@/domain/conflicts';
import { subjectByCode } from '@/data/plan';
import exampleState from '@/data/mi-estado-ejemplo.json';

/** Un escenario del comparador: variante de configuración del simulador. */
export type Scenario = {
  id: string;
  name: string;
  maxNightSlots: number;
  maxNonNightSlots: number;
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
  /** Oferta de comisiones del cuatrimestre cargada (opcional). */
  offer: OfferData | null;

  // --- Acciones sobre materias ---
  setApproved: (code: string, grade: number) => void;
  toggleApproved: (code: string, grade?: number) => void;
  setGrade: (code: string, grade: number) => void;
  toggleRegularized: (code: string) => void;
  toggleInProgress: (code: string) => void;
  clearStatus: (code: string) => void;
  importApproved: (rows: { code: string; grade: number }[]) => void;

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

  // --- Simulador manual ---
  setManualTerms: (terms: ManualTerm[]) => void;
  moveToManualTerm: (code: string, termId: string | null) => void;
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
    settings: { ...DEFAULT_SETTINGS },
  };
}

const emptyUser: UserState = {
  approved: [],
  regularized: [],
  inProgress: [],
  settings: { ...DEFAULT_SETTINGS },
};

export const useStore = create<StoreState>()(
  persist(
    (set) => ({
      user: emptyUser,
      electiveNames: {},
      scenarios: [],
      manualTerms: [],
      offer: null,

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

      clearStatus: (code) =>
        set((s) => ({
          user: {
            ...s.user,
            approved: s.user.approved.filter((a) => a.code !== code),
            regularized: s.user.regularized.filter((c) => c !== code),
            inProgress: s.user.inProgress.filter((c) => c !== code),
          },
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
          offer: null,
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

      setManualTerms: (terms) => set(() => ({ manualTerms: terms })),

      moveToManualTerm: (code, termId) =>
        set((s) => {
          // Sacar de todos los cuatris.
          const terms = s.manualTerms.map((t) => ({
            ...t,
            subjects: t.subjects.filter((c) => c !== code),
          }));
          if (termId) {
            const idx = terms.findIndex((t) => t.id === termId);
            if (idx >= 0 && !terms[idx].subjects.includes(code)) {
              terms[idx] = {
                ...terms[idx],
                subjects: [...terms[idx].subjects, code],
              };
            }
          }
          return { manualTerms: terms };
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
    {
      name: 'unlam-planner-v1',
      version: 1,
      partialize: (s) => ({
        user: s.user,
        electiveNames: s.electiveNames,
        scenarios: s.scenarios,
        manualTerms: s.manualTerms,
        offer: s.offer,
      }),
    },
  ),
);
