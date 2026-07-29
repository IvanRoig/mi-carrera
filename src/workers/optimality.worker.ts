/**
 * optimality.worker.ts — Corre la búsqueda del plan mínimo en segundo plano.
 *
 * La búsqueda es exhaustiva y puede tardar: acá no molesta, porque el worker
 * vive en otro hilo y la página sigue respondiendo. Si el usuario cancela,
 * simplemente se termina el worker.
 */
import { graph } from '@/domain/planGraph';
import { buscarMinimo, type PlanExacto } from '@/domain/optimality';
import type { OfferData } from '@/domain/conflicts';
import type { UserSettings } from '@/domain/types';

export type WorkerReq = {
  pending: string[];
  settings: UserSettings;
  offer: OfferData;
  actual: number;
  /** Electivas elegidas a mano (cupo → día). */
  electivePref?: Record<string, number>;
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
    };

function serializar(plan: PlanExacto | null): [string, number, string | null][] | null {
  if (!plan) return null;
  return [...plan.entries()].map(([code, v]) => [code, v.t, v.slot]);
}

self.onmessage = (e: MessageEvent<WorkerReq>) => {
  const { pending, settings, offer, actual, electivePref } = e.data;
  let ultimoAviso = 0;
  const r = buscarMinimo(
    { graph, pending: new Set(pending), settings, offer, actual, electivePref },
    ({ probando, nodos }) => {
      // No inundamos el hilo principal: como mucho un aviso cada 200ms.
      const ahora = Date.now();
      if (ahora - ultimoAviso < 200) return;
      ultimoAviso = ahora;
      (self as unknown as Worker).postMessage({ tipo: 'progreso', probando, nodos } as WorkerMsg);
    },
  );
  (self as unknown as Worker).postMessage({
    tipo: 'listo',
    minimo: r.minimo,
    plan: serializar(r.plan),
    motivo: r.motivo,
    franjas: r.franjas,
    sinFijarElectivas: r.sinFijarElectivas,
  } as WorkerMsg);
};
