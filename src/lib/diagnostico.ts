/**
 * diagnostico.ts — Reproduce "completar desde acá" varias veces y reporta si da
 * resultados distintos.
 *
 * Existe por un bug que no pude reproducir: a un usuario el plan le alternaba
 * entre dos versiones al apretar el botón, mientras acá salía siempre igual.
 * `schedule()` es demostrablemente pura y las entradas parecían idénticas, así
 * que la diferencia tiene que estar en el estado real de esa cuenta.
 *
 * Esto corre en la máquina del usuario, con SUS datos, y devuelve un texto para
 * pegar. No incluye notas ni las notas de las materias: solo códigos, la
 * configuración y la forma del plan.
 */
import { useStore } from '@/store/useStore';
import { graph } from '@/domain/planGraph';
import { subjects } from '@/data/plan';
import { schedule } from '@/domain/scheduler';
import { scarcityFromOffer } from '@/domain/conflicts';
import { TALLER_CODE } from '@/domain/types';

const VUELTAS = 6;

export function diagnosticoSimulador(): string {
  const s = useStore.getState();
  const { user, offer, electivePref, manualTerms, manualForcedDay, manualForcedTurno } = s;

  const universe = new Set(
    subjects.map((x) => x.code).filter((c) => user.settings.includeTaller || c !== TALLER_CODE),
  );
  const done = new Set(
    [...user.approved.map((a) => a.code), ...user.regularized].filter((c) => universe.has(c)),
  );
  const pending = new Set([...universe].filter((c) => !done.has(c)));

  const L: string[] = [];
  L.push('=== Diagnóstico del simulador ===');
  L.push(`versión: ${__VERSION__}`);
  L.push(
    `aprobadas ${user.approved.length} · regularizadas ${user.regularized.length} · ` +
      `cursando ${user.inProgress.length} · pendientes ${pending.size}`,
  );
  L.push(`settings: ${JSON.stringify(user.settings)}`);
  L.push(`difficult: [${user.difficult.join(',')}]`);
  L.push(`electivePref: ${JSON.stringify(electivePref)}`);
  L.push(
    `oferta: ${offer ? `"${offer.cuatrimestre ?? '?'}" con ${offer.offerings.length} materias` : 'NINGUNA'}`,
  );
  L.push(
    `manualTerms: ${manualTerms.length} cuatris [${manualTerms
      .map((t) => t.subjects.length + (t.summer ? 'v' : ''))
      .join(',')}]`,
  );
  L.push(
    `forzados: ${Object.keys(manualForcedDay).length} días, ` +
      `${Object.keys(manualForcedTurno).length} turnos`,
  );

  if (manualTerms.length === 0) {
    L.push('\nNo hay plan manual armado: no hay nada que reproducir.');
    return L.join('\n');
  }

  // Exactamente lo que hace autocompleteFrom(0), repetido.
  const keep = manualTerms.slice(0, 1);
  const preScheduled = new Map<string, number>();
  keep.forEach((t, i) => t.subjects.forEach((c) => preScheduled.set(c, i)));
  const prefixCodes = new Set([...preScheduled.keys()]);
  L.push(`\nprefijo fijado (cuatri 0), en orden: ${[...preScheduled.keys()].join(',')}`);

  const firmas: string[] = [];
  for (let i = 0; i < VUELTAS; i++) {
    const res = schedule({
      graph,
      pending: new Set([...pending].filter((c) => !prefixCodes.has(c))),
      done,
      settings: user.settings,
      offer,
      difficult: new Set(user.difficult),
      preScheduled: new Map(preScheduled),
      firstFreeTerm: keep.length,
      electivePref,
      scarcity: offer ? scarcityFromOffer(offer) : undefined,
    });
    firmas.push(
      `${res.makespan}|` + res.terms.map((t) => [...t.subjects].sort().join('+')).join('||'),
    );
  }
  // El plan que estás VIENDO, para comparar con lo que devuelve el cálculo. Si
  // no coinciden, el problema está en el cableado, no en el simulador.
  L.push(
    `\nplan en pantalla: ${manualTerms.length}|` +
      manualTerms.map((t) => [...t.subjects].sort().join('+')).join('||'),
  );

  const distintas = [...new Set(firmas)];
  L.push(`\n${VUELTAS} corridas con la MISMA entrada → ${distintas.length} resultado(s) distinto(s)`);
  if (distintas.length > 1) {
    L.push('*** ACÁ ESTÁ EL BUG: la misma entrada da resultados distintos ***');
    L.push(`secuencia: ${firmas.map((f) => distintas.indexOf(f)).join('')}`);
    distintas.forEach((f, i) => L.push(`  [${i}] ${f}`));
  } else {
    L.push('(estable) el resultado fue:');
    L.push(`  ${distintas[0]}`);
    L.push('\nComo es estable, si el plan te cambia el problema NO está en el');
    L.push('cálculo: está en qué estado se le pasa. Pegá también el plan que ves.');
  }
  return L.join('\n');
}
