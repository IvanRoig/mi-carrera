/**
 * optimality.worker.ts — Los análisis pesados, en segundo plano.
 *
 * Dos trabajos:
 *  · 'optimo' — buscar el plan más corto posible (exhaustivo).
 *  · 'riesgo' — para cada materia del próximo cuatri, cuánto te atrasa
 *    desaprobarla y hasta cuándo podés dejarla.
 *
 * Los resultados se van mandando de a uno, así la pantalla se llena enseguida
 * aunque alguna materia tarde más.
 */
import { graph } from '@/domain/planGraph';
import { buscarMinimo, analizarRiesgo, type PlanExacto, type Riesgo } from '@/domain/optimality';
import type { OfferData } from '@/domain/conflicts';
import type { UserSettings } from '@/domain/types';

export type WorkerReq = {
  /** Qué análisis correr (por defecto, el de óptimo). */
  modo?: 'optimo' | 'riesgo';
  pending: string[];
  settings: UserSettings;
  offer: OfferData;
  actual: number;
  /** Electivas elegidas a mano (cupo → día). */
  electivePref?: Record<string, number>;
  /** Solo para 'riesgo': materias del próximo cuatrimestre. */
  materias?: string[];
  /** Materias que estás cursando (van fijas en el cuatrimestre actual). */
  enCurso?: string[];
};

export type WorkerMsg =
  | { tipo: 'progreso'; probando: number; nodos: number }
  | {
      tipo: 'listo';
      minimo: number;
      /** [código, cuatri, franja|null] — serializable. */
      plan: [string, number, string | null][] | null;
      motivo?: string;
      franjas: { slot: string; etiqueta: string }[];
      sinFijarElectivas?: number;
    }
  | { tipo: 'riesgo'; riesgo: Riesgo; hechas: number; total: number }
  | { tipo: 'riesgo-fin' };

function serializar(plan: PlanExacto | null): [string, number, string | null][] | null {
  if (!plan) return null;
  return [...plan.entries()].map(([code, v]) => [code, v.t, v.slot]);
}

const post = (m: WorkerMsg) => (self as unknown as Worker).postMessage(m);

self.onmessage = (e: MessageEvent<WorkerReq>) => {
  const { modo = 'optimo', pending, settings, offer, actual, electivePref, materias, enCurso } =
    e.data;
  const inp = { graph, pending: new Set(pending), settings, offer, actual, electivePref, enCurso };

  if (modo === 'riesgo') {
    analizarRiesgo(inp, materias ?? [], (riesgo, hechas, total) =>
      post({ tipo: 'riesgo', riesgo, hechas, total }),
    );
    post({ tipo: 'riesgo-fin' });
    return;
  }

  let ultimoAviso = 0;
  const r = buscarMinimo(inp, ({ probando, nodos }) => {
    // No inundamos el hilo principal: como mucho un aviso cada 200ms.
    const ahora = Date.now();
    if (ahora - ultimoAviso < 200) return;
    ultimoAviso = ahora;
    post({ tipo: 'progreso', probando, nodos });
  });
  post({
    tipo: 'listo',
    minimo: r.minimo,
    plan: serializar(r.plan),
    motivo: r.motivo,
    franjas: r.franjas,
    sinFijarElectivas: r.sinFijarElectivas,
  });
};
