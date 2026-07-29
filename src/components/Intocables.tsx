/**
 * Intocables.tsx — "¿Cuáles no puedo desaprobar?"
 *
 * Para cada materia del próximo cuatrimestre calcula, con búsqueda exhaustiva,
 * cuánto se atrasa tu egreso si la desaprobás. Corre en un worker y los
 * resultados van apareciendo de a uno: las fáciles salen al instante y las
 * difíciles llegan después, sin trabar la página.
 */
import { useEffect, useRef, useState } from 'react';
import { useDerived, useSchedule } from '@/lib/useDerived';
import { useStore } from '@/store/useStore';
import { useSubjectName } from '@/lib/subjectName';
import { calendarOf } from '@/domain/scheduler';
import { termLabel } from '@/lib/ui';
import type { Riesgo } from '@/domain/optimality';
import type { WorkerMsg, WorkerReq } from '@/workers/optimality.worker';

type Nivel = 'intocable' | 'cuidado' | 'tranqui' | 'desconocido';

function nivelDe(r: Riesgo): Nivel {
  if (r.atraso == null) return 'desconocido';
  if (r.atraso >= 2) return 'intocable'; // dos cuatrimestres o más ≈ un año
  if (r.atraso === 1) return 'cuidado';
  return 'tranqui';
}

const ESTILO: Record<Nivel, { punto: string; texto: string; chip: string; rotulo: string }> = {
  intocable: {
    punto: 'bg-rose-500',
    texto: 'text-rose-600 dark:text-rose-400',
    chip: 'bg-rose-500/10 text-rose-600 dark:text-rose-400',
    rotulo: 'intocable',
  },
  cuidado: {
    punto: 'bg-amber-500',
    texto: 'text-amber-600 dark:text-amber-400',
    chip: 'bg-amber-500/10 text-amber-600 dark:text-amber-400',
    rotulo: 'cuidado',
  },
  tranqui: {
    punto: 'bg-emerald-500',
    texto: 'text-emerald-600 dark:text-emerald-400',
    chip: 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400',
    rotulo: 'tranqui',
  },
  desconocido: {
    punto: 'bg-slate-400',
    texto: 'text-slate-500 dark:text-slate-400',
    chip: 'bg-slate-500/10 text-slate-500 dark:text-slate-400',
    rotulo: 'sin determinar',
  },
};

export function Intocables({ materias: forzadas }: { materias?: string[] } = {}) {
  const d = useDerived();
  const sched = useSchedule();
  const name = useSubjectName();
  const settings = useStore((s) => s.user.settings);
  const offer = useStore((s) => s.offer);
  const electivePref = useStore((s) => s.electivePref);

  const [estado, setEstado] = useState<'inicial' | 'corriendo' | 'listo'>('inicial');
  const [riesgos, setRiesgos] = useState<Riesgo[]>([]);
  const workerRef = useRef<Worker | null>(null);

  const materias = forzadas ?? sched.terms[0]?.subjects ?? [];
  // Clave estable: `forzadas` llega como array nuevo en cada render, y usarlo de
  // dependencia haría que el efecto se dispare para siempre.
  const claveMaterias = materias.join(',');

  // Si cambian los datos, lo calculado deja de valer.
  useEffect(() => {
    workerRef.current?.terminate();
    workerRef.current = null;
    setEstado('inicial');
    setRiesgos([]);
  }, [claveMaterias, settings, offer, electivePref]);

  useEffect(() => () => workerRef.current?.terminate(), []);

  if (!offer || materias.length === 0 || d.pending.size === 0) return null;

  function analizar() {
    setEstado('corriendo');
    setRiesgos([]);
    const w = new Worker(new URL('@/workers/optimality.worker.ts', import.meta.url), {
      type: 'module',
    });
    workerRef.current = w;
    w.onmessage = (e: MessageEvent<WorkerMsg>) => {
      const msg = e.data;
      if (msg.tipo === 'riesgo') {
        setRiesgos((prev) => [...prev, msg.riesgo]);
      } else if (msg.tipo === 'riesgo-fin') {
        setEstado('listo');
        w.terminate();
        workerRef.current = null;
      }
    };
    w.postMessage({
      modo: 'riesgo',
      pending: [...d.pending],
      settings,
      offer: offer!,
      actual: sched.makespan,
      electivePref,
      materias,
      enCurso: [...d.enCurso],
    } satisfies WorkerReq);
  }

  const porCodigo = new Map(riesgos.map((r) => [r.code, r]));
  const riesgosas = riesgos.filter((r) => {
    const n = nivelDe(r);
    return n === 'intocable' || n === 'cuidado';
  }).length;

  /** "1° cuatri 2027" a partir del índice de cuatrimestre. */
  const etiquetaCuatri = (i: number) => {
    const c = calendarOf(i, settings.startYear, settings.startTerm);
    return termLabel(c.term, c.year);
  };

  return (
    <div className="mt-4 border-t border-slate-200 pt-3 text-sm dark:border-slate-800">
      {estado === 'inicial' && (
        <button
          onClick={analizar}
          title={
            'Calcula, materia por materia, qué pasa si la desaprobás:\n\n' +
            '· cuánto se atrasa tu egreso\n' +
            '· hasta qué cuatrimestre podés dejarla sin perder tiempo\n\n' +
            'Corre en segundo plano y los resultados van apareciendo de a uno.'
          }
          className="text-slate-500 underline decoration-dotted underline-offset-4 hover:text-brand-600 dark:text-slate-400 dark:hover:text-brand-300"
        >
          🎯 ¿Cuáles no puedo desaprobar?
        </button>
      )}

      {estado !== 'inicial' && (
        <div className="space-y-2">
          <div className="flex flex-wrap items-center gap-2">
            <span className="font-medium">Si desaprobás…</span>
            {estado === 'corriendo' && (
              <span className="flex items-center gap-1.5 text-xs text-slate-500 dark:text-slate-400">
                <span className="inline-block h-3 w-3 animate-spin rounded-full border-2 border-brand-500 border-t-transparent" />
                {riesgos.length}/{materias.length}
              </span>
            )}
            {estado === 'listo' && riesgosas > 0 && (
              <span className="rounded bg-rose-500/10 px-2 py-0.5 text-xs font-medium text-rose-600 dark:text-rose-400">
                {riesgosas} sin margen
              </span>
            )}
          </div>

          <ul className="space-y-1">
            {materias.map((code) => {
              const r = porCodigo.get(code);
              if (!r) {
                return (
                  <li key={code} className="flex items-center gap-2 text-slate-400">
                    <span className="h-2 w-2 shrink-0 animate-pulse rounded-full bg-slate-300 dark:bg-slate-600" />
                    <span>{name(code)}</span>
                    <span className="text-xs">calculando…</span>
                  </li>
                );
              }
              const nivel = nivelDe(r);
              const e = ESTILO[nivel];
              return (
                <li key={code} className="flex flex-wrap items-center gap-2">
                  <span className={`h-2 w-2 shrink-0 rounded-full ${e.punto}`} />
                  <span className="font-medium">{name(code)}</span>
                  <span className={`rounded px-1.5 py-0.5 text-[11px] font-medium ${e.chip}`}>
                    {e.rotulo}
                  </span>
                  <span className={`text-xs ${e.texto}`}>
                    {(nivel === 'intocable' || nivel === 'cuidado') && r.atraso != null
                      ? r.atraso >= 2
                        ? `te atrasa ${r.atraso} cuatrimestres (casi un año)`
                        : 'te atrasa un cuatrimestre'
                      : nivel === 'tranqui'
                        ? r.limite != null && r.limite > 0
                          ? `podés dejarla hasta ${etiquetaCuatri(r.limite)}`
                          : 'no te mueve la fecha de egreso'
                        : r.alSumo != null
                          ? r.alSumo === 0
                            ? 'no te mueve la fecha de egreso'
                            : `te atrasa a lo sumo ${r.alSumo} ${
                                r.alSumo === 1 ? 'cuatrimestre' : 'cuatrimestres'
                              }`
                          : 'demasiadas combinaciones para saberlo'}
                  </span>
                </li>
              );
            })}
          </ul>

          {estado === 'listo' && (
            <p className="text-xs text-slate-500 dark:text-slate-400">
              {riesgosas > 0
                ? 'Las marcadas encabezan cadenas de correlativas sin margen: si se te caen, arrastran todo lo que viene atrás.'
                : 'Ninguna te cambia la fecha de egreso si la recursás al cuatrimestre siguiente.'}
            </p>
          )}
        </div>
      )}
    </div>
  );
}
