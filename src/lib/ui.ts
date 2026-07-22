/** Helpers de presentación: etiquetas, colores y formato. */
import type { SubjectStatus } from '@/domain/types';

export const STATUS_LABEL: Record<SubjectStatus, string> = {
  approved: 'Aprobada',
  regularized: 'Regularizada',
  inProgress: 'Cursando',
  eligible: 'Podés cursarla',
  blocked: 'Bloqueada',
};

/** Clases Tailwind para chips/badges por estado. */
export const STATUS_CHIP: Record<SubjectStatus, string> = {
  approved: 'bg-emerald-500/15 text-emerald-600 dark:text-emerald-300 ring-emerald-500/30',
  regularized: 'bg-cyan-500/15 text-cyan-600 dark:text-cyan-300 ring-cyan-500/30',
  inProgress: 'bg-blue-500/15 text-blue-600 dark:text-blue-300 ring-blue-500/30',
  eligible: 'bg-amber-500/15 text-amber-600 dark:text-amber-300 ring-amber-500/30',
  blocked: 'bg-slate-500/10 text-slate-500 dark:text-slate-400 ring-slate-500/20',
};

/** Color sólido (para nodos del grafo y puntos). */
export const STATUS_COLOR: Record<SubjectStatus, string> = {
  approved: '#10b981',
  regularized: '#06b6d4',
  inProgress: '#3b82f6',
  eligible: '#f59e0b',
  blocked: '#64748b',
};

export const TRACK_COLOR: Record<string, string> = {
  'Ciencias Básicas': '#38bdf8',
  Programación: '#a78bfa',
  'Desarrollo de Software': '#34d399',
  Infraestructura: '#fbbf24',
  'Calidad y Seguridad de la Información': '#fb7185',
  'Gestión y Complementarias': '#2dd4bf',
  Transversal: '#94a3b8',
  Electiva: '#e879f9',
};

export function trackColor(track: string): string {
  return TRACK_COLOR[track] ?? '#94a3b8';
}

const MONTHS = [
  'enero',
  'febrero',
  'marzo',
  'abril',
  'mayo',
  'junio',
  'julio',
  'agosto',
  'septiembre',
  'octubre',
  'noviembre',
  'diciembre',
];

export function monthName(month: number): string {
  return MONTHS[(month - 1 + 12) % 12] ?? '';
}

export function formatGraduation(g: { year: number; month: number }): string {
  return `${monthName(g.month)} de ${g.year}`;
}

export function termLabel(term: 1 | 2, year: number): string {
  return `${term}° cuatri ${year}`;
}

/** Nota con color según valor (rojo si es bajo). */
export function gradeClass(grade: number): string {
  if (grade <= 4) return 'text-rose-500 dark:text-rose-400';
  if (grade <= 6) return 'text-amber-500 dark:text-amber-400';
  return 'text-emerald-600 dark:text-emerald-400';
}
