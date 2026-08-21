/**
 * autocompletar.ts — "🪄 Completar desde acá" del armado manual.
 *
 * Deja fijos los cuatrimestres 0..keepUpTo TAL CUAL están y rearma solo los que
 * siguen.
 *
 * El punto delicado es el VERANO, y hay tres cosas que antes se hacían mal:
 *
 *  · Un verano no existe en el calendario regular: va entre el 2° de un año y el
 *    1° del siguiente y no ocupa lugar en la numeración, así que no se puede usar
 *    el índice del array como número de cuatrimestre. Con un verano en el medio,
 *    todo lo que venía después se corría un lugar.
 *  · Al reconstruir el prefijo se perdía la marca `summer`, y el verano se
 *    convertía en un cuatrimestre regular.
 *  · Los veranos de la COLA se borraban al rearmarla. Ahora no se rearman nunca:
 *    el simulador jamás inventa un verano (la oferta depende de la demanda), así
 *    que rearmarlos solo puede destruirlos, y ponerse uno es una decisión tuya.
 *
 * Sus materias no se le pasan al simulador como "fijadas en el cuatri N" (no hay
 * N que valga) sino como ya aprobadas: para cuando arranque el cuatrimestre
 * siguiente, lo van a estar.
 *
 * Vive acá y no dentro del componente para poder testearlo: el bug de que el
 * verano se borraba existió porque esto era código de UI sin cobertura.
 */
import type { Graph } from './graph';
import type { OfferData } from './conflicts';
import type { UserSettings } from './types';
import { schedule, type ScheduleResult } from './scheduler';

/** Un cuatrimestre del plan manual (sin el id, que es cosa de la UI). */
export type TramoManual = { subjects: string[]; summer?: boolean };

export type ContextoPlan = {
  graph: Graph;
  /** Todo lo que te falta (incluye lo que ya está ubicado en el plan manual). */
  pending: Set<string>;
  done: Set<string>;
  settings: UserSettings;
  offer?: OfferData | null;
  difficult?: Set<string>;
  electivePref?: Record<string, number>;
  scarcity?: Map<string, number>;
};

export type Autocompletado = {
  /** El plan nuevo: prefijo intacto (veranos incluidos) + cuatris rearmados. */
  terms: TramoManual[];
  /** El resultado crudo del simulador, para sacarle los horarios. */
  res: ScheduleResult;
  /** Materias del prefijo: sus días fijados hay que conservarlos. */
  prefixCodes: Set<string>;
};

export function completarDesde(
  manualTerms: TramoManual[],
  keepUpTo: number,
  ctx: ContextoPlan,
): Autocompletado {
  const keep = manualTerms.slice(0, keepUpTo + 1);
  const cola = manualTerms.slice(keepUpTo + 1);

  // Prefijo: los cuatris regulares quedan fijados en su lugar del calendario.
  const preScheduled = new Map<string, number>();
  const enVerano: string[] = [];
  let regulares = 0;
  for (const t of keep) {
    if (t.summer) {
      enVerano.push(...t.subjects);
    } else {
      for (const c of t.subjects) preScheduled.set(c, regulares);
      regulares++;
    }
  }

  // Los veranos de la cola TAMPOCO se rearman. El simulador nunca inventa un
  // verano —no hay oferta que garantice— así que rearmarlos solo puede borrarlos,
  // y ponerse un verano es una decisión tuya. Se guardan con su posición: después
  // de cuántos cuatris regulares de la cola va cada uno.
  const veranosCola: { tras: number; subjects: string[] }[] = [];
  let regularesCola = 0;
  for (const t of cola) {
    if (t.summer) {
      veranosCola.push({ tras: regularesCola, subjects: [...t.subjects] });
      enVerano.push(...t.subjects);
    } else {
      regularesCola++;
    }
  }

  const fijadas = new Set([...preScheduled.keys(), ...enVerano]);
  const aUbicar = new Set([...ctx.pending].filter((c) => !fijadas.has(c)));
  const res = schedule({
    graph: ctx.graph,
    pending: aUbicar,
    // Piso duro: nada puede caer en los cuatris del prefijo. Sin esto, si dejaste
    // un cuatri del prefijo a medio llenar, las pasadas que compactan el plan
    // metían materias ahí — y al quedarnos solo con la cola, esas materias
    // desaparecían del plan.
    noAntesDe: new Map([...aUbicar].map((c) => [c, regulares] as const)),
    // Las de verano cuentan como hechas: habilitan las correlativas de lo que sigue.
    done: enVerano.length ? new Set([...ctx.done, ...enVerano]) : ctx.done,
    settings: ctx.settings,
    offer: ctx.offer,
    difficult: ctx.difficult ?? new Set(),
    preScheduled,
    firstFreeTerm: regulares,
    electivePref: ctx.electivePref,
    scarcity: ctx.scarcity,
  });

  // Cola nueva: los cuatris regulares que armó el simulador, con los veranos
  // reinsertados donde estaban.
  const nuevosRegulares = res.terms.slice(regulares).map((t) => ({ subjects: [...t.subjects] }));
  const colaNueva: TramoManual[] = [];
  let puestos = 0;
  const meterVeranosDe = (tras: number) => {
    for (const v of veranosCola) {
      if (v.tras === tras) colaNueva.push({ subjects: [...v.subjects], summer: true });
    }
  };
  meterVeranosDe(0);
  for (const t of nuevosRegulares) {
    colaNueva.push(t);
    puestos++;
    meterVeranosDe(puestos);
  }
  // Si la cola quedó más corta que antes, los veranos que sobran van al final:
  // borrarlos sería justo lo que no queremos.
  for (const v of veranosCola) {
    if (v.tras > puestos) colaNueva.push({ subjects: [...v.subjects], summer: true });
  }

  const terms: TramoManual[] = [
    ...keep.map((t) => ({
      subjects: [...t.subjects],
      ...(t.summer ? { summer: true as const } : {}),
    })),
    ...colaNueva,
  ];

  return { terms, res, prefixCodes: fijadas };
}
