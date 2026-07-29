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
  /** Electivas que elegiste a mano (cupo → día). El análisis las respeta, igual
   * que el simulador: si no, compararía contra un plan que vos no querés. */
  electivePref?: Record<string, number>;
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
  /** Si fijaste electivas a mano y eso te cuesta tiempo: a cuánto bajarías
   * dejando que el simulador las elija. */
  sinFijarElectivas?: number;
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

/** Comisiones que el usuario puede cursar (si ninguna entra, quedan todas).
 * Respeta la electiva que hayas elegido a mano. */
function comisionesDe(
  code: string,
  offMap: Map<string, Offering>,
  disponibles: Set<string> | null,
  electivePref?: Record<string, number>,
): Commission[] {
  const todas = offMap.get(code)?.commissions ?? [];
  let out = todas;
  if (disponibles) {
    const ok = out.filter((c) => commissionFitsAvailability(c, disponibles));
    out = ok.length ? ok : out;
  }
  const dia = electivePref?.[code];
  if (dia != null) {
    const fijadas = out.filter((c) => c.meetings.some((m) => m.day === dia));
    if (fijadas.length) out = fijadas;
  }
  return out;
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
  /** Materias que no pueden ir antes de cierto cuatrimestre (p.ej. si las
   * desaprobás, recién podés recursarlas al siguiente). */
  desdeCuatri?: Map<string, number>,
  /** Tope de nodos a explorar. Sin tope, busca hasta agotar el árbol. */
  maxNodos?: number,
): { plan: PlanExacto | null; agotado: boolean } {
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
  let agotado = false;
  // Cupos totales del plan y cuántos llevamos usados: si lo que falta ubicar no
  // entra en lo que queda libre, cortamos sin seguir explorando.
  const cupoTotal = T * cap;
  let ocupados = 0;
  const pesoDe = (c: string) => (graph.byCode.get(c)?.annual ? 2 : 1);
  const pesoRestante: number[] = new Array(orden.length + 1).fill(0);
  for (let i = orden.length - 1; i >= 0; i--) pesoRestante[i] = pesoRestante[i + 1] + pesoDe(orden[i]);

  const libre = (t: number, ci: number): boolean => {
    for (const otro of enCuatri[t]) if (mat.choca[otro * mat.n + ci]) return false;
    return true;
  };

  const rec = (i: number): boolean => {
    if (i >= orden.length) return true;
    if ((++nodos & 0x3fff) === 0) onNodo?.(nodos);
    if (maxNodos != null && nodos > maxNodos) { agotado = true; return true; }
    if (pesoRestante[i] > cupoTotal - ocupados) return false; // no entran: cortamos
    const c = orden[i];
    const s = graph.byCode.get(c)!;
    const anual = s.annual || s.startsOnlyFirstSemester;
    const comms = porMateria.get(c) ?? [];
    // Simetría entre electivas: la k-ésima no puede ir antes que la (k-1)-ésima.
    const ordEl = ordenElectiva.get(c);
    let minT = desdeCuatri?.get(c) ?? 0;
    if (ordEl !== undefined && ordEl > 0) {
      const previa = sol.get(electivas[ordEl - 1]);
      if (previa) minT = Math.max(minT, previa.t);
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
        ocupados += anual ? 2 : 1;

        if (rec(i + 1)) return true;

        if (comm) {
          enCuatri[t].pop();
          if (anual) enCuatri[t + 1].pop();
          if (s.isElective && dia >= 0) diasElectivas.delete(dia);
        }
        sol.delete(c);
        porCuatri[t]--;
        if (anual) porCuatri[t + 1]--;
        ocupados -= anual ? 2 : 1;
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

  const hallado = rec(0);
  if (agotado || !hallado) return { plan: null, agotado };
  const out: PlanExacto = new Map();
  for (const [code, v] of sol) out.set(code, { t: v.t, slot: v.comm ? slotDe(v.comm) : null });
  return { plan: out, agotado: false };
}

/**
 * Cota inferior rápida teniendo en cuenta que ciertas materias no pueden ir
 * antes de cierto cuatrimestre. Para cada materia calcula lo más temprano que
 * puede arrancar (por sus correlativas y por la restricción) y lo suma a la
 * cadena que cuelga de ella. Las anuales solo arrancan en 1er cuatrimestre, y
 * eso es justamente lo que puede costar un año entero.
 *
 * Sirve para descartar al toque casos imposibles sin explorar todo el árbol.
 */
function cotaConDesde(inp: OptimalityInput, desde: Map<string, number>): number {
  const { graph, pending, settings } = inp;
  const esPrimero = (i: number) =>
    (settings.startYear * 2 + (settings.startTerm - 1) + i) % 2 === 0;
  const dur = (c: string) => (graph.byCode.get(c)?.annual ? 2 : 1);

  const memoEst = new Map<string, number>();
  const est = (c: string): number => {
    const m = memoEst.get(c);
    if (m !== undefined) return m;
    memoEst.set(c, 0);
    let e = desde.get(c) ?? 0;
    for (const p of graph.prereqs.get(c) ?? []) {
      if (pending.has(p)) e = Math.max(e, est(p) + dur(p));
    }
    const s = graph.byCode.get(c);
    if (s && (s.annual || s.startsOnlyFirstSemester)) while (!esPrimero(e)) e++;
    memoEst.set(c, e);
    return e;
  };

  const memoTail = new Map<string, number>();
  const tail = (c: string): number => {
    const m = memoTail.get(c);
    if (m !== undefined) return m;
    memoTail.set(c, dur(c));
    let best = 0;
    for (const d of graph.dependents.get(c) ?? []) {
      if (pending.has(d)) best = Math.max(best, tail(d));
    }
    const v = dur(c) + best;
    memoTail.set(c, v);
    return v;
  };

  let lb = 1;
  for (const c of pending) lb = Math.max(lb, est(c) + tail(c));
  return lb;
}

/** Cuánto te cuesta desaprobar una materia. */
/** Tope de seguridad por consulta (muy alto): casi nunca se alcanza. Los
 * resultados se van entregando de a uno, así que no hace falta apurar. */
const PRESUPUESTO_RIESGO = 60_000_000;

export type Riesgo = {
  code: string;
  /** Cuatrimestres que se atrasa tu egreso si la desaprobás (0 = ninguno).
   * null si el análisis no llegó a determinarlo. */
  atraso: number | null;
  /** Último cuatrimestre (índice) en el que podés cursarla sin atrasarte. */
  limite: number | null;
};

/**
 * Para cada materia del PRIMER cuatrimestre del plan: ¿qué pasa si la
 * desaprobás? Se recalcula el mínimo posible obligándola a ir un cuatrimestre
 * más tarde (la recursada) y se compara con el plan actual.
 *
 * Es caro (una búsqueda exhaustiva por materia), por eso corre en el worker.
 */
export function analizarRiesgo(
  inp: OptimalityInput,
  delPrimerCuatri: string[],
  /** Se llama con cada materia apenas se sabe, para ir mostrando resultados. */
  onCada?: (r: Riesgo, hechas: number, total: number) => void,
): Riesgo[] {
  if (!inp.offer || delPrimerCuatri.length === 0) return [];
  const offMap = offeringMap(inp.offer);
  const disponibles = inp.settings.restrictAvailability
    ? new Set(inp.settings.availableSlots)
    : null;
  const { porMateria, mat } = preparar(inp, offMap, disponibles);
  const base = inp.actual;

  /** ¿Existe un plan de T cuatrimestres con esta materia recién desde `t`?
   * `null` = no se pudo determinar dentro del presupuesto. */
  const entra = (code: string, t: number, T: number): boolean | null => {
    const desde = new Map([[code, t]]);
    // Descarte instantáneo: si ni la cota teórica entra, no hace falta buscar.
    if (cotaConDesde(inp, desde) > T) return false;
    const r = buscarPlan(inp, T, porMateria, mat, undefined, desde, PRESUPUESTO_RIESGO);
    if (r.agotado) return null;
    return !!r.plan;
  };

  const out: Riesgo[] = [];
  let hechas = 0;
  for (const code of delPrimerCuatri) {
    // 1) Si la desaprobás la recursás al cuatrimestre siguiente: ¿te atrasa?
    //    Arrancamos en la duración actual y subimos solo si hace falta.
    let atraso: number | null = 0;
    while (atraso !== null && atraso <= 2) {
      const r = entra(code, 1, base + atraso);
      if (r === null) { atraso = null; break; }
      if (r) break;
      atraso++;
    }

    // 2) ¿Hasta cuándo podés dejarla sin perder tiempo? La propiedad "entra
    //    dejándola para el cuatri t o después" solo empeora al crecer t, así que
    //    la buscamos por bisección (3 pruebas en vez de 6).
    let limite: number | null = null;
    if (atraso === null) {
      limite = null;
    } else if (atraso > 0) {
      limite = 0; // ni siquiera aguanta un cuatrimestre: es ahora o te atrasás
    } else {
      let lo = 1;
      let hi = base - 1;
      limite = 0;
      while (lo <= hi) {
        const mid = Math.floor((lo + hi) / 2);
        const r = entra(code, mid, base);
        if (r === null) break; // sin presupuesto: nos quedamos con lo que sabemos
        if (r) {
          limite = mid;
          lo = mid + 1;
        } else {
          hi = mid - 1;
        }
      }
    }
    const r: Riesgo = { code, atraso, limite };
    out.push(r);
    onCada?.(r, ++hechas, delPrimerCuatri.length);
  }
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
    const cs = comisionesDe(c, offMap, disponibles, inp.electivePref);
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
function preparar(
  inp: OptimalityInput,
  offMap: Map<string, Offering>,
  disponibles: Set<string> | null,
  electivePref = inp.electivePref,
) {
  const porMateria = new Map<string, Commission[]>();
  for (const c of inp.pending) porMateria.set(c, comisionesDe(c, offMap, disponibles, electivePref));
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
      const { plan } = buscarPlan(inp, T, porMateria, mat, (nodos) =>
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
  let sinFijarElectivas: number | undefined;
  if (minimo === inp.actual) {
    // ¿Y si las electivas las eligiera el simulador en vez de vos?
    if (inp.electivePref && Object.keys(inp.electivePref).length > 0) {
      const libre = preparar(inp, offMap, disponibles, undefined);
      const lbLibre = cotaInferior(inp, libre.porMateria, libre.mat);
      for (let T = inp.actual - 1; T >= lbLibre; T--) {
        if (!buscarPlan(inp, T, libre.porMateria, libre.mat).plan) break;
        sinFijarElectivas = T;
      }
    }
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
        if (buscarPlan(inp, inp.actual - 1, prep.porMateria, prep.mat).plan) {
          franjas.push({ slot: extra, etiqueta: nombreDeFranja(extra) });
        }
      }
    }
  }

  return { minimo, plan: mejorPlan, motivo, franjas, sinFijarElectivas };
}
