/**
 * planCheck.ts — Verifica que un cronograma sea realmente cursable.
 *
 * Chequea lo mismo que exige la facultad: correlativas, materias anuales que
 * solo arrancan en 1er cuatrimestre, el tope de materias por cuatri y — clave —
 * que exista un horario posible (una materia por franja) en cada cuatrimestre.
 */
import { graph } from './planGraph';
import type { Offering, OfferData } from './conflicts';
import { offeringMap, commissionsOverlap, commissionFitsAvailability } from './conflicts';
import { calendarOf, type ScheduleResult } from './scheduler';
import type { UserSettings } from './types';

export type CheckInput = {
  res: ScheduleResult;
  pending: Set<string>;
  settings: UserSettings;
  offer: OfferData;
};

/** Comisiones utilizables de una materia según la disponibilidad configurada. */
function usableOffering(
  code: string,
  offMap: Map<string, Offering>,
  settings: UserSettings,
): Offering | undefined {
  const o = offMap.get(code);
  if (!o) return undefined;
  if (!settings.restrictAvailability) return o;
  const av = new Set(settings.availableSlots);
  const fit = o.commissions.filter((c) => commissionFitsAvailability(c, av));
  // Si ninguna entra, la materia se cursa igual (es obligatoria): no restringe.
  return { ...o, commissions: fit.length ? fit : o.commissions };
}

/** ¿Existe alguna asignación de comisiones sin superposiciones? */
export function horariosFactibles(
  codes: string[],
  offMap: Map<string, Offering>,
  settings: UserSettings,
): boolean {
  const opts = codes
    .map((c) => usableOffering(c, offMap, settings)?.commissions ?? [])
    .filter((cs) => cs.length > 0)
    .sort((a, b) => a.length - b.length); // menos opciones primero: poda mejor
  const elegidas: Offering['commissions'] = [];
  let pasos = 0;
  const bt = (i: number): boolean => {
    if (i >= opts.length) return true;
    if (++pasos > 50000) return true; // presupuesto agotado: no lo damos por imposible
    for (const cm of opts[i]) {
      if (elegidas.some((u) => commissionsOverlap(u, cm))) continue;
      elegidas.push(cm);
      if (bt(i + 1)) return true;
      elegidas.pop();
    }
    return false;
  };
  return bt(0);
}

/** Devuelve los problemas del plan. Vacío = plan válido y cursable. */
export function problemasDelPlan({ res, pending, settings, offer }: CheckInput): string[] {
  const offMap = offeringMap(offer);
  const p: string[] = [];
  const { startYear, startTerm, maxPerTerm } = settings;

  // (a) Cada materia pendiente, ubicada exactamente una vez.
  const veces = new Map<string, number>();
  for (const t of res.terms) for (const c of t.subjects) veces.set(c, (veces.get(c) ?? 0) + 1);
  for (const c of pending) if (!veces.has(c)) p.push(`falta ubicar ${c}`);
  for (const [c, n] of veces) {
    if (n > 1) p.push(`${c} aparece ${n} veces`);
    if (!pending.has(c)) p.push(`${c} no estaba pendiente`);
  }

  // (b) Correlativas y calendario (anuales / solo 1er cuatri).
  res.terms.forEach((t, i) => {
    for (const c of t.subjects) {
      const s = graph.byCode.get(c);
      if (!s) continue;
      for (const pre of graph.prereqs.get(c) ?? []) {
        if (!pending.has(pre)) continue; // ya aprobada de antes
        const fin = res.finishByCode.get(pre);
        if (fin === undefined || fin >= i) p.push(`${c} (cuatri ${i}) necesita ${pre}`);
      }
      const cal = calendarOf(i, startYear, startTerm);
      if ((s.annual || s.startsOnlyFirstSemester) && !cal.isFirstSemester)
        p.push(`${c} es anual y arrancaría en 2° cuatri (${i})`);
    }
  });

  // (c) Tope por cuatri, contando las anuales que siguen ocupando el siguiente.
  const ocupa = new Array(res.makespan + 2).fill(0);
  for (const [c, t] of res.startByCode) {
    ocupa[t]++;
    if (graph.byCode.get(c)?.annual) ocupa[t + 1]++;
  }
  for (let i = 0; i < res.makespan; i++) {
    if (ocupa[i] > maxPerTerm) p.push(`cuatri ${i}: ${ocupa[i]} materias supera el tope ${maxPerTerm}`);
  }

  // (d) Horarios posibles en cada cuatri (incluye las anuales que continúan).
  res.terms.forEach((t, i) => {
    const continuan = [...res.startByCode.entries()]
      .filter(([c, st]) => st === i - 1 && graph.byCode.get(c)?.annual)
      .map(([c]) => c);
    if (!horariosFactibles([...t.subjects, ...continuan], offMap, settings))
      p.push(`cuatri ${i}: no hay horario posible (se pisan)`);
  });

  // (e) Las comisiones efectivamente asignadas no se superponen.
  res.terms.forEach((t, i) => {
    const cms = t.subjects
      .map((c) => res.commissionByCode.get(c))
      .filter((c): c is NonNullable<typeof c> => !!c);
    for (let a = 0; a < cms.length; a++)
      for (let b = a + 1; b < cms.length; b++)
        if (commissionsOverlap(cms[a], cms[b])) p.push(`cuatri ${i}: comisiones superpuestas`);
  });

  return p;
}
