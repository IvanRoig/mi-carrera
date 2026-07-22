/**
 * alerts.ts — Alertas inteligentes sobre el plan del usuario.
 */
import type { Graph } from './graph';
import type { SubjectStatus } from './types';
import { TALLER_CODE } from './types';
import type { ScheduleResult } from './scheduler';
import type { OfferData } from './conflicts';
import { offeringMap, DAY_NAMES } from './conflicts';

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
  loaded = true,
): Alert[] {
  const alerts: Alert[] = [];
  // Sin datos cargados (o carrera terminada) no tiene sentido alertar nada.
  if (!loaded || pending.size === 0) return alerts;

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

  // 2) Taller de Integración (optativo) habilitado pero pendiente.
  if (pending.has(TALLER_CODE) && statuses.get(TALLER_CODE) === 'eligible') {
    alerts.push({
      level: 'info',
      title: `${nameOf(TALLER_CODE)} está habilitado (es optativo)`,
      detail:
        'Tenés todas sus correlativas. Es una materia optativa que no desbloquea nada; si no la vas a hacer, podés descartarla desde el botón de Taller de Integración.',
    });
  }

  // 3) Materias de ruta crítica con oferta escasa (solo las que podés cursar ya).
  if (offer) {
    const offMap = offeringMap(offer);
    for (const c of sched.criticalChain) {
      if (statuses.get(c) !== 'eligible') continue; // no avisar de las que aún no podés
      const o = offMap.get(c);
      if (o && o.commissions.length === 1) {
        const cm = o.commissions[0];
        const m = cm.meetings[0];
        const cuando = m ? `${DAY_NAMES[m.day]} ${m.start}` : cm.modality;
        alerts.push({
          level: 'warn',
          title: `${nameOf(c)} está en la ruta crítica y se ofrece poco`,
          detail: `Solo hay 1 comisión este cuatri (${cuando}). Si se cae, se te atrasa el egreso: aseguratela.`,
        });
      }
    }
  }

  return alerts;
}
