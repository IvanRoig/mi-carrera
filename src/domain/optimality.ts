/**
 * optimality.ts — ¿Se puede terminar antes?
 *
 * El simulador arma un plan muy bueno en milisegundos, pero no puede garantizar
 * que sea el mínimo absoluto. Este módulo hace la pregunta difícil a pedido:
 * busca de forma EXHAUSTIVA si existe un plan más corto. Si agota el árbol sin
 * encontrarlo, el plan actual es demostrablemente el mínimo.
 *
 * También explica el cuello de botella (qué es lo que te frena) y qué franja
 * horaria destrabaría un cuatrimestre si pudieras liberarla.
 */
import type { Graph } from './graph';
import type { OfferData, Offering } from './conflicts';
import { offeringMap, turnoOf, toMinutes, commissionFitsAvailability, DAY_SHORT, TURNO_LABEL } from './conflicts';
import type { UserSettings } from './types';

export type OptimalityInput = {
  graph: Graph;
  pending: Set<string>;
  settings: UserSettings;
  offer: OfferData | null;
  /** Duración del plan actual (en cuatrimestres). */
  actual: number;
};

export type Verdict =
  | { estado: 'optimo'; motivo?: string }
  | { estado: 'mejorable'; minimo: number }
  | { estado: 'indeterminado' };

export type SlotSugerido = { slot: string; etiqueta: string };

/** Presupuesto de nodos: acota el tiempo (≈1s) para no colgar la página. */
const PRESUPUESTO = 2_000_000;

/** Franjas (día-turno) donde se puede cursar, dentro de la disponibilidad dada. */
function slotsDe(
  code: string,
  offMap: Map<string, Offering>,
  disponibles: Set<string> | null,
): string[] {
  const out = new Set<string>();
  for (const cm of offMap.get(code)?.commissions ?? []) {
    if (disponibles && !commissionFitsAvailability(cm, disponibles)) continue;
    for (const m of cm.meetings) out.add(`${m.day}-${turnoOf(toMinutes(m.start))}`);
  }
  return [...out];
}

/** Nombre legible de una franja: "Jueves a la noche". */
export function nombreDeFranja(slot: string): string {
  const [d, t] = slot.split('-');
  const dia = ['Lunes', 'Martes', 'Miércoles', 'Jueves', 'Viernes', 'Sábado', 'Domingo'][+d] ?? '';
  return `${dia} a la ${TURNO_LABEL[t as 'm' | 't' | 'n']}`;
}

/**
 * Búsqueda exhaustiva: ¿existe un plan de T cuatrimestres? Asigna a cada materia
 * un (cuatri, franja) respetando correlativas, una materia por franja, el tope
 * por cuatri, las anuales (solo arrancan en 1er cuatri y ocupan dos) y que las
 * electivas caigan en días distintos.
 *
 * Devuelve `false` solo si recorrió TODO el árbol sin encontrar solución.
 */
function existePlan(
  inp: OptimalityInput,
  T: number,
  disponibles: Set<string> | null,
  offMap: Map<string, Offering>,
): { ok: boolean; agotado: boolean } {
  const { graph, pending, settings } = inp;
  const cap = Math.max(1, settings.maxPerTerm);
  const codes = [...pending];
  const esPrimerCuatri = (i: number) =>
    (settings.startYear * 2 + (settings.startTerm - 1) + i) % 2 === 0;

  const opciones = new Map<string, string[]>();
  for (const c of codes) opciones.set(c, slotsDe(c, offMap, disponibles));
  // Las materias sin horario conocido no compiten por franjas: las tratamos
  // aparte (siempre entran, mientras haya cupo).
  const conHorario = codes.filter((c) => opciones.get(c)!.length > 0);
  const sinHorario = codes.filter((c) => opciones.get(c)!.length === 0);

  // Más restringidas primero: poda muchísimo antes.
  const orden = [...conHorario, ...sinHorario].sort(
    (a, b) => (opciones.get(a)!.length || 99) - (opciones.get(b)!.length || 99),
  );

  const start = new Map<string, number>();
  const ocupado = new Set<string>();
  const porCuatri = new Array(T + 2).fill(0);
  const diasElectivas = new Set<number>();
  let nodos = 0;
  let agotado = false;

  const rec = (i: number): boolean => {
    if (i >= orden.length) return true;
    if (++nodos > PRESUPUESTO) {
      agotado = true;
      return true; // cortamos: no podemos afirmar nada
    }
    const c = orden[i];
    const s = graph.byCode.get(c)!;
    const anual = s.annual || s.startsOnlyFirstSemester;
    const slots = opciones.get(c)!;

    for (let t = 0; t < T; t++) {
      if (anual && (!esPrimerCuatri(t) || t + 1 >= T)) continue;
      if (porCuatri[t] >= cap) continue;
      if (anual && porCuatri[t + 1] >= cap) continue;

      let ok = true;
      for (const p of graph.prereqs.get(c) ?? []) {
        if (!pending.has(p)) continue;
        const st = start.get(p);
        if (st === undefined) continue;
        if (st + (graph.byCode.get(p)!.annual ? 1 : 0) >= t) { ok = false; break; }
      }
      if (!ok) continue;
      for (const d of graph.dependents.get(c) ?? []) {
        if (!pending.has(d)) continue;
        const sd = start.get(d);
        if (sd !== undefined && sd <= t + (s.annual ? 1 : 0)) { ok = false; break; }
      }
      if (!ok) continue;

      const poner = (slot: string | null): boolean => {
        const dia = slot ? Number(slot.split('-')[0]) : -1;
        if (slot && s.isElective && diasElectivas.has(dia)) return false;
        const k1 = slot ? `${t}|${slot}` : '';
        const k2 = slot ? `${t + 1}|${slot}` : '';
        if (slot && (ocupado.has(k1) || (anual && ocupado.has(k2)))) return false;
        if (slot) { ocupado.add(k1); if (anual) ocupado.add(k2); }
        start.set(c, t);
        porCuatri[t]++;
        if (anual) porCuatri[t + 1]++;
        if (slot && s.isElective) diasElectivas.add(dia);
        if (rec(i + 1)) return true;
        if (slot) { ocupado.delete(k1); if (anual) ocupado.delete(k2); }
        start.delete(c);
        porCuatri[t]--;
        if (anual) porCuatri[t + 1]--;
        if (slot && s.isElective) diasElectivas.delete(dia);
        return false;
      };

      if (slots.length === 0) {
        if (poner(null)) return true;
      } else {
        for (const slot of slots) if (poner(slot)) return true;
      }
    }
    return false;
  };

  const ok = rec(0);
  return { ok, agotado };
}

/**
 * El cuello de botella: el grupo más grande de materias que no pueden cursarse
 * juntas porque comparten la única franja en la que se dictan.
 */
export function cuelloDeBotella(inp: OptimalityInput): { cantidad: number; franja: string } | null {
  if (!inp.offer) return null;
  const offMap = offeringMap(inp.offer);
  const disponibles = inp.settings.restrictAvailability
    ? new Set(inp.settings.availableSlots)
    : null;
  const porFranja = new Map<string, number>();
  for (const c of inp.pending) {
    const s = slotsDe(c, offMap, disponibles);
    if (s.length === 1) porFranja.set(s[0], (porFranja.get(s[0]) ?? 0) + 1);
  }
  let mejor: { cantidad: number; franja: string } | null = null;
  for (const [franja, cantidad] of porFranja) {
    if (!mejor || cantidad > mejor.cantidad) mejor = { cantidad, franja };
  }
  return mejor && mejor.cantidad >= 2 ? mejor : null;
}

/** ¿El plan actual es el más corto posible? Búsqueda exhaustiva de `actual - 1`. */
export function analizarOptimo(inp: OptimalityInput): Verdict {
  if (!inp.offer || inp.pending.size === 0 || inp.actual <= 1) return { estado: 'optimo' };
  const offMap = offeringMap(inp.offer);
  const disponibles = inp.settings.restrictAvailability
    ? new Set(inp.settings.availableSlots)
    : null;
  const r = existePlan(inp, inp.actual - 1, disponibles, offMap);
  if (r.agotado) return { estado: 'indeterminado' };
  if (r.ok) return { estado: 'mejorable', minimo: inp.actual - 1 };
  const cuello = cuelloDeBotella(inp);
  return {
    estado: 'optimo',
    motivo: cuello
      ? `${cuello.cantidad} materias se dictan únicamente el ${nombreDeFranja(cuello.franja)}, y solo podés cursar una por cuatrimestre.`
      : undefined,
  };
}

/**
 * Qué franjas horarias, de poder liberarlas, te ahorrarían un cuatrimestre.
 * Se evalúan de a una; devuelve las que alcanzan.
 */
export function franjasQueDestraban(inp: OptimalityInput): SlotSugerido[] {
  if (!inp.offer || !inp.settings.restrictAvailability) return [];
  const offMap = offeringMap(inp.offer);
  const actuales = new Set(inp.settings.availableSlots);
  // Solo tiene sentido probar franjas donde realmente se dicta algo que te falta.
  const candidatas = new Set<string>();
  for (const c of inp.pending) {
    for (const cm of offMap.get(c)?.commissions ?? []) {
      for (const m of cm.meetings) {
        const s = `${m.day}-${turnoOf(toMinutes(m.start))}`;
        if (!actuales.has(s)) candidatas.add(s);
      }
    }
  }
  const out: SlotSugerido[] = [];
  for (const extra of candidatas) {
    const conExtra = new Set([...actuales, extra]);
    const r = existePlan(inp, inp.actual - 1, conExtra, offMap);
    if (r.ok && !r.agotado) out.push({ slot: extra, etiqueta: nombreDeFranja(extra) });
  }
  return out;
}

/** Etiqueta corta para mostrar: "Jue-noche". */
export function franjaCorta(slot: string): string {
  const [d, t] = slot.split('-');
  return `${DAY_SHORT[+d]} ${TURNO_LABEL[t as 'm' | 't' | 'n']}`;
}
