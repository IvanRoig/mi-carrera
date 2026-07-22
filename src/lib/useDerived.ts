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
import type { SubjectStatus } from '@/domain/types';
import { TALLER_CODE } from '@/domain/types';
import { scarcityFromOffer } from '@/domain/conflicts';
import { intermediateProgress, type IntermediateProgress } from '@/domain/degrees';

export type Derived = {
  statuses: Map<string, SubjectStatus>;
  done: Set<string>;
  pending: Set<string>;
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
  promedio: { sinAplazos: number; conAplazos: number; count: number };
  intermediate: IntermediateProgress;
  metrics: ReturnType<typeof computePriorityMetrics>;
  criticalTermsAll: Map<string, number>;
  schedule: ScheduleResult;
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
    const difficult = new Set(user.difficult);

    const done = new Set<string>(
      [...approvedSet, ...user.regularized, ...user.inProgress].filter((c) =>
        universe.has(c),
      ),
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

    // Promedio.
    const grades = user.approved.map((a) => a.grade);
    const sum = grades.reduce((a, g) => a + g, 0);
    const count = grades.length;
    const sinAplazos = count ? sum / count : 0;
    const aplazos = user.settings.aplazos ?? 0;
    const conAplazos = count + aplazos ? sum / (count + aplazos) : 0;

    const scarcity = offer ? scarcityFromOffer(offer) : undefined;

    const metrics = computePriorityMetrics(graph, pending, scarcity);
    const criticalTermsAll = longestDownstreamTerms(graph, pending);

    const sched = schedule({
      graph,
      pending,
      done,
      settings: user.settings,
      offer,
      difficult,
      scarcity,
    });

    const intermediate = intermediateProgress(subjects, approvedSet);
    const loaded =
      user.approved.length > 0 ||
      user.regularized.length > 0 ||
      user.inProgress.length > 0;

    return {
      statuses,
      done,
      pending,
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
      promedio: { sinAplazos, conAplazos, count },
      intermediate,
      metrics,
      criticalTermsAll,
      schedule: sched,
    };
  }, [user, offer]);
}
