/**
 * optimality.ts — ¿Se puede terminar antes?
 *
 * El simulador arma un plan muy bueno en milisegundos, pero no puede garantizar
 * que sea el mínimo absoluto. Este módulo hace la pregunta difícil: busca de
 * forma EXHAUSTIVA planes cada vez más cortos. Si agota el árbol sin encontrar
 * uno mejor, el plan actual es demostrablemente el mínimo posible.
 *
 * Dos cuidados clave:
 *  - Trabaja con las COMISIONES reales y su superposición horaria exacta (no con
 *    "día y turno": hay materias en el mismo turno que no se pisan, p.ej. 08-12
 *    y 12-16, y darlas por incompatibles llevaría a conclusiones falsas).
 *  - Antes de buscar calcula una cota inferior demostrable. Si el plan actual ya
 *    la alcanza, la respuesta es inmediata: es óptimo, no hay nada que buscar.
 *
 * Corre en un worker, así que puede tardar lo que haga falta sin trabar la página.
 */
import type { Graph } from './graph';
import type { OfferData, Offering, Commission } from './conflicts';
import {
  offeringMap,
  turnoOf,
  toMinutes,
  commissionsOverlap,
  commissionFitsAvailability,
  DAY_SHORT,
  TURNO_LABEL,
} from './conflicts';
import type { UserSettings } from './types';

export type OptimalityInput = {
  graph: Graph;
  pending: Set<string>;
  settings: UserSettings;
  offer: OfferData | null;
  /** Duración del plan actual (en cuatrimestres). */
  actual: number;
};

/** Dónde queda cada materia: cuatrimestre y franja "día-turno" (null si no tiene horario). */
export type PlanExacto = Map<string, { t: number; slot: string | null }>;

export type SlotSugerido = { slot: string; etiqueta: string };

export type Resultado = {
  /** El mínimo demostrado (== actual si no se puede mejorar). */
  minimo: number;
  /** El plan encontrado, si es más corto que el actual. */
  plan: PlanExacto | null;
  /** Por qué no se puede bajar más. */
  motivo?: string;
  /** Franjas que, de liberarlas, ahorrarían un cuatrimestre. */
  franjas: SlotSugerido[];
};

/** "Jueves a la noche" */
export function nombreDeFranja(slot: string): string {
  const [d, t] = slot.split('-');
  const dia = ['Lunes', 'Martes', 'Miércoles', 'Jueves', 'Viernes', 'Sábado', 'Domingo'][+d] ?? '';
  return `${dia} a la ${TURNO_LABEL[t as 'm' | 't' | 'n']}`;
}

/** "Jue noche" */
export function franjaCorta(slot: string): string {
  const [d, t] = slot.split('-');
  return `${DAY_SHORT[+d]} ${TURNO_LABEL[t as 'm' | 't' | 'n']}`;
}

/** La franja (día-turno) donde cae una comisión, para mostrarla. */
function slotDe(c: Commission): string | null {
  const m = [...c.meetings].sort((a, b) => toMinutes(a.start) - toMinutes(b.start))[0];
  return m ? `${m.day}-${turnoOf(toMinutes(m.start))}` : null;
}

/** Comisiones que el usuario puede cursar (si ninguna entra, quedan todas). */
function comisionesDe(
  code: string,
  offMap: Map<string, Offering>,
  disponibles: Set<string> | null,
): Commission[] {
  const todas = offMap.get(code)?.commissions ?? [];
  if (!disponibles) return todas;
  const ok = todas.filter((c) => commissionFitsAvailability(c, disponibles));
  return ok.length ? ok : todas;
}

/** Índice de comisiones + matriz de superposición, para chequear choques rápido. */
function armarMatriz(porMateria: Map<string, Commission[]>) {
  const lista: Commission[] = [];
  const idx = new Map<Commission, number>();
  for (const cs of porMateria.values()) {
    for (const c of cs) {
      if (!idx.has(c)) {
        idx.set(c, lista.length);
        lista.push(c);
      }
    }
  }
  const n = lista.length;
  const choca = new Uint8Array(n * n);
  for (let i = 0; i < n; i++) {
    for (let j = i + 1; j < n; j++) {
      if (commissionsOverlap(lista[i], lista[j])) {
        choca[i * n + j] = 1;
        choca[j * n + i] = 1;
      }
    }
  }
  return { lista, idx, choca, n };
}

/**
 * Cota inferior DEMOSTRABLE de cuántos cuatrimestres hacen falta:
 *  - capacidad (materias / tope por cuatri),
 *  - cadena de correlativas más larga,
 *  - materias que no pueden coexistir de a pares (camarilla).
 */
function cotaInferior(
  inp: OptimalityInput,
  porMateria: Map<string, Commission[]>,
  mat: ReturnType<typeof armarMatriz>,
): number {
  const { graph, pending, settings } = inp;
  const cap = Math.max(1, settings.maxPerTerm);

  let unidades = 0;
  for (const c of pending) unidades += graph.byCode.get(c)?.annual ? 2 : 1;
  const capLB = Math.ceil(unidades / cap);

  const memo = new Map<string, number>();
  const prof = (c: string): number => {
    const m = memo.get(c);
    if (m !== undefined) return m;
    memo.set(c, 1);
    let best = 0;
    for (const p of graph.prereqs.get(c) ?? []) {
      if (pending.has(p)) best = Math.max(best, prof(p));
    }
    const v = (graph.byCode.get(c)?.annual ? 2 : 1) + best;
    memo.set(c, v);
    return v;
  };
  let critLB = 0;
  for (const c of pending) critLB = Math.max(critLB, prof(c));

  // Camarilla: materias donde TODA comisión de una choca con TODA de la otra.
  const codes = [...pending].filter((c) => (porMateria.get(c)?.length ?? 0) > 0);
  const incompat = (a: string, b: string): boolean => {
    const ca = porMateria.get(a)!;
    const cb = porMateria.get(b)!;
    for (const x of ca) {
      for (const y of cb) {
        if (!mat.choca[mat.idx.get(x)! * mat.n + mat.idx.get(y)!]) return false;
      }
    }
    return true;
  };
  const vecinos = new Map<string, Set<string>>();
  for (const c of codes) vecinos.set(c, new Set());
  for (let i = 0; i < codes.length; i++) {
    for (let j = i + 1; j < codes.length; j++) {
      if (incompat(codes[i], codes[j])) {
        vecinos.get(codes[i])!.add(codes[j]);
        vecinos.get(codes[j])!.add(codes[i]);
      }
    }
  }
  const porGrado = [...codes].sort((a, b) => vecinos.get(b)!.size - vecinos.get(a)!.size);
  let cliqueLB = 1;
  for (const semilla of porGrado.slice(0, 12)) {
    if (vecinos.get(semilla)!.size + 1 <= cliqueLB) break;
    const cl = [semilla];
    for (const c of porGrado) {
      if (c !== semilla && cl.every((x) => vecinos.get(x)!.has(c))) cl.push(c);
    }
    if (cl.length > cliqueLB) cliqueLB = cl.length;
  }

  return Math.max(1, capLB, critLB, cliqueLB);
}

/**
 * Búsqueda exhaustiva de un plan de exactamente T cuatrimestres, eligiendo una
 * comisión concreta para cada materia. Devuelve el plan si existe, o null si
 * recorrió TODO el árbol sin encontrarlo.
 */
function buscarPlan(
  inp: OptimalityInput,
  T: number,
  porMateria: Map<string, Commission[]>,
  mat: ReturnType<typeof armarMatriz>,
  onNodo?: (nodos: number) => void,
): PlanExacto | null {
  const { graph, pending, settings } = inp;
  const cap = Math.max(1, settings.maxPerTerm);
  const esPrimerCuatri = (i: number) =>
    (settings.startYear * 2 + (settings.startTerm - 1) + i) % 2 === 0;

  // Más restringidas primero: poda muchísimo antes.
  const orden = [...pending].sort(
    (a, b) => (porMateria.get(a)!.length || 999) - (porMateria.get(b)!.length || 999),
  );
  // Las electivas son intercambiables: fijamos un orden entre ellas para no
  // recorrer las mismas soluciones permutadas (corta el árbol a la mitad varias veces).
  const electivas = orden.filter((c) => graph.byCode.get(c)?.isElective);
  const ordenElectiva = new Map(electivas.map((c, i) => [c, i]));

  const sol = new Map<string, { t: number; comm: Commission | null }>();
  const enCuatri: number[][] = Array.from({ length: T + 2 }, () => []); // índices de comisión
  const porCuatri = new Array(T + 2).fill(0);
  const diasElectivas = new Set<number>();
  let nodos = 0;

  const libre = (t: number, ci: number): boolean => {
    for (const otro of enCuatri[t]) if (mat.choca[otro * mat.n + ci]) return false;
    return true;
  };

  const rec = (i: number): boolean => {
    if (i >= orden.length) return true;
    if ((++nodos & 0x3fff) === 0) onNodo?.(nodos);
    const c = orden[i];
    const s = graph.byCode.get(c)!;
    const anual = s.annual || s.startsOnlyFirstSemester;
    const comms = porMateria.get(c) ?? [];
    // Simetría entre electivas: la k-ésima no puede ir antes que la (k-1)-ésima.
    const ordEl = ordenElectiva.get(c);
    let minT = 0;
    if (ordEl !== undefined && ordEl > 0) {
      const previa = sol.get(electivas[ordEl - 1]);
      if (previa) minT = previa.t;
    }

    for (let t = minT; t < T; t++) {
      if (anual && (!esPrimerCuatri(t) || t + 1 >= T)) continue;
      if (porCuatri[t] >= cap) continue;
      if (anual && porCuatri[t + 1] >= cap) continue;

      let ok = true;
      for (const p of graph.prereqs.get(c) ?? []) {
        if (!pending.has(p)) continue;
        const st = sol.get(p);
        if (!st) continue;
        if (st.t + (graph.byCode.get(p)!.annual ? 1 : 0) >= t) { ok = false; break; }
      }
      if (!ok) continue;
      for (const d of graph.dependents.get(c) ?? []) {
        if (!pending.has(d)) continue;
        const sd = sol.get(d);
        if (sd && sd.t <= t + (s.annual ? 1 : 0)) { ok = false; break; }
      }
      if (!ok) continue;

      const probar = (comm: Commission | null): boolean => {
        let dia = -1;
        let ci = -1;
        if (comm) {
          ci = mat.idx.get(comm)!;
          if (!libre(t, ci)) return false;
          if (anual && !libre(t + 1, ci)) return false;
          const sl = slotDe(comm);
          dia = sl ? Number(sl.split('-')[0]) : -1;
          if (s.isElective && dia >= 0 && diasElectivas.has(dia)) return false;
          enCuatri[t].push(ci);
          if (anual) enCuatri[t + 1].push(ci);
          if (s.isElective && dia >= 0) diasElectivas.add(dia);
        }
        sol.set(c, { t, comm });
        porCuatri[t]++;
        if (anual) porCuatri[t + 1]++;

        if (rec(i + 1)) return true;

        if (comm) {
          enCuatri[t].pop();
          if (anual) enCuatri[t + 1].pop();
          if (s.isElective && dia >= 0) diasElectivas.delete(dia);
        }
        sol.delete(c);
        porCuatri[t]--;
        if (anual) porCuatri[t + 1]--;
        return false;
      };

      if (comms.length === 0) {
        if (probar(null)) return true;
      } else {
        for (const comm of comms) if (probar(comm)) return true;
      }
    }
    return false;
  };

  if (!rec(0)) return null;
  const out: PlanExacto = new Map();
  for (const [code, v] of sol) out.set(code, { t: v.t, slot: v.comm ? slotDe(v.comm) : null });
  return out;
}

/** El cuello de botella: el grupo más grande de materias que comparten la única franja. */
export function cuelloDeBotella(inp: OptimalityInput): { cantidad: number; franja: string } | null {
  if (!inp.offer) return null;
  const offMap = offeringMap(inp.offer);
  const disponibles = inp.settings.restrictAvailability
    ? new Set(inp.settings.availableSlots)
    : null;
  const porFranja = new Map<string, number>();
  for (const c of inp.pending) {
    const cs = comisionesDe(c, offMap, disponibles);
    const slots = new Set(cs.map(slotDe).filter((s): s is string => !!s));
    if (slots.size === 1) {
      const s = [...slots][0];
      porFranja.set(s, (porFranja.get(s) ?? 0) + 1);
    }
  }
  let mejor: { cantidad: number; franja: string } | null = null;
  for (const [franja, cantidad] of porFranja) {
    if (!mejor || cantidad > mejor.cantidad) mejor = { cantidad, franja };
  }
  return mejor && mejor.cantidad >= 2 ? mejor : null;
}

/** Prepara comisiones + matriz para una disponibilidad dada. */
function preparar(inp: OptimalityInput, offMap: Map<string, Offering>, disponibles: Set<string> | null) {
  const porMateria = new Map<string, Commission[]>();
  for (const c of inp.pending) porMateria.set(c, comisionesDe(c, offMap, disponibles));
  return { porMateria, mat: armarMatriz(porMateria) };
}

/**
 * Busca el plan MÁS CORTO posible. Baja de a un cuatrimestre hasta demostrar que
 * no se puede más, sin límite de tiempo (pensado para correr en un worker).
 * Si el plan actual ya alcanza la cota inferior demostrable, responde al toque.
 */
export function buscarMinimo(
  inp: OptimalityInput,
  onProgreso?: (info: { probando: number; nodos: number }) => void,
): Resultado {
  if (!inp.offer || inp.pending.size === 0 || inp.actual <= 1) {
    return { minimo: inp.actual, plan: null, franjas: [] };
  }
  const offMap = offeringMap(inp.offer);
  const disponibles = inp.settings.restrictAvailability
    ? new Set(inp.settings.availableSlots)
    : null;
  const { porMateria, mat } = preparar(inp, offMap, disponibles);

  const lb = cotaInferior(inp, porMateria, mat);
  let minimo = inp.actual;
  let mejorPlan: PlanExacto | null = null;

  // Si ya está en la cota, es óptimo: no hay nada que buscar.
  if (inp.actual > lb) {
    for (let T = inp.actual - 1; T >= lb; T--) {
      const plan = buscarPlan(inp, T, porMateria, mat, (nodos) =>
        onProgreso?.({ probando: T, nodos }),
      );
      if (!plan) break; // demostrado: no existe plan de T cuatris
      minimo = T;
      mejorPlan = plan;
    }
  }

  // Si no se puede mejorar, ¿qué franja lo destrabaría?
  const franjas: SlotSugerido[] = [];
  let motivo: string | undefined;
  if (minimo === inp.actual) {
    const cuello = cuelloDeBotella(inp);
    if (cuello) {
      motivo = `${cuello.cantidad} materias se dictan únicamente el ${nombreDeFranja(
        cuello.franja,
      )}, y solo podés cursar una por cuatrimestre.`;
    }
    if (inp.settings.restrictAvailability && disponibles) {
      const candidatas = new Set<string>();
      for (const c of inp.pending) {
        for (const cm of offMap.get(c)?.commissions ?? []) {
          for (const m of cm.meetings) {
            const s = `${m.day}-${turnoOf(toMinutes(m.start))}`;
            if (!disponibles.has(s)) candidatas.add(s);
          }
        }
      }
      for (const extra of candidatas) {
        const conExtra = new Set([...disponibles, extra]);
        const prep = preparar(inp, offMap, conExtra);
        // Solo tiene sentido probar si la cota lo permite.
        if (cotaInferior(inp, prep.porMateria, prep.mat) > inp.actual - 1) continue;
        if (buscarPlan(inp, inp.actual - 1, prep.porMateria, prep.mat)) {
          franjas.push({ slot: extra, etiqueta: nombreDeFranja(extra) });
        }
      }
    }
  }

  return { minimo, plan: mejorPlan, motivo, franjas };
}
