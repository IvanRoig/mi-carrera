/**
 * useDerived.ts — Deriva todo lo calculado a partir del estado del store.
 */
import { useMemo } from 'react';
import { useStore } from '@/store/useStore';
import { graph } from '@/domain/planGraph';
import { subjects } from '@/data/plan';
import { computeStatuses, longestDownstreamTerms } from '@/domain/graph';
import { computePriorityMetrics } from '@/domain/priority';
import { schedule, type ScheduleResult } from '@/domain/scheduler';
import type { SubjectStatus, UserState } from '@/domain/types';
import { TALLER_CODE } from '@/domain/types';
import { scarcityFromOffer } from '@/domain/conflicts';
import {
  intermediateProgress,
  intermediateRequired,
  type IntermediateProgress,
} from '@/domain/degrees';

export type Derived = {
  statuses: Map<string, SubjectStatus>;
  done: Set<string>;
  pending: Set<string>;
  /** Las que estás cursando ahora: ocupan el primer cuatrimestre del plan. */
  enCurso: Set<string>;
  /** Materias consideradas (todas, menos Taller si está descartado). */
  universe: Set<string>;
  /** ¿El usuario ya cargó algún dato? */
  loaded: boolean;
  progress: {
    approvedCount: number;
    total: number;
    percent: number;
    hoursDone: number;
    hoursTotal: number;
    remainingCount: number;
  };
  promedio: {
    /** Promedio de todas las aprobadas (título de grado). */
    grado: number;
    /** Promedio de las materias que cuentan para el título intermedio. */
    intermedio: number;
    count: number;
    intermedioCount: number;
  };
  intermediate: IntermediateProgress;
  metrics: ReturnType<typeof computePriorityMetrics>;
  criticalTermsAll: Map<string, number>;
};

export function useDerived(): Derived {
  const user = useStore((s) => s.user);
  const offer = useStore((s) => s.offer);

  return useMemo(() => {
    const includeTaller = user.settings.includeTaller;
    const universe = new Set(
      subjects
        .map((s) => s.code)
        .filter((c) => includeTaller || c !== TALLER_CODE),
    );

    const statuses = computeStatuses(graph, user);
    const approvedSet = new Set(user.approved.map((a) => a.code));

    // "Cursando" no es lo mismo que "aprobada": todavía te falta, pero ya sabés
    // en qué cuatrimestre va (el que estás haciendo). Sirve para habilitar
    // correlativas, pero sigue contando como pendiente.
    const enCurso = new Set(user.inProgress.filter((c) => universe.has(c)));
    const done = new Set<string>(
      [...approvedSet, ...user.regularized].filter((c) => universe.has(c)),
    );
    const pending = new Set([...universe].filter((c) => !done.has(c)));

    const total = universe.size;
    const approvedCount = [...approvedSet].filter((c) => universe.has(c)).length;
    const hoursTotal = [...universe].reduce(
      (a, c) => a + (graph.byCode.get(c)?.totalHours ?? 0),
      0,
    );
    const hoursDone = user.approved
      .filter((r) => universe.has(r.code))
      .reduce((a, r) => a + (graph.byCode.get(r.code)?.totalHours ?? 0), 0);

    // Promedios: uno para el título de grado (todas las aprobadas) y otro para
    // el título intermedio (solo las materias que cuentan para él).
    const grades = user.approved.map((a) => a.grade);
    const sum = grades.reduce((a, g) => a + g, 0);
    const count = grades.length;
    const gradoAvg = count ? sum / count : 0;

    const interReq = intermediateRequired(subjects);
    const interGrades = user.approved
      .filter((a) => interReq.has(a.code))
      .map((a) => a.grade);
    const interSum = interGrades.reduce((a, g) => a + g, 0);
    const interCount = interGrades.length;
    const interAvg = interCount ? interSum / interCount : 0;

    const scarcity = offer ? scarcityFromOffer(offer) : undefined;

    const metrics = computePriorityMetrics(graph, pending, scarcity);
    const criticalTermsAll = longestDownstreamTerms(graph, pending);

    const intermediate = intermediateProgress(subjects, approvedSet);
    const loaded =
      user.approved.length > 0 ||
      user.regularized.length > 0 ||
      user.inProgress.length > 0;

    return {
      statuses,
      done,
      pending,
      enCurso,
      universe,
      loaded,
      progress: {
        approvedCount,
        total,
        percent: total ? (approvedCount / total) * 100 : 0,
        hoursDone,
        hoursTotal,
        remainingCount: pending.size,
      },
      promedio: { grado: gradoAvg, intermedio: interAvg, count, intermedioCount: interCount },
      intermediate,
      metrics,
      criticalTermsAll,
    };
  }, [user, offer]);
}

/**
 * Cronograma automático. Separado de useDerived (es lo caro) para que solo lo
 * recalculen las pantallas que lo muestran (Tablero, Simulador), y no cada vez
 * que tocás una materia en otra solapa. Memoizado por (approved/regularized/
 * inProgress/settings/difficult) y la oferta — no por el plan manual.
 */
/**
 * Lo que estás cursando AHORA ocupa el primer cuatrimestre del plan: no está
 * aprobado todavía, y lo que depende de ello recién puede ir después. Si no,
 * el simulador arrancaría de nuevo en el mismo cuatrimestre y te pondría una
 * materia junto a su propia correlativa.
 */
export function enCursoOptions(d: Pick<Derived, 'pending' | 'enCurso'>) {
  const fijas = [...d.enCurso].filter((c) => d.pending.has(c));
  return {
    pending: new Set([...d.pending].filter((c) => !d.enCurso.has(c))),
    preScheduled: fijas.length ? new Map(fijas.map((c) => [c, 0])) : undefined,
    firstFreeTerm: fijas.length ? 1 : 0,
  };
}

export function useSchedule(): ScheduleResult {
  const user = useStore((s) => s.user);
  const offer = useStore((s) => s.offer);
  const electivePref = useStore((s) => s.electivePref);
  return useMemo(() => computeSchedule(user, offer, electivePref), [user, offer, electivePref]);
}

function computeSchedule(
  user: UserState,
  offer: ReturnType<typeof useStore.getState>['offer'],
  electivePref: Record<string, number> = {},
) {
  const includeTaller = user.settings.includeTaller;
  const universe = new Set(
    subjects.map((s) => s.code).filter((c) => includeTaller || c !== TALLER_CODE),
  );
  const done = new Set<string>(
    [...user.approved.map((a) => a.code), ...user.regularized].filter((c) =>
      universe.has(c),
    ),
  );
  const todas = new Set([...universe].filter((c) => !done.has(c)));
  const enCurso = new Set(user.inProgress.filter((c) => todas.has(c)));
  const { pending, preScheduled, firstFreeTerm } = enCursoOptions({ pending: todas, enCurso });
  const scarcity = offer ? scarcityFromOffer(offer) : undefined;
  return schedule({
    graph,
    pending,
    done,
    settings: user.settings,
    offer,
    difficult: new Set(user.difficult),
    scarcity,
    electivePref,
    preScheduled,
    firstFreeTerm,
  });
}
