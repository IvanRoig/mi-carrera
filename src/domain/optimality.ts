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
import { schedule } from './scheduler';

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
  /** Materias que estás cursando: van fijas en el cuatrimestre actual. */
  enCurso?: string[];
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

  let cliqueLB = 1;
  for (const cl of camarillas(pending, porMateria, mat)) {
    if (cl.length > cliqueLB) cliqueLB = cl.length;
  }

  return Math.max(1, capLB, critLB, cliqueLB);
}

/**
 * Camarillas de materias mutuamente incompatibles: grupos donde TODA comisión de
 * una choca con TODA comisión de la otra, así que solo puede entrar UNA por
 * cuatrimestre. Es la restricción más dura del problema (p.ej. las cinco que
 * solo se dictan el jueves a la noche) y sirve tanto para la cota inferior como
 * para podar la búsqueda.
 */
function camarillas(
  pending: Set<string>,
  porMateria: Map<string, Commission[]>,
  mat: ReturnType<typeof armarMatriz>,
): string[][] {
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
  const out: string[][] = [];
  const vistas = new Set<string>();
  for (const semilla of porGrado) {
    if (vecinos.get(semilla)!.size === 0) break; // sin vecinos ya no hay camarillas
    const cl = [semilla];
    for (const c of porGrado) {
      if (c !== semilla && cl.every((x) => vecinos.get(x)!.has(c))) cl.push(c);
    }
    if (cl.length < 2) continue;
    const clave = [...cl].sort().join(',');
    if (vistas.has(clave)) continue;
    vistas.add(clave);
    out.push(cl);
  }
  return out;
}

/**
 * Aprieta las ventanas [est, lst] hasta que no se pueda más (punto fijo).
 *
 * Es el razonamiento que uno hace a mano: "hay cinco materias que solo se dictan
 * el jueves a la noche; en seis cuatrimestres tienen que ocupar cinco jueves
 * distintos; si empujo una al segundo cuatri, las cinco quedan encajadas en los
 * cinco últimos y no sobra ninguno". Cada deducción de ese tipo achica las
 * ventanas, lo que habilita la siguiente, y así hasta que se estabiliza.
 *
 * Tres reglas, todas exactas (jamás descartan un plan que exista):
 *  · correlativas: una materia no arranca antes que sus previas ni tan tarde que
 *    su cadena no llegue a terminar;
 *  · camarillas: en un grupo de materias que se pisan entre sí entra UNA por
 *    cuatrimestre, así que si las que ya están obligadas a caer en un tramo
 *    llenan ese tramo, el resto del grupo queda afuera;
 *  · capacidad: lo mismo con el tope de materias por cuatrimestre.
 *
 * Devuelve false si alguna ventana queda vacía: ahí quedó DEMOSTRADO que no hay
 * plan de T cuatrimestres, sin explorar un solo nodo.
 */
function propagarVentanas(
  inp: OptimalityInput,
  T: number,
  est: Map<string, number>,
  lst: Map<string, number>,
  cliques: string[][],
  esPrimerCuatri: (t: number) => boolean,
  pesoDe: (c: string) => number,
  anualDe: (c: string) => boolean,
): boolean {
  const { graph, pending, settings } = inp;
  const cap = Math.max(1, settings.maxPerTerm);
  const codes = [...pending];

  const subirEst = (c: string, v: number): boolean => {
    let e = v;
    if (anualDe(c)) while (e <= T && !esPrimerCuatri(e)) e++;
    if (e <= est.get(c)!) return false;
    est.set(c, e);
    return true;
  };
  const bajarLst = (c: string, v: number): boolean => {
    let l = v;
    if (anualDe(c)) while (l >= 0 && !esPrimerCuatri(l)) l--;
    if (l >= lst.get(c)!) return false;
    lst.set(c, l);
    return true;
  };
  const vacia = () => codes.some((c) => est.get(c)! > lst.get(c)!);
  /** ¿La materia entra completa en el tramo [a,b]? (las anuales ocupan dos) */
  const encerrada = (c: string, a: number, b: number) =>
    est.get(c)! >= a && lst.get(c)! + pesoDe(c) - 1 <= b;

  for (let vuelta = 0; vuelta < 20; vuelta++) {
    let cambio = false;

    for (const c of codes) {
      for (const p of graph.prereqs.get(c) ?? []) {
        if (!pending.has(p)) continue;
        if (subirEst(c, est.get(p)! + pesoDe(p))) cambio = true;
        if (bajarLst(p, lst.get(c)! - pesoDe(p))) cambio = true;
      }
    }
    if (vacia()) return false;

    for (const K of cliques) {
      for (let a = 0; a < T; a++) {
        for (let b = a; b < T; b++) {
          const dentro = K.filter((c) => est.get(c)! >= a && lst.get(c)! <= b);
          if (dentro.length > b - a + 1) return false;
          if (dentro.length !== b - a + 1) continue;
          // El tramo quedó completo: los demás del grupo van afuera.
          for (const m of K) {
            if (dentro.includes(m)) continue;
            if (est.get(m)! >= a) {
              if (subirEst(m, b + 1)) cambio = true;
            } else if (lst.get(m)! <= b) {
              if (bajarLst(m, a - 1)) cambio = true;
            }
          }
        }
      }
    }
    if (vacia()) return false;

    for (let a = 0; a < T; a++) {
      for (let b = a; b < T; b++) {
        let peso = 0;
        for (const c of codes) if (encerrada(c, a, b)) peso += pesoDe(c);
        const cupo = (b - a + 1) * cap;
        if (peso > cupo) return false;
        if (peso !== cupo) continue;
        for (const c of codes) {
          if (encerrada(c, a, b)) continue;
          if (est.get(c)! >= a) {
            if (subirEst(c, b + 1)) cambio = true;
          } else if (lst.get(c)! + pesoDe(c) - 1 <= b) {
            if (bajarLst(c, a - 1)) cambio = true;
          }
        }
      }
    }
    if (vacia()) return false;

    if (!cambio) break;
  }
  return true;
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
  /** Tope de tiempo en ms. Sin tope, busca hasta agotar el árbol. */
  msTope?: number,
  /** Materias con cuatrimestre ya decidido (las que estás cursando). */
  fijoEn?: Map<string, number>,
): { plan: PlanExacto | null; agotado: boolean } {
  const { graph, pending, settings } = inp;
  const cap = Math.max(1, settings.maxPerTerm);
  const esPrimerCuatri = (i: number) =>
    (settings.startYear * 2 + (settings.startTerm - 1) + i) % 2 === 0;

  const codes = [...pending];
  const pesoDe = (c: string) => (graph.byCode.get(c)?.annual ? 2 : 1);
  const anualDe = (c: string) => {
    const s = graph.byCode.get(c);
    return !!s && (s.annual || s.startsOnlyFirstSemester);
  };

  // ---- Ventana [est, lst] de cada materia -------------------------------
  // est = lo más temprano que puede arrancar (por sus correlativas y por lo que
  // le impongamos); lst = lo más tarde, para que la cadena que cuelga de ella
  // todavía termine dentro de T. Si alguna ventana queda vacía, no hay plan y
  // lo sabemos sin explorar nada.
  const memoTail = new Map<string, number>();
  const tail = (c: string): number => {
    const m = memoTail.get(c);
    if (m !== undefined) return m;
    memoTail.set(c, pesoDe(c));
    let best = 0;
    for (const d of graph.dependents.get(c) ?? []) {
      if (pending.has(d)) best = Math.max(best, tail(d));
    }
    const v = pesoDe(c) + best;
    memoTail.set(c, v);
    return v;
  };
  const memoEst = new Map<string, number>();
  const estBase = (c: string): number => {
    const m = memoEst.get(c);
    if (m !== undefined) return m;
    memoEst.set(c, 0);
    let e = fijoEn?.get(c) ?? desdeCuatri?.get(c) ?? 0;
    for (const p of graph.prereqs.get(c) ?? []) {
      if (pending.has(p)) e = Math.max(e, estBase(p) + pesoDe(p));
    }
    if (anualDe(c)) while (!esPrimerCuatri(e)) e++;
    memoEst.set(c, e);
    return e;
  };
  const est0 = new Map(codes.map((c) => [c, estBase(c)]));
  const lstDe = new Map<string, number>();
  for (const c of codes) {
    let l = fijoEn?.get(c) ?? T - tail(c);
    if (anualDe(c)) while (l >= 0 && !esPrimerCuatri(l)) l--;
    lstDe.set(c, l);
  }

  const camarillasStr = camarillas(pending, porMateria, mat);
  // Apretar las ventanas ANTES de buscar: muchas veces alcanza para demostrar
  // que no hay plan (respuesta instantánea), y cuando no alcanza deja la
  // búsqueda con muchísimo menos por probar.
  if (!propagarVentanas(inp, T, est0, lstDe, camarillasStr, esPrimerCuatri, pesoDe, anualDe)) {
    return { plan: null, agotado: false };
  }

  // Ancestros con su distancia: al fijar una materia sabemos al toque cuánto se
  // corre el arranque más temprano de todo lo que depende de ella.
  const ancDe = new Map<string, [string, number][]>(codes.map((c) => [c, []]));
  const distDesde = (a: string) => {
    const alcanza = new Map<string, number>();
    const ir = (x: string, d: number) => {
      for (const y of graph.dependents.get(x) ?? []) {
        if (!pending.has(y)) continue;
        const nd = d + pesoDe(x);
        if ((alcanza.get(y) ?? -1) >= nd) continue;
        alcanza.set(y, nd);
        ir(y, nd);
      }
    };
    ir(a, 0);
    return alcanza;
  };
  for (const a of codes) {
    for (const [c, d] of distDesde(a)) ancDe.get(c)!.push([a, d]);
  }

  // Más restringidas primero: poda muchísimo antes. A igualdad de comisiones,
  // las de ventana más chica (menos cuatrimestres donde pueden ir).
  const holgura = (c: string) => lstDe.get(c)! - est0.get(c)!;
  const orden = codes.sort(
    (a, b) =>
      (porMateria.get(a)!.length || 999) - (porMateria.get(b)!.length || 999) ||
      holgura(a) - holgura(b),
  );
  // Las electivas son intercambiables: fijamos un orden entre ellas para no
  // recorrer las mismas soluciones permutadas (corta el árbol a la mitad varias veces).
  const electivas = orden.filter((c) => graph.byCode.get(c)?.isElective);
  const ordenElectiva = new Map(electivas.map((c, i) => [c, i]));

  // ---- Todo lo que se toca en el bucle caliente, en enteros --------------
  // Las podas corren en CADA nodo (millones): con Maps y arrays nuevos costaban
  // más de lo que ahorraban. Acá va todo indexado por posición en `orden`, sobre
  // buffers reservados una sola vez.
  const n = orden.length;
  const pos = new Map(orden.map((c, i) => [c, i]));
  const pesoI = new Int32Array(n);
  const anualI = new Uint8Array(n);
  const est0I = new Int32Array(n);
  const lstI = new Int32Array(n);
  const ancI: Int32Array[] = [];
  const ancD: Int32Array[] = [];
  for (let i = 0; i < n; i++) {
    const c = orden[i];
    pesoI[i] = pesoDe(c);
    anualI[i] = anualDe(c) ? 1 : 0;
    est0I[i] = est0.get(c)!;
    lstI[i] = lstDe.get(c)!;
    const lista = ancDe.get(c)!;
    ancI.push(Int32Array.from(lista.map(([a]) => pos.get(a)!)));
    ancD.push(Int32Array.from(lista.map(([, d]) => d)));
  }
  const primero = new Uint8Array(T + 2);
  for (let t = 0; t < T + 2; t++) primero[t] = esPrimerCuatri(t) ? 1 : 0;
  // Las camarillas grandes son las que podan; las chicas casi no aportan y se
  // pagan en cada nodo.
  const cliqI = [...camarillasStr]
    .sort((a, b) => b.length - a.length)
    .slice(0, 4)
    .map((K) => Int32Array.from(K.map((c) => pos.get(c)!)));
  const estArr = new Int32Array(n);
  const bufA = new Int32Array(T + 2);
  const bufB = new Int32Array(T + 2);
  const solT = new Int32Array(n).fill(-1);

  const sol = new Map<string, { t: number; comm: Commission | null }>();
  const enCuatri: number[][] = Array.from({ length: T + 2 }, () => []); // índices de comisión
  const porCuatri = new Int32Array(T + 2);
  const diasElectivas = new Set<number>();
  let nodos = 0;
  let agotado = false;
  const arranque = Date.now();
  // Cupos totales del plan y cuántos llevamos usados: si lo que falta ubicar no
  // entra en lo que queda libre, cortamos sin seguir explorando.
  const cupoTotal = T * cap;
  let ocupados = 0;
  const pesoRestante: number[] = new Array(orden.length + 1).fill(0);
  for (let i = orden.length - 1; i >= 0; i--) pesoRestante[i] = pesoRestante[i + 1] + pesoDe(orden[i]);

  const libre = (t: number, ci: number): boolean => {
    for (const otro of enCuatri[t]) if (mat.choca[otro * mat.n + ci]) return false;
    return true;
  };

  /**
   * ¿Lo que queda por ubicar todavía puede entrar? Tres razones para cortar,
   * todas demostrables (nunca descartan un plan que exista):
   *
   *  1. Ventana vacía: una materia ya no llega a arrancar a tiempo para que la
   *     cadena de correlativas que cuelga de ella termine dentro de T.
   *  2. Capacidad: las que están obligadas a ir en los primeros k cuatrimestres
   *     no entran en los cupos de esos k (y lo mismo mirando desde el final).
   *  3. Camarillas: de un grupo de materias que se pisan entre sí solo entra una
   *     por cuatrimestre; si las obligadas a ir temprano son más que los
   *     cuatrimestres disponibles, no hay forma.
   *
   * Es la diferencia entre demostrar "no se puede" en milisegundos o no
   * terminar nunca.
   */
  const puedeEntrar = (desde: number): boolean => {
    // 1) Ventanas, con lo que ya fijamos. Las materias 0..desde-1 ya tienen
    //    cuatrimestre (en solT); las que siguen, no.
    for (let j = desde; j < n; j++) {
      let e = est0I[j];
      const ai = ancI[j];
      const ad = ancD[j];
      for (let k = 0; k < ai.length; k++) {
        const a = ai[k];
        if (a < desde) {
          const v = solT[a] + ad[k];
          if (v > e) e = v;
        }
      }
      if (anualI[j]) while (e <= T && !primero[e]) e++;
      if (e > lstI[j]) return false;
      estArr[j] = e;
    }

    // 2) Capacidad por prefijo y por sufijo.
    bufA.fill(0);
    bufB.fill(0);
    for (let j = desde; j < n; j++) {
      const l = lstI[j] < 0 ? 0 : lstI[j] > T ? T : lstI[j];
      const e = estArr[j] < 0 ? 0 : estArr[j] > T ? T : estArr[j];
      // Una anual arranca en `l` como muy tarde, pero su segundo cuatrimestre cae
      // en l+1: cargarle los dos cupos en el prefijo [0..l] contaría de más y
      // podría descartar un plan que sí existe.
      bufA[l] += 1;
      if (pesoI[j] > 1) bufA[l + 1 > T ? T : l + 1] += 1;
      // Mirando desde el final es al revés: si arranca en `e` o después, sus dos
      // cupos están en [e..T), así que los dos cuentan.
      bufB[e] += pesoI[j];
    }
    let acc = 0;
    let usados = 0;
    for (let k = 0; k < T; k++) {
      acc += bufA[k];
      usados += porCuatri[k];
      if (usados + acc > (k + 1) * cap) return false;
    }
    acc = 0;
    usados = 0;
    for (let k = T - 1; k >= 0; k--) {
      acc += bufB[k];
      usados += porCuatri[k];
      if (usados + acc > (T - k) * cap) return false;
    }

    // 3) Camarillas: una sola por cuatrimestre.
    for (let q = 0; q < cliqI.length; q++) {
      const K = cliqI[q];
      bufA.fill(0);
      bufB.fill(0);
      for (let x = 0; x < K.length; x++) {
        const j = K[x];
        let ini: number;
        let fin: number;
        if (j < desde) {
          ini = fin = solT[j];
        } else {
          ini = estArr[j] < 0 ? 0 : estArr[j];
          fin = lstI[j] < 0 ? 0 : lstI[j];
        }
        bufA[fin > T ? T : fin]++;
        bufB[ini > T ? T : ini]++;
      }
      let m = 0;
      for (let k = 0; k < T; k++) {
        m += bufA[k];
        if (m > k + 1) return false;
      }
      m = 0;
      for (let k = T - 1; k >= 0; k--) {
        m += bufB[k];
        if (m > T - k) return false;
      }
    }
    return true;
  };

  const rec = (i: number): boolean => {
    if (i >= orden.length) return true;
    if ((++nodos & 0x3fff) === 0) {
      onNodo?.(nodos);
      // Un reloj cada 16k nodos: el costo por nodo cambió mucho al meter podas,
      // así que un tope en tiempo es más predecible que uno en cantidad.
      if (msTope != null && Date.now() - arranque > msTope) { agotado = true; return true; }
    }
    if (pesoRestante[i] > cupoTotal - ocupados) return false; // no entran: cortamos
    if (!puedeEntrar(i)) return false;
    const c = orden[i];
    const s = graph.byCode.get(c)!;
    const anual = s.annual || s.startsOnlyFirstSemester;
    const comms = porMateria.get(c) ?? [];
    // Simetría entre electivas: la k-ésima no puede ir antes que la (k-1)-ésima.
    const fijo = fijoEn?.get(c);
    const ordEl = ordenElectiva.get(c);
    // La ventana ya apretada manda: probar cuatrimestres fuera de [est, lst] es
    // tiempo tirado (ahí no puede ir, está demostrado).
    let minT = Math.max(desdeCuatri?.get(c) ?? 0, estArr[i]);
    if (ordEl !== undefined && ordEl > 0) {
      const previa = sol.get(electivas[ordEl - 1]);
      if (previa) minT = Math.max(minT, previa.t);
    }
    const maxT = Math.min(T - 1, lstI[i]);

    for (let t = minT; t <= maxT; t++) {
      if (fijo != null && t !== fijo) continue; // ya sabemos cuándo va
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
        solT[i] = t;
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
        solT[i] = -1;
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

  /**
   * Intento CONSTRUCTIVO, antes de la búsqueda exhaustiva.
   *
   * El árbol de arriba está armado para demostrar que algo es imposible: ataca
   * primero las materias más atadas. Eso lo hace malísimo para lo contrario —
   * encontrar un plan cuando sobra lugar — porque pelea contra el orden de las
   * correlativas y se va a backtrackear millones de veces.
   *
   * Acá hacemos lo obvio: recorrer las materias en orden de correlativas (el est
   * ya es un orden topológico válido) y meter cada una en el primer
   * cuatrimestre donde entre. Sale en microsegundos y, cuando sale, no hace
   * falta tocar el árbol. Probamos unos cuantos criterios de desempate porque un
   * first-fit sin backtracking a veces se traba por poco.
   */
  const intentarDirecto = (semilla: number): PlanExacto | null => {
    const porT = new Int32Array(T + 2);
    const enT: number[][] = Array.from({ length: T + 2 }, () => []);
    const dias = new Set<number>();
    const cuando = new Map<string, number>();
    const out: PlanExacto = new Map();
    const revuelto = (c: string) => {
      let h = semilla * 2654435761;
      for (let k = 0; k < c.length; k++) h = (h ^ c.charCodeAt(k)) * 16777619;
      return h >>> 8;
    };
    const lista = [...orden].sort(
      (a, b) =>
        est0.get(a)! - est0.get(b)! ||
        (semilla === 0
          ? tail(b) - tail(a) // primero las que arrastran cadena más larga
          : semilla === 1
            ? (porMateria.get(a)!.length || 99) - (porMateria.get(b)!.length || 99)
            : revuelto(a) - revuelto(b)),
    );
    for (const c of lista) {
      const s = graph.byCode.get(c)!;
      const anual = s.annual || s.startsOnlyFirstSemester;
      const comms = porMateria.get(c) ?? [];
      const fijo = fijoEn?.get(c);
      const desdeT =
        fijo != null ? fijo : Math.max(est0.get(c)!, desdeCuatri?.get(c) ?? 0);
      const hastaT = fijo != null ? fijo : Math.min(T - 1, lstDe.get(c)!);
      let puesto = false;
      for (let t = desdeT; t <= hastaT && !puesto; t++) {
        if (anual && (!esPrimerCuatri(t) || t + 1 >= T)) continue;
        if (porT[t] >= cap) continue;
        if (anual && porT[t + 1] >= cap) continue;
        let ok = true;
        for (const p of graph.prereqs.get(c) ?? []) {
          if (!pending.has(p)) continue;
          const tp = cuando.get(p);
          // El orden es topológico, así que la previa ya está ubicada.
          if (tp == null || tp + (graph.byCode.get(p)!.annual ? 1 : 0) >= t) {
            ok = false;
            break;
          }
        }
        if (!ok) continue;
        const elegir = (comm: Commission | null): boolean => {
          let dia = -1;
          if (comm) {
            const ci = mat.idx.get(comm)!;
            for (const o of enT[t]) if (mat.choca[o * mat.n + ci]) return false;
            if (anual) for (const o of enT[t + 1]) if (mat.choca[o * mat.n + ci]) return false;
            const sl = slotDe(comm);
            dia = sl ? Number(sl.split('-')[0]) : -1;
            if (s.isElective && dia >= 0 && dias.has(dia)) return false;
            enT[t].push(ci);
            if (anual) enT[t + 1].push(ci);
            if (s.isElective && dia >= 0) dias.add(dia);
          }
          porT[t]++;
          if (anual) porT[t + 1]++;
          cuando.set(c, t);
          out.set(c, { t, slot: comm ? slotDe(comm) : null });
          return true;
        };
        if (comms.length === 0) puesto = elegir(null);
        else for (const comm of comms) if (elegir(comm)) { puesto = true; break; }
      }
      if (!puesto) return null;
    }
    return out;
  };

  for (let semilla = 0; semilla < 12; semilla++) {
    const directo = intentarDirecto(semilla);
    if (directo) return { plan: directo, agotado: false };
  }

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

/** Cuánto te cuesta desaprobar una materia. Tope de seguridad por pregunta: con
 * las podas fuertes casi nunca se alcanza, y si se alcanza es mejor decir "no
 * llegué a determinarlo" que dejar el análisis colgado para siempre. */
const MS_POR_PREGUNTA = 15_000;

/**
 * ¿Existe un plan de T cuatrimestres si esta materia no puede arrancar antes del
 * cuatrimestre `t`? (las demás que estás cursando quedan donde están).
 * `null` = no se pudo determinar dentro del presupuesto de tiempo.
 */
function consultar(
  inp: OptimalityInput,
  porMateria: Map<string, Commission[]>,
  mat: ReturnType<typeof armarMatriz>,
  code: string,
  t: number,
  T: number,
  ms: number,
): boolean | null {
  const desde = new Map([[code, t]]);
  const fijas = new Map(
    (inp.enCurso ?? [])
      .filter((c) => c !== code && inp.pending.has(c))
      .map((c) => [c, 0] as const),
  );
  // Descarte instantáneo: si ni la cota teórica entra, no hace falta buscar.
  if (cotaConDesde(inp, desde) > T) return false;
  const r = buscarPlan(
    inp, T, porMateria, mat, undefined, desde, ms, fijas.size ? fijas : undefined,
  );
  if (r.agotado) return null;
  return !!r.plan;
}

/** Solo para diagnóstico/bench: una consulta suelta con el presupuesto que le des. */
export function _probarDesde(
  inp: OptimalityInput,
  code: string,
  t: number,
  T: number,
  ms: number,
): boolean | null {
  if (!inp.offer) return null;
  const offMap = offeringMap(inp.offer);
  const disponibles = inp.settings.restrictAvailability
    ? new Set(inp.settings.availableSlots)
    : null;
  const { porMateria, mat } = preparar(inp, offMap, disponibles);
  return consultar(inp, porMateria, mat, code, t, T, ms);
}

export type Riesgo = {
  code: string;
  /** Cuatrimestres que se atrasa tu egreso si la desaprobás (0 = ninguno).
   * null si el análisis no llegó a determinarlo. */
  atraso: number | null;
  /** Último cuatrimestre (índice) en el que podés cursarla sin atrasarte. */
  limite: number | null;
  /** Cota superior siempre disponible: el simulador armó un plan de verdad que
   * se atrasa esto. Si `atraso` quedó en null, al menos podemos decir "a lo
   * sumo tanto" en vez de no decir nada. */
  alSumo?: number;
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

  /**
   * Cota superior CONSTRUCTIVA. La búsqueda exhaustiva es buenísima para
   * demostrar que algo es imposible y malísima para encontrar un plan cuando
   * sobra lugar (ataca primero las materias más atadas, así que pelea contra el
   * orden de las correlativas). Para eso ya tenemos el simulador de siempre, que
   * arma un plan REAL en milisegundos: si le sale uno de T cuatrimestres,
   * entonces existe, y no hay nada que buscar.
   */
  const enCurso = (inp.enCurso ?? []).filter((c) => inp.pending.has(c));
  const doneParaSim = new Set(
    [...inp.graph.byCode.keys()].filter((c) => !inp.pending.has(c)),
  );
  const memoArriba = new Map<string, number>();
  const arriba = (code: string, t: number): number => {
    const clave = `${code}@${t}`;
    const m = memoArriba.get(clave);
    if (m !== undefined) return m;
    const fijas = enCurso.filter((c) => c !== code);
    const r = schedule({
      graph: inp.graph,
      pending: new Set([...inp.pending].filter((c) => !fijas.includes(c))),
      done: doneParaSim,
      settings: inp.settings,
      offer: inp.offer,
      difficult: new Set(),
      electivePref: inp.electivePref,
      preScheduled: fijas.length ? new Map(fijas.map((c) => [c, 0])) : undefined,
      firstFreeTerm: fijas.length ? 1 : 0,
      noAntesDe: new Map([[code, t]]),
    });
    memoArriba.set(clave, r.makespan);
    return r.makespan;
  };

  const entra = (code: string, t: number, T: number): boolean | null => {
    // Primero lo barato: ¿el simulador arma uno que entre?
    if (arriba(code, t) <= T) return true;
    return consultar(inp, porMateria, mat, code, t, T, MS_POR_PREGUNTA);
  };

  const out: Riesgo[] = [];
  let hechas = 0;
  for (const code of delPrimerCuatri) {
    // 1) Si la desaprobás la recursás al cuatrimestre siguiente: ¿te atrasa?
    //    Arrancamos en la duración actual y subimos solo si hace falta.
    let atraso: number | null = null;
    for (let a = 0; a <= 3; a++) {
      const r = entra(code, 1, base + a);
      if (r === null) break; // sin tiempo: mejor decir que no sabemos
      if (r) { atraso = a; break; }
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
    // Aunque no hayamos podido demostrar el atraso exacto, el simulador armó un
    // plan de verdad: eso ya es un techo, y decir "a lo sumo tanto" es mucho más
    // útil que "demasiadas combinaciones".
    const techo = Math.max(0, arriba(code, 1) - base);
    const r: Riesgo = { code, atraso, limite, alSumo: techo };
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
  // A lo que ya estás cursando no le aplica tu disponibilidad: ya te inscribiste,
  // su horario real vale aunque no hayas marcado ese turno. Si se lo aplicáramos,
  // podríamos declarar imposible un cuatrimestre que estás haciendo de verdad
  // (p.ej. cinco materias de noche peleándose por cuatro días).
  const yaInscripto = new Set(inp.enCurso ?? []);
  const porMateria = new Map<string, Commission[]>();
  for (const c of inp.pending) {
    porMateria.set(
      c,
      comisionesDe(c, offMap, yaInscripto.has(c) ? null : disponibles, electivePref),
    );
  }
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
  const fijas = inp.enCurso?.length
    ? new Map(inp.enCurso.filter((c) => inp.pending.has(c)).map((c) => [c, 0]))
    : undefined;

  const lb = cotaInferior(inp, porMateria, mat);
  let minimo = inp.actual;
  let mejorPlan: PlanExacto | null = null;

  // Si ya está en la cota, es óptimo: no hay nada que buscar.
  if (inp.actual > lb) {
    for (let T = inp.actual - 1; T >= lb; T--) {
      const { plan } = buscarPlan(
        inp, T, porMateria, mat,
        (nodos) => onProgreso?.({ probando: T, nodos }),
        undefined, undefined, fijas,
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
        if (!buscarPlan(inp, T, libre.porMateria, libre.mat, undefined, undefined, undefined, fijas).plan) break;
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
        if (buscarPlan(inp, inp.actual - 1, prep.porMateria, prep.mat, undefined, undefined, undefined, fijas).plan) {
          franjas.push({ slot: extra, etiqueta: nombreDeFranja(extra) });
        }
      }
    }
  }

  return { minimo, plan: mejorPlan, motivo, franjas, sinFijarElectivas };
}
