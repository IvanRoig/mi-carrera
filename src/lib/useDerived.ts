/**
 * useDerived.ts — Deriva todo lo calculado (estados, progreso, promedio,
 * simulación automática) a partir del estado del store. Memoizado.
 */
import { useMemo } from 'react';
import { useStore } from '@/store/useStore';
import { graph } from '@/domain/planGraph';
import { subjects } from '@/data/plan';
import {
  computeStatuses,
  longestDownstreamTerms,
} from '@/domain/graph';
import { computePriorityMetrics } from '@/domain/priority';
import { schedule, type ScheduleResult } from '@/domain/scheduler';
import type { SubjectStatus } from '@/domain/types';
import { isNightCommission, offeringMap, scarcityFromOffer } from '@/domain/conflicts';

export type Derived = {
  statuses: Map<string, SubjectStatus>;
  /** Materias terminadas (aprobadas ∪ regularizadas ∪ en curso). */
  done: Set<string>;
  /** Materias pendientes de cursar. */
  pending: Set<string>;
  progress: {
    approvedCount: number;
    total: number;
    percent: number;
    hoursDone: number;
    hoursTotal: number;
    remainingCount: number;
  };
  promedio: {
    sinAplazos: number;
    conAplazos: number;
    count: number;
  };
  metrics: ReturnType<typeof computePriorityMetrics>;
  criticalTermsAll: Map<string, number>;
  schedule: ScheduleResult;
};

export function useDerived(): Derived {
  const user = useStore((s) => s.user);
  const offer = useStore((s) => s.offer);

  return useMemo(() => {
    const statuses = computeStatuses(graph, user);

    const approvedSet = new Set(user.approved.map((a) => a.code));
    const done = new Set<string>([
      ...approvedSet,
      ...user.regularized,
      ...user.inProgress,
    ]);
    const pending = new Set(
      subjects.map((s) => s.code).filter((c) => !done.has(c)),
    );

    // Progreso.
    const total = subjects.length;
    const approvedCount = approvedSet.size;
    const hoursTotal = subjects.reduce((a, s) => a + s.totalHours, 0);
    const hoursDone = user.approved.reduce(
      (a, r) => a + (graph.byCode.get(r.code)?.totalHours ?? 0),
      0,
    );

    // Promedio.
    const grades = user.approved.map((a) => a.grade);
    const sum = grades.reduce((a, g) => a + g, 0);
    const count = grades.length;
    const sinAplazos = count ? sum / count : 0;
    const aplazos = user.settings.aplazos ?? 0;
    const conAplazos = count + aplazos ? sum / (count + aplazos) : 0;

    // Escasez y clasificación de turno desde la oferta (si hay).
    const scarcity = offer ? scarcityFromOffer(offer) : undefined;
    const offMap = offer ? offeringMap(offer) : null;
    const classifyNight = offMap
      ? (code: string) => {
          const o = offMap.get(code);
          if (!o || o.commissions.length === 0) return true; // sin datos → noche
          // Es "no noche" solo si TODAS sus comisiones son fuera de la noche.
          return o.commissions.some((c) => isNightCommission(c));
        }
      : undefined;

    const metrics = computePriorityMetrics(graph, pending, scarcity);
    const criticalTermsAll = longestDownstreamTerms(graph, pending);

    const sched = schedule({
      graph,
      pending,
      done,
      settings: user.settings,
      classifyNight,
      scarcity,
    });

    return {
      statuses,
      done,
      pending,
      progress: {
        approvedCount,
        total,
        percent: total ? (approvedCount / total) * 100 : 0,
        hoursDone,
        hoursTotal,
        remainingCount: pending.size,
      },
      promedio: { sinAplazos, conAplazos, count },
      metrics,
      criticalTermsAll,
      schedule: sched,
    };
  }, [user, offer]);
}
