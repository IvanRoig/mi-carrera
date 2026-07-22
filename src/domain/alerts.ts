/**
 * alerts.ts — Alertas inteligentes sobre el plan del usuario.
 */
import type { Graph } from './graph';
import { descendantsOf } from './graph';
import type { SubjectStatus } from './types';
import type { ScheduleResult } from './scheduler';
import type { OfferData } from './conflicts';
import { offeringMap } from './conflicts';

export type Alert = {
  level: 'info' | 'warn';
  title: string;
  detail: string;
};

export function generateAlerts(
  g: Graph,
  statuses: Map<string, SubjectStatus>,
  pending: Set<string>,
  sched: ScheduleResult,
  nameOf: (code: string) => string,
  offer?: OfferData | null,
): Alert[] {
  const alerts: Alert[] = [];
  if (pending.size === 0) return alerts;

  // 1) Electivas dejadas para el final.
  const electives = [...pending].filter((c) => g.byCode.get(c)?.isElective);
  if (electives.length > 0 && sched.makespan > 2) {
    const lateThreshold = sched.makespan - 2;
    const allLate = electives.every(
      (c) => (sched.startByCode.get(c) ?? 0) >= lateThreshold,
    );
    if (allLate) {
      alerts.push({
        level: 'warn',
        title: 'Estás dejando las electivas para el final',
        detail:
          'Las electivas no tienen correlativas: sembralas antes para no saturar los últimos cuatrimestres y darte margen.',
      });
    }
  }

  // 2) Taller de Integración habilitado pero no cursado.
  const taller = '03680';
  if (statuses.get(taller) === 'eligible') {
    alerts.push({
      level: 'info',
      title: `${nameOf(taller)} ya está habilitado`,
      detail:
        'Tenés todas sus correlativas. Es una materia “hoja” (no desbloquea nada), así que podés ubicarla cuando te quede cómodo.',
    });
  }

  // 3) Materias de ruta crítica con oferta escasa.
  if (offer) {
    const offMap = offeringMap(offer);
    for (const c of sched.criticalChain) {
      const o = offMap.get(c);
      if (o && o.commissions.length === 1) {
        const cm = o.commissions[0];
        alerts.push({
          level: 'warn',
          title: `${nameOf(c)} está en la ruta crítica y se ofrece poco`,
          detail: `Solo hay 1 comisión este cuatri (día ${cm.day}, ${cm.start}). Si se cae, se te atrasa el egreso: aseguratela.`,
        });
      }
    }
  }

  // 4) Materias hoja pendientes (sin nada aguas abajo) → dejar para el final.
  const leaves = [...pending].filter(
    (c) => [...descendantsOf(g, c)].every((d) => !pending.has(d)),
  );
  const earlyLeaves = leaves.filter(
    (c) => (sched.startByCode.get(c) ?? 99) < 1 && !g.byCode.get(c)?.isElective,
  );
  if (earlyLeaves.length >= 3) {
    alerts.push({
      level: 'info',
      title: 'Tenés materias “hoja” programadas temprano',
      detail:
        'Materias que no desbloquean nada (' +
        earlyLeaves.slice(0, 3).map(nameOf).join(', ') +
        '…) pueden ir más adelante y dar lugar a las que sí encadenan correlativas.',
    });
  }

  return alerts;
}
