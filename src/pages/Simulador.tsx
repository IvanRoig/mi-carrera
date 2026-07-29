import { useEffect, useMemo, useRef, useState } from 'react';
import { useDerived, useSchedule, enCursoOptions, scarcityDe } from '@/lib/useDerived';
import { useStore } from '@/store/useStore';
import { graph } from '@/domain/planGraph';
import { ancestorsOf } from '@/domain/graph';
import { getSubject } from '@/data/plan';
import { useSubjectName } from '@/lib/subjectName';
import { SettingsBar } from '@/components/SettingsBar';
import { AvailabilityGrid } from '@/components/AvailabilityGrid';
import { Badge } from '@/components/Badge';
import { formatGraduation, termLabel, trackColor } from '@/lib/ui';
import { validateManualPlan, SUMMER_MAX, type SubjectDiag, type TermDiag } from '@/domain/manual';
import { schedule, calendarOf, type ScheduleResult } from '@/domain/scheduler';
import { termToClipboardText, copyToClipboard, type TermItem } from '@/lib/exportTerm';
import type { WorkerMsg, WorkerReq } from '@/workers/optimality.worker';
import type { PinnedTerm } from '@/store/useStore';
import {
  offeringMap,
  commissionFitsAvailability,
  commissionsOverlap,
  turnoOf,
  toMinutes,
  DAY_SHORT,
  type Commission,
} from '@/domain/conflicts';

const PFC = '03671';
const DAYS = [0, 1, 2, 3, 4, 5];
const TURNOS: { key: 'm' | 't' | 'n'; label: string }[] = [
  { key: 'm', label: 'mañana' },
  { key: 't', label: 'tarde' },
  { key: 'n', label: 'noche' },
];

function yearsLabel(years: number): string {
  if (years <= 0) return '—';
  const whole = Math.floor(years);
  const half = years - whole >= 0.5;
  if (whole === 0) return 'medio año';
  return half ? `${whole} años y medio` : `${whole} año${whole === 1 ? '' : 's'}`;
}

export function Simulador() {
  // El modo vive en el store (no en estado local) para que al cambiar de
  // pestaña y volver sigas donde estabas (auto la 1ra vez, manual si lo dejaste ahí).
  const mode = useStore((s) => s.simMode);
  const setMode = useStore((s) => s.setSimMode);
  const seedManual = useStore((s) => s.seedManual);

  // Pasa el plan automático a manual TAL CUAL (mismos días/turnos fijados).
  const editInManual = (sched: ScheduleResult) => {
    const { fd, ft } = forcedFromSchedule(sched);
    seedManual(
      sched.terms.map((t) => ({ id: crypto.randomUUID(), subjects: [...t.subjects] })),
      fd,
      ft,
    );
    setMode('manual');
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center gap-2">
        <ModeButton active={mode === 'auto'} onClick={() => setMode('auto')}>
          🤖 Automático
        </ModeButton>
        <ModeButton active={mode === 'sicario'} onClick={() => setMode('sicario')}>
          🔪 Sicario (lo antes posible)
        </ModeButton>
        <ModeButton active={mode === 'manual'} onClick={() => setMode('manual')}>
          ✋ Armado manual
        </ModeButton>
      </div>

      <SettingsBar hideCapacity={mode === 'sicario'} />
      <AvailabilityGrid />

      {mode === 'manual' ? (
        <ManualView />
      ) : (
        <AutoView sicario={mode === 'sicario'} onEditManual={editInManual} />
      )}
    </div>
  );
}

function ModeButton({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      onClick={onClick}
      className={`rounded-lg px-4 py-2 text-sm font-medium transition ${
        active
          ? 'bg-brand-600 text-white shadow-sm'
          : 'border border-slate-300 text-slate-600 hover:bg-slate-100 dark:border-slate-700 dark:text-slate-300 dark:hover:bg-slate-800'
      }`}
    >
      {children}
    </button>
  );
}

/** Primer horario (más temprano) de una comisión, como "HH:MM". */
function commTime(c?: Commission): string | undefined {
  if (!c || c.meetings.length === 0) return undefined;
  return [...c.meetings].sort((a, b) => a.start.localeCompare(b.start))[0].start;
}

/**
 * Fija el día/turno de cada materia según la comisión que le asignó el
 * scheduler, para que al pasar a manual queden EXACTAMENTE como en automático
 * (mismos días/turnos) y estables (no se reordenan solas).
 */
function forcedFromSchedule(sched: ScheduleResult) {
  const fd: Record<string, number> = {};
  const ft: Record<string, 'm' | 't' | 'n'> = {};
  for (const [code, comm] of sched.commissionByCode) {
    const m = [...comm.meetings].sort((a, b) => toMinutes(a.start) - toMinutes(b.start))[0];
    if (m) {
      fd[code] = m.day;
      ft[code] = turnoOf(toMinutes(m.start));
    }
  }
  return { fd, ft };
}

/* ---------------- Chip de materia ---------------- */

function MateriaChip({
  code,
  time,
  subtitle,
  chain,
  continuing,
  onPointerDown,
  dimmed,
  warn,
  note,
  hideSchedule,
}: {
  code: string;
  time?: string;
  /** Texto secundario (p.ej. la electiva real ofrecida ese día). */
  subtitle?: string;
  chain?: Set<string>;
  continuing?: boolean;
  onPointerDown?: (e: React.PointerEvent) => void;
  dimmed?: boolean;
  warn?: 'conflict' | 'no-oferta' | 'dispo' | 'correlativa' | null;
  note?: string;
  hideSchedule?: boolean;
}) {
  const name = useSubjectName();
  const s = getSubject(code)!;
  const isPFC = code === PFC;
  const border = isPFC ? '#fb923c' : chain?.has(code) ? '#3479f6' : trackColor(s.track);
  const warnRing =
    warn === 'conflict' || warn === 'correlativa'
      ? 'ring-1 ring-rose-400'
      : warn === 'no-oferta' || warn === 'dispo'
        ? 'ring-1 ring-amber-400'
        : '';
  return (
    <div
      onPointerDown={onPointerDown}
      title={name(code)}
      className={`rounded-md border-l-4 bg-slate-50 px-1.5 py-1 text-[11px] leading-tight dark:bg-slate-800/60 ${
        onPointerDown ? 'cursor-grab touch-none select-none active:cursor-grabbing' : ''
      } ${dimmed ? 'opacity-30' : ''} ${warnRing} ${s.isElective ? 'border border-dashed border-slate-300 dark:border-slate-600' : ''}`}
      style={{ borderLeftColor: border }}
    >
      <div className="font-medium">
        {s.isElective && '◌ '}
        {name(code)}
      </div>
      {subtitle && (
        <div className="mt-0.5 rounded bg-brand-500/10 px-1 py-0.5 text-[10px] font-semibold leading-tight text-brand-700 dark:text-brand-300">
          👉 {subtitle}
        </div>
      )}
      {!hideSchedule && (
        <div className="text-[9px] text-slate-500 dark:text-slate-400">
          {continuing ? 'continúa (anual)' : time ? `🕒 ${time}` : 'a distancia'}
          {chain?.has(code) && !continuing && ' · crítica'}
        </div>
      )}
      {note && <div className="text-[9px] text-amber-500">{note}</div>}
    </div>
  );
}

/* ---------------- Grilla de un cuatri por día (solo lectura, para AUTO) ---------------- */

function TermGrid({
  codes,
  continuing = [],
  assigned,
  chain,
}: {
  codes: string[];
  continuing?: string[];
  assigned: Map<string, Commission>;
  chain?: Set<string>;
}) {
  const contSet = new Set(continuing);
  const cols = new Map<number, string[]>();
  for (const d of DAYS) cols.set(d, []);
  const noDay: string[] = [];
  for (const code of [...codes, ...continuing]) {
    const day = assigned.get(code)?.meetings?.[0]?.day;
    if (day != null && day <= 5) cols.get(day)!.push(code);
    else noDay.push(code);
  }
  // Dentro de cada día: mañana arriba, noche abajo (por hora de inicio).
  const startMin = (code: string) => {
    const t = commTime(assigned.get(code));
    return t ? Number(t.slice(0, 2)) * 60 + Number(t.slice(3)) : 0;
  };
  for (const d of DAYS) cols.get(d)!.sort((a, b) => startMin(a) - startMin(b));

  const chip = (code: string) => (
    <MateriaChip
      key={code}
      code={code}
      time={commTime(assigned.get(code))}
      subtitle={assigned.get(code)?.label}
      chain={chain}
      continuing={contSet.has(code)}
    />
  );

  return (
    <div>
      <div className="grid grid-cols-[repeat(6,minmax(0,1fr))] gap-1.5">
        {DAYS.map((d) => (
          <div key={d} className="min-w-0">
            <div className="mb-1 text-center text-[10px] font-semibold text-slate-400">{DAY_SHORT[d]}</div>
            <div className="space-y-1">{cols.get(d)!.map(chip)}</div>
          </div>
        ))}
      </div>
      {noDay.length > 0 && (
        <div className="mt-2 flex flex-wrap items-center gap-1.5">
          <span className="text-[10px] font-semibold text-slate-400">💻 Sin día fijo:</span>
          {noDay.map(chip)}
        </div>
      )}
    </div>
  );
}

/* ---------------- Vista automática ---------------- */

function AutoView({
  sicario,
  onEditManual,
}: {
  sicario: boolean;
  onEditManual: (sched: ScheduleResult) => void;
}) {
  const d = useDerived();
  const autoSched = useSchedule();
  const settings = useStore((s) => s.user.settings);
  const offer = useStore((s) => s.offer);
  const difficultArr = useStore((s) => s.user.difficult);
  const electivePref = useStore((s) => s.electivePref);

  const s = useMemo(() => {
    if (!sicario) return autoSched;
    return schedule({
      graph,
      done: d.done,
      settings,
      offer,
      difficult: new Set(difficultArr),
      sicario: true,
      electivePref,
      scarcity: scarcityDe(offer),
      ...enCursoOptions(d),
    });
  }, [sicario, autoSched, d, settings, offer, difficultArr, electivePref]);

  const chain = new Set(s.criticalChain);

  if (s.terms.length === 0) {
    return (
      <div className="rounded-xl border border-emerald-500/30 bg-emerald-500/5 p-8 text-center">
        <p className="text-lg font-semibold">¡No te queda nada por planificar! 🎓</p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {sicario && (
        <p className="rounded-lg border border-rose-400/40 bg-rose-500/5 px-4 py-2 text-sm text-rose-700 dark:text-rose-300">
          🔪 <strong>Modo sicario:</strong> arma los cuatris para recibirte lo antes
          posible (todos los turnos), sin choques de horario.
        </p>
      )}
      <ResultBanner s={s} />

      <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-slate-200 bg-white px-4 py-3 dark:border-slate-800 dark:bg-slate-900">
        <p className="text-sm text-slate-600 dark:text-slate-400">
          ¿Querés cambiar algo? Pasá este plan al <strong>modo manual</strong> y
          movés las materias al día que quieras: te marca en verde/rojo dónde se
          puede y por qué.
        </p>
        <button
          onClick={() => onEditManual(s)}
          className="shrink-0 rounded-lg bg-brand-600 px-4 py-2 text-sm font-medium text-white hover:bg-brand-700"
        >
          ✏️ Editar en manual
        </button>
      </div>

      <div className="space-y-3">
        {s.terms.map((t) => {
          const continuing = [...s.startByCode.entries()]
            .filter(([c, st]) => st === t.index - 1 && getSubject(c)?.annual)
            .map(([c]) => c);
          return (
            <div
              key={t.index}
              className="rounded-xl border border-slate-200 bg-white p-3 shadow-sm dark:border-slate-800 dark:bg-slate-900"
            >
              <div className="mb-2 flex flex-wrap items-baseline justify-between gap-2">
                <h4 className="font-semibold">{termLabel(t.term, t.year)}</h4>
                <div className="flex items-center gap-2">
                  <span className="text-xs text-slate-500 dark:text-slate-400">
                    {t.subjects.length} materias · {t.totalHours} hs
                  </span>
                  <CopyTermButton
                    title={termLabel(t.term, t.year)}
                    codes={t.subjects}
                    assigned={s.commissionByCode}
                  />
                  <PinTermButton
                    title={termLabel(t.term, t.year)}
                    codes={t.subjects}
                    assigned={s.commissionByCode}
                  />
                </div>
              </div>
              <TermGrid
                codes={t.subjects}
                continuing={continuing}
                assigned={s.commissionByCode}
                chain={chain}
              />
            </div>
          );
        })}
      </div>
      <Legenda />
    </div>
  );
}

/** Copia las materias de un cuatri (con códigos) para la inscripción. */
function CopyTermButton({
  title,
  codes,
  assigned,
}: {
  title: string;
  codes: string[];
  assigned: Map<string, Commission>;
}) {
  const name = useSubjectName();
  const [state, setState] = useState<'ok' | 'err' | null>(null);
  async function copy() {
    const items: TermItem[] = codes.map((code) => {
      const commission = assigned.get(code);
      return { code, name: commission?.label ?? name(code), commission };
    });
    const done = await copyToClipboard(termToClipboardText(items, title));
    setState(done ? 'ok' : 'err');
    setTimeout(() => setState(null), 1800);
  }
  return (
    <button
      onClick={copy}
      disabled={codes.length === 0}
      className="rounded bg-slate-500/10 px-1.5 py-0.5 text-[10px] text-slate-600 hover:bg-slate-500/20 disabled:opacity-40 dark:text-slate-300"
      title="Copiar las materias con código de materia y comisión (para la inscripción)"
    >
      {state === 'ok' ? '✅ copiado' : state === 'err' ? '⚠️ no se pudo' : '📋 copiar'}
    </button>
  );
}

/**
 * Fija un cuatri del plan automático como "mi próximo cuatrimestre".
 * Si el plan te vino bien tal cual, no hace falta pasar por el armado manual
 * solo para poder fijarlo.
 */
function PinTermButton({
  title,
  codes,
  assigned,
}: {
  title: string;
  codes: string[];
  assigned: Map<string, Commission>;
}) {
  const setPinnedTerm = useStore((st) => st.setPinnedTerm);
  const name = useSubjectName();
  const [hecho, setHecho] = useState(false);
  function fijar() {
    const pin: PinnedTerm = {
      label: title,
      items: codes.map((code) => {
        const comm = assigned.get(code);
        const m = comm?.meetings.length
          ? [...comm.meetings].sort((a, b) => toMinutes(a.start) - toMinutes(b.start))[0]
          : undefined;
        return {
          code,
          commId: comm?.id,
          day: m?.day,
          start: m?.start,
          end: m?.end,
          label: comm?.label ?? name(code),
          subjectCode: comm?.subjectCode,
        };
      }),
    };
    setPinnedTerm(pin);
    setHecho(true);
    setTimeout(() => setHecho(false), 1800);
  }
  return (
    <button
      onClick={fijar}
      disabled={codes.length === 0}
      className="rounded bg-brand-500/10 px-1.5 py-0.5 text-[10px] text-brand-700 hover:bg-brand-500/20 disabled:opacity-40 dark:text-brand-300"
      title="Fijarlo como tu próximo cuatrimestre: queda arriba en el Tablero, con horarios y códigos a mano"
    >
      {hecho ? '✅ fijado' : '📌 es mi próximo'}
    </button>
  );
}

function Legenda() {
  return (
    <p className="text-xs text-slate-500 dark:text-slate-400">
      <span className="mr-3">
        <span className="inline-block h-2 w-3 rounded-sm bg-brand-500 align-middle" /> ruta crítica
      </span>
      <span className="mr-3">
        <span className="inline-block h-2 w-3 rounded-sm bg-orange-400 align-middle" /> Proyecto Final
      </span>
      <span className="mr-3">◌ electiva</span>
      <span>Día/horario según la oferta cargada (referencia para cuatris futuros).</span>
    </p>
  );
}

function ResultBanner({ s }: { s: ScheduleResult }) {
  return (
    <div className="rounded-xl border border-brand-500/40 bg-brand-500/5 p-5">
      <div className="flex flex-wrap items-center gap-6">
        <div>
          <div className="text-4xl font-bold tracking-tight">{s.makespan}</div>
          <div className="text-sm text-slate-500 dark:text-slate-400">
            cuatrimestres · {yearsLabel(s.years)}
          </div>
        </div>
        <div className="h-10 w-px bg-slate-300 dark:bg-slate-700" />
        <div>
          <div className="text-2xl font-semibold">{formatGraduation(s.graduation)}</div>
          <div className="text-sm text-slate-500 dark:text-slate-400">
            fin de la cursada (aprobando todo)
          </div>
        </div>
        <div className="h-10 w-px bg-slate-300 dark:bg-slate-700" />
        <div>
          <div className="text-2xl font-semibold">{s.criticalChain.length}</div>
          <div className="text-sm text-slate-500 dark:text-slate-400">
            materias en la cadena crítica
          </div>
        </div>
      </div>
      <AnalisisOptimo makespan={s.makespan} />
    </div>
  );
}

/**
 * "¿Se puede terminar antes?" — verificación exhaustiva a pedido.
 *
 * Por defecto es solo un enlace discreto. Al tocarlo, la búsqueda corre en un
 * WORKER (segundo plano): puede tardar lo que haga falta sin trabar la página,
 * mostrando el tiempo y con opción de cancelar. Si encuentra un plan más corto,
 * te deja aplicarlo directamente en el armado manual.
 */
function AnalisisOptimo({ makespan }: { makespan: number }) {
  const d = useDerived();
  const settings = useStore((st) => st.user.settings);
  const offer = useStore((st) => st.offer);
  const electivePref = useStore((st) => st.electivePref);
  const seedManual = useStore((st) => st.seedManual);
  const setSimMode = useStore((st) => st.setSimMode);

  const [estado, setEstado] = useState<'inicial' | 'corriendo' | 'listo'>('inicial');
  const [progreso, setProgreso] = useState<{ probando: number; nodos: number } | null>(null);
  const [segundos, setSegundos] = useState(0);
  const [res, setRes] = useState<WorkerMsg & { tipo: 'listo' } | null>(null);
  const [aplicado, setAplicado] = useState(false);
  const workerRef = useRef<Worker | null>(null);

  const cancelar = () => {
    workerRef.current?.terminate();
    workerRef.current = null;
    setEstado('inicial');
    setProgreso(null);
  };

  // Si cambian los datos, el análisis anterior deja de valer.
  useEffect(() => {
    workerRef.current?.terminate();
    workerRef.current = null;
    setEstado('inicial');
    setRes(null);
    setProgreso(null);
    setAplicado(false);
  }, [makespan, d.pending, settings, offer]);

  // Cronómetro mientras corre.
  useEffect(() => {
    if (estado !== 'corriendo') return;
    setSegundos(0);
    const id = setInterval(() => setSegundos((s) => s + 1), 1000);
    return () => clearInterval(id);
  }, [estado]);

  // Al desmontar, cortamos el worker.
  useEffect(() => () => workerRef.current?.terminate(), []);

  if (!offer || d.pending.size === 0 || makespan <= 1) return null;

  function analizar() {
    setEstado('corriendo');
    setProgreso(null);
    const w = new Worker(new URL('@/workers/optimality.worker.ts', import.meta.url), {
      type: 'module',
    });
    workerRef.current = w;
    w.onmessage = (e: MessageEvent<WorkerMsg>) => {
      const msg = e.data;
      if (msg.tipo === 'progreso') {
        setProgreso({ probando: msg.probando, nodos: msg.nodos });
      } else if (msg.tipo === 'listo') {
        setRes(msg);
        setEstado('listo');
        w.terminate();
        workerRef.current = null;
      }
    };
    w.postMessage({
      pending: [...d.pending],
      settings,
      offer: offer!,
      actual: makespan,
      electivePref,
      enCurso: [...d.enCurso],
    } satisfies WorkerReq);
  }

  /** Pasa el plan encontrado al armado manual, con día y turno de cada materia. */
  function aplicarPlan() {
    if (!res?.plan) return;
    const terms: { id: string; subjects: string[] }[] = Array.from(
      { length: res.minimo },
      () => ({ id: crypto.randomUUID(), subjects: [] }),
    );
    const fd: Record<string, number> = {};
    const ft: Record<string, 'm' | 't' | 'n'> = {};
    for (const [code, t, slot] of res.plan) {
      terms[t]?.subjects.push(code);
      if (slot) {
        const [dia, turno] = slot.split('-');
        fd[code] = Number(dia);
        ft[code] = turno as 'm' | 't' | 'n';
      }
    }
    seedManual(terms, fd, ft);
    setSimMode('manual');
    setAplicado(true);
  }

  const mejor = res && res.minimo < makespan;

  return (
    <div className="mt-4 border-t border-brand-500/20 pt-3 text-sm">
      {estado === 'inicial' && (
        <button
          onClick={analizar}
          title={
            'Prueba TODAS las combinaciones posibles para ver si existe un plan más corto que este.\n\n' +
            '· Si no existe, te lo confirma y te explica qué te está frenando.\n' +
            '· Si existe, te lo muestra y podés aplicarlo con un clic.\n' +
            '· Si filtrás por disponibilidad, te dice qué día/turno tendrías que liberar para ahorrar un cuatrimestre.\n\n' +
            'Corre en segundo plano: podés seguir usando la página y cancelarlo cuando quieras.'
          }
          className="text-slate-500 underline decoration-dotted underline-offset-4 hover:text-brand-600 dark:text-slate-400 dark:hover:text-brand-300"
        >
          🔎 ¿Se puede terminar antes?
        </button>
      )}

      {estado === 'corriendo' && (
        <div className="space-y-1">
          <div className="flex flex-wrap items-center gap-3 text-slate-500 dark:text-slate-400">
            <span className="inline-block h-3 w-3 animate-spin rounded-full border-2 border-brand-500 border-t-transparent" />
            <span>
              Probando todas las combinaciones
              {progreso ? ` (buscando un plan de ${progreso.probando} cuatris…)` : '…'}{' '}
              <span className="tabular-nums">{segundos}s</span>
            </span>
            <button onClick={cancelar} className="underline hover:text-rose-500">
              cancelar
            </button>
          </div>
          {segundos >= 20 && (
            <div className="text-xs text-slate-400">
              Está tardando: hay muchísimas combinaciones para descartar. Podés dejarlo corriendo
              (la página sigue andando) o cancelar y quedarte con el plan actual, que ya es muy bueno.
            </div>
          )}
        </div>
      )}

      {estado === 'listo' && res && !mejor && (
        <div className="space-y-1">
          <div className="font-medium text-emerald-600 dark:text-emerald-400">
            🏆 Ya está: {makespan} cuatrimestres es lo mejor de lo mejor. No existe ninguna
            combinación más corta.
          </div>
          {res.motivo && <div className="text-slate-600 dark:text-slate-400">{res.motivo}</div>}
          {res.sinFijarElectivas != null && res.sinFijarElectivas < makespan && (
            <div className="text-amber-600 dark:text-amber-400">
              🎯 Ojo: la electiva que elegiste a mano te cuesta{' '}
              {makespan - res.sinFijarElectivas} cuatrimestre
              {makespan - res.sinFijarElectivas > 1 ? 's' : ''}. Si la dejás en{' '}
              <strong>“sin preferencia”</strong> (en Materias), terminarías en{' '}
              <strong>{res.sinFijarElectivas}</strong>.
            </div>
          )}
          {res.franjas.length > 0 && (
            <div className="text-amber-600 dark:text-amber-400">
              💡 Ahora bien: si pudieras cursar{' '}
              <strong>{res.franjas.map((f) => f.etiqueta).join(' o ')}</strong>, ahí sí
              terminarías un cuatrimestre antes.
            </div>
          )}
        </div>
      )}

      {estado === 'listo' && res && mejor && (
        <div className="flex flex-wrap items-center gap-3">
          <span className="font-medium text-amber-600 dark:text-amber-400">
            🎉 ¡Sí! Encontré un plan de <strong>{res.minimo}</strong> cuatrimestres (
            {makespan - res.minimo} menos).
          </span>
          {aplicado ? (
            <span className="text-emerald-600 dark:text-emerald-400">
              ✓ Aplicado en el armado manual
            </span>
          ) : (
            <button
              onClick={aplicarPlan}
              className="rounded-lg bg-brand-600 px-3 py-1 text-sm font-medium text-white hover:bg-brand-700"
            >
              Usar ese plan
            </button>
          )}
        </div>
      )}
    </div>
  );
}

/* ---------------- Vista manual (drag & drop por día) ---------------- */

type DayStatus = { kind: 'ok' | 'no-oferta' | 'conflict' | 'block'; reason: string };

function ManualView() {
  const d = useDerived();
  const autoSched = useSchedule();
  const name = useSubjectName();
  const manualTerms = useStore((s) => s.manualTerms);
  const manualForcedDay = useStore((s) => s.manualForcedDay);
  const manualForcedTurno = useStore((s) => s.manualForcedTurno);
  const seedManual = useStore((s) => s.seedManual);
  const moveToManualTerm = useStore((s) => s.moveToManualTerm);
  const placeOnSlot = useStore((s) => s.placeOnSlot);
  const addManualTerm = useStore((s) => s.addManualTerm);
  const addSummerTerm = useStore((s) => s.addSummerTerm);
  const removeManualTerm = useStore((s) => s.removeManualTerm);
  const setPinnedTerm = useStore((s) => s.setPinnedTerm);
  const pinnedTerm = useStore((s) => s.pinnedTerm);
  const offer = useStore((s) => s.offer);
  const settings = useStore((s) => s.user.settings);
  const difficultArr = useStore((s) => s.user.difficult);
  const electivePref = useStore((s) => s.electivePref);
  /** Feedback efímero de los botones (copiado / fijado). */
  const [flash, setFlash] = useState<string | null>(null);

  // Drag propio con pointer events (robusto, funciona en celu y no se cancela).
  const [drag, setDrag] = useState<{ code: string; x: number; y: number } | null>(null);
  const [hover, setHover] = useState<{ term: number; day: number; turno: 'm' | 't' | 'n' } | null>(null);
  const dragging = drag?.code ?? null;
  type HoverTarget =
    | { kind: 'pool' }
    | { kind: 'slot'; termId: string; termIdx: number; day: number; turno: 'm' | 't' | 'n' };
  const hoverRef = useRef<HoverTarget | null>(null);

  const offMap = useMemo(() => (offer ? offeringMap(offer) : null), [offer]);
  const availSet = settings.restrictAvailability ? new Set(settings.availableSlots) : null;
  const placed = new Set(manualTerms.flatMap((t) => t.subjects));
  const pool = [...d.pending].filter((c) => !placed.has(c));

  const diag = useMemo(
    () =>
      validateManualPlan(
        graph,
        d.done,
        manualTerms,
        settings,
        offer,
        new Set(difficultArr),
        manualForcedDay,
        manualForcedTurno,
      ),
    [d.done, manualTerms, settings, offer, difficultArr, manualForcedDay, manualForcedTurno],
  );

  function seedFromAuto() {
    const { fd, ft } = forcedFromSchedule(autoSched);
    seedManual(
      autoSched.terms.map((t) => ({ id: crypto.randomUUID(), subjects: [...t.subjects] })),
      fd,
      ft,
    );
  }

  /**
   * Deja fijos los cuatris 0..keepUpTo (incluido) TAL CUAL están (materias y
   * días) y autocompleta SOLO los siguientes.
   *
   * Regla importante: si lo que ya tenés está completo, es válido y NO se puede
   * terminar antes, no se toca nada. Reordenar materias entre cuatrimestres sin
   * ganar ni un cuatri no te sirve de nada y da la sensación de que la app
   * "cambia sola" cada vez que apretás el botón.
   */
  function autocompleteFrom(keepUpTo: number) {
    const keep = manualTerms.slice(0, keepUpTo + 1);
    const preScheduled = new Map<string, number>();
    keep.forEach((t, i) => t.subjects.forEach((c) => preScheduled.set(c, i)));
    const prefixCodes = new Set([...preScheduled.keys()]);
    const remaining = new Set([...d.pending].filter((c) => !prefixCodes.has(c)));
    const res = schedule({
      graph,
      pending: remaining,
      done: d.done,
      settings,
      offer,
      difficult: new Set(difficultArr),
      preScheduled,
      firstFreeTerm: keep.length,
      electivePref,
      // Misma escasez que usa el plan automático. Sin esto, "completar desde el
      // primer cuatri" resolvía con prioridades distintas y te devolvía un plan
      // distinto al que estabas viendo, sin haber cambiado nada.
      scarcity: scarcityDe(offer),
    });
    // Prefijo EXACTO del usuario + solo los cuatris nuevos del resultado.
    const newTerms = [
      ...keep.map((t) => ({ id: crypto.randomUUID(), subjects: [...t.subjects] })),
      ...res.terms
        .slice(keep.length)
        .map((t) => ({ id: crypto.randomUUID(), subjects: [...t.subjects] })),
    ];
    // Días fijados: conservar los del prefijo, agregar los de la parte nueva.
    const fd: Record<string, number> = {};
    const ft: Record<string, 'm' | 't' | 'n'> = {};
    for (const c of prefixCodes) {
      if (manualForcedDay[c] !== undefined) fd[c] = manualForcedDay[c];
      if (manualForcedTurno[c] !== undefined) ft[c] = manualForcedTurno[c];
    }
    const compl = forcedFromSchedule(res);
    for (const [c, day] of Object.entries(compl.fd)) if (!prefixCodes.has(c)) fd[c] = day;
    for (const [c, tt] of Object.entries(compl.ft)) if (!prefixCodes.has(c)) ft[c] = tt;

    // ¿Vale la pena tocarlo? Solo si el plan que tenés está incompleto, tiene
    // errores, o el nuevo termina antes. Si no, lo dejamos como está.
    const yaEstaBien = pool.length === 0 && diag.valid;
    if (yaEstaBien && res.makespan >= diag.makespan) {
      setFlash(`optimo:${manualTerms[keepUpTo]?.id ?? ''}`);
      setTimeout(() => setFlash(null), 2200);
      return;
    }
    seedManual(newTerms, fd, ft);
  }

  function autocompleteRest() {
    autocompleteFrom(manualTerms.length - 1);
  }

  // finish de cada materia (para correlativas de la que arrastrás).
  const finishMap = useMemo(() => {
    const f = new Map<string, number>();
    for (const c of d.done) f.set(c, -1);
    manualTerms.forEach((t, i) =>
      t.subjects.forEach((c) => f.set(c, i + (graph.byCode.get(c)?.annual ? 1 : 0))),
    );
    return f;
  }, [d.done, manualTerms]);

  // Estado de una celda (cuatri, día, turno) para la materia que se arrastra.
  function slotStatus(termIdx: number, day: number, turno: 'm' | 't' | 'n'): DayStatus {
    if (!dragging) return { kind: 'ok', reason: '' };
    const s = graph.byCode.get(dragging)!;
    const turnoTxt = turno === 'm' ? 'mañana' : turno === 't' ? 'tarde' : 'noche';
    const term = diag.terms[termIdx];
    const isSummer = !!term?.summer;
    // El calendario sale del diagnóstico (tiene en cuenta los veranos).
    const cal = term ?? calendarOf(termIdx, settings.startYear, settings.startTerm);
    if (s.annual || s.startsOnlyFirstSemester) {
      if (isSummer)
        return { kind: 'block', reason: `${name(dragging)} es anual: no se puede hacer en el verano intensivo.` };
      if (!cal.isFirstSemester)
        return { kind: 'block', reason: 'Solo puede arrancar en un 1er cuatrimestre (anual / Proyecto Final).' };
    }
    const reqs = graph.prereqs.get(dragging) ?? [];
    const missing = reqs.filter((p) => (finishMap.get(p) ?? Infinity) >= termIdx);
    if (missing.length)
      return { kind: 'block', reason: `Te faltan correlativas antes: ${missing.map(name).join(', ')}.` };

    // --- Verano: no hay oferta conocida, solo valen las reglas del intensivo ---
    if (isSummer) {
      const otros = term.subjects.filter((sd) => sd.code !== dragging);
      if (otros.length >= SUMMER_MAX)
        return { kind: 'block', reason: `En el verano podés cursar hasta ${SUMMER_MAX} materias.` };
      const corr = otros.find(
        (sd) => ancestorsOf(graph, sd.code).has(dragging) || ancestorsOf(graph, dragging).has(sd.code),
      );
      if (corr)
        return { kind: 'block', reason: `${name(dragging)} y ${name(corr.code)} son correlativas: no podés hacerlas juntas en el verano.` };
      if (s.track === 'Transversal' && otros.some((sd) => graph.byCode.get(sd.code)?.track === 'Transversal'))
        return { kind: 'block', reason: 'Solo una transversal (Inglés/Computación) por verano.' };
      if (otros.some((sd) => sd.day === day && sd.turno === turno))
        return { kind: 'conflict', reason: `Ya tenés otra materia ese día y turno.` };
      return { kind: 'ok', reason: `Verano: elegís vos el día y horario 👍` };
    }

    const o = offMap?.get(dragging);
    if (!o || o.commissions.length === 0)
      return { kind: 'ok', reason: 'No tiene horario fijo en la oferta. Podés ubicarla igual.' };
    const onSlot = o.commissions.filter((c) =>
      c.meetings.some((m) => m.day === day && turnoOf(toMinutes(m.start)) === turno),
    );
    if (onSlot.length === 0)
      return {
        kind: 'no-oferta',
        reason: `Con la oferta actual esta materia no se da el ${DAY_SHORT[day]} a la ${turnoTxt}. Podés soltarla igual (queda marcada) o cargá una oferta más nueva desde la solapa Oferta.`,
      };
    if (availSet && !onSlot.some((c) => commissionFitsAvailability(c, availSet)))
      return { kind: 'no-oferta', reason: `El ${DAY_SHORT[day]} a la ${turnoTxt} no está en tu disponibilidad.` };

    const others = diag.terms[termIdx]?.subjects.filter((sd) => sd.code !== dragging && sd.commission) ?? [];
    const allClash = onSlot.every((c) => others.some((sd) => commissionsOverlap(sd.commission!, c)));
    if (others.length > 0 && allClash)
      return { kind: 'conflict', reason: `Se solapa con otra materia ese día/horario.` };

    return { kind: 'ok', reason: `Podés cursarla el ${DAY_SHORT[day]} a la ${turnoTxt} 👍` };
  }

  const startPointerDrag = (code: string) => (e: React.PointerEvent) => {
    e.preventDefault();
    setDrag({ code, x: e.clientX, y: e.clientY });
    setHover(null);
    hoverRef.current = null;
  };

  useEffect(() => {
    if (!drag) return;
    const code = drag.code;
    const locate = (x: number, y: number): HoverTarget | null => {
      const el = document.elementFromPoint(x, y)?.closest('[data-slot]') as HTMLElement | null;
      if (!el) return null;
      if (el.dataset.pool) return { kind: 'pool' };
      // Es una columna de día: el turno se calcula por la Y del cursor.
      const rect = el.getBoundingClientRect();
      const headerH = 18;
      const bandH = Math.max(1, (rect.height - headerH) / 3);
      const ti = Math.max(0, Math.min(2, Math.floor((y - rect.top - headerH) / bandH)));
      const turno = (['m', 't', 'n'] as const)[ti];
      return {
        kind: 'slot',
        termId: el.dataset.term!,
        termIdx: Number(el.dataset.idx),
        day: Number(el.dataset.day),
        turno,
      };
    };
    const onMove = (e: PointerEvent) => {
      setDrag((dd) => (dd ? { ...dd, x: e.clientX, y: e.clientY } : dd));
      const t = locate(e.clientX, e.clientY);
      hoverRef.current = t;
      setHover(t?.kind === 'slot' ? { term: t.termIdx, day: t.day, turno: t.turno } : null);
    };
    const onUp = () => {
      const t = hoverRef.current;
      if (t?.kind === 'pool') moveToManualTerm(code, null);
      else if (t?.kind === 'slot') placeOnSlot(code, t.termId, t.day, t.turno);
      setDrag(null);
      setHover(null);
      hoverRef.current = null;
    };
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
    window.addEventListener('pointercancel', onUp);
    return () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      window.removeEventListener('pointercancel', onUp);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [drag?.code, placeOnSlot, moveToManualTerm]);

  const hoverStatus = drag && hover ? slotStatus(hover.term, hover.day, hover.turno) : null;
  // Bandas bien sólidas: con las materias desvanecidas detrás, el color se lee
  // limpio (antes eran translúcidas y se mezclaban con la materia de fondo).
  const cellColor = (st: DayStatus) =>
    st.kind === 'ok'
      ? 'bg-emerald-500/80 ring-1 ring-emerald-300'
      : st.kind === 'no-oferta'
        ? 'bg-amber-500/80 ring-1 ring-amber-300'
        : 'bg-rose-500/80 ring-1 ring-rose-300';

  // Agrupa las materias de un cuatri (con su diagnóstico) por día y turno.
  type Item = { sd: SubjectDiag; cont: boolean };
  type DayCol = Record<'m' | 't' | 'n', Item[]>;
  function groupTerm(subs: SubjectDiag[], continuing: SubjectDiag[]) {
    const cols = new Map<number, DayCol>();
    for (const dd of DAYS) cols.set(dd, { m: [], t: [], n: [] });
    const noDay: Item[] = [];
    const add = (sd: SubjectDiag, cont: boolean) => {
      const c = sd.commission;
      if (sd.day != null && sd.day >= 0 && sd.day <= 5 && c && c.meetings.length) {
        const m = c.meetings.find((mm) => mm.day === sd.day) ?? c.meetings[0];
        cols.get(sd.day)![sd.turno ?? turnoOf(toMinutes(m.start))].push({ sd, cont });
      } else if (sd.day != null && sd.day >= 0 && sd.day <= 5) {
        // forzada a un día sin comisión: la dejamos en el turno donde la soltaste.
        cols.get(sd.day)![sd.turno ?? 'n'].push({ sd, cont });
      } else noDay.push({ sd, cont });
    };
    for (const sd of subs) add(sd, false);
    for (const sd of continuing) add(sd, true);
    return { cols, noDay };
  }

  /** Título de un cuatri ("1° cuatri 2027" o "Verano 2027"). */
  const titleOf = (t: TermDiag) => (t.summer ? `Verano ${t.year}` : termLabel(t.term, t.year));

  /** Materias de un cuatri en el formato que se copia / se fija. */
  const itemsOf = (t: TermDiag): TermItem[] =>
    t.subjects.map((sd) => ({
      code: sd.code,
      name: sd.commission?.label ?? name(sd.code),
      commission: sd.commission,
      day: sd.day,
      turno: sd.turno,
    }));

  async function copyTerm(t: TermDiag) {
    const items = itemsOf(t);
    if (items.length === 0) return;
    const ok = await copyToClipboard(termToClipboardText(items, titleOf(t)));
    setFlash(ok ? `copiado:${t.id}` : `error:${t.id}`);
    setTimeout(() => setFlash(null), 1800);
  }

  function pinTerm(t: TermDiag) {
    const pin: PinnedTerm = {
      label: titleOf(t),
      items: t.subjects.map((sd) => {
        const m = sd.commission?.meetings.length
          ? [...sd.commission.meetings].sort((a, b) => toMinutes(a.start) - toMinutes(b.start))[0]
          : undefined;
        return {
          code: sd.code,
          commId: sd.commission?.id,
          day: sd.day ?? m?.day,
          start: m?.start,
          end: m?.end,
          label: sd.commission?.label,
          subjectCode: sd.commission?.subjectCode,
        };
      }),
    };
    setPinnedTerm(pin);
    setFlash(`fijado:${t.id}`);
    setTimeout(() => setFlash(null), 1800);
  }

  const warnOf = (sd: SubjectDiag): 'conflict' | 'no-oferta' | 'correlativa' | null =>
    sd.hasConflict ? 'conflict' : sd.missingPrereqs.length || sd.calendarError ? 'correlativa' : sd.forcedNoDay || sd.notAvailable ? 'no-oferta' : null;
  const noteOf = (sd: SubjectDiag): string | undefined =>
    sd.forcedNoDay ? 'sin oferta ese día' : sd.notAvailable ? 'fuera de tu disponibilidad' : undefined;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-3">
          <Badge className="bg-brand-500/15 text-brand-600 ring-brand-500/30 dark:text-brand-300">
            Manual: {diag.makespan} cuatris · {formatGraduation(diag.graduation)}
          </Badge>
          <Badge className="bg-slate-500/15 text-slate-600 ring-slate-500/30 dark:text-slate-300">
            Automático: {autoSched.makespan} cuatris
          </Badge>
          {diag.placedCount < d.pending.size && (
            <span className="text-xs text-amber-600 dark:text-amber-400">
              faltan ubicar {d.pending.size - diag.placedCount} materias
            </span>
          )}
          {!diag.valid && diag.placedCount > 0 && (
            <span className="text-xs text-rose-600 dark:text-rose-400">⚠ hay conflictos</span>
          )}
        </div>
        <div className="flex flex-wrap gap-2">
          <button onClick={seedFromAuto} className="rounded-lg bg-brand-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-brand-700">
            Sembrar desde automático
          </button>
          <button
            onClick={autocompleteRest}
            disabled={manualTerms.length === 0}
            className="rounded-lg border border-brand-500 px-3 py-1.5 text-sm font-medium text-brand-600 hover:bg-brand-500/10 disabled:opacity-40 dark:text-brand-300"
            title="Deja fijos TODOS los cuatris que ya armaste y completa solo las materias que faltan ubicar en cuatris nuevos. Para fijar solo hasta un cuatri, usá el botón '🪄 completar desde acá' de ese cuatri."
          >
            Autocompletar lo que falta
          </button>
          <button onClick={addManualTerm} className="rounded-lg border border-slate-300 px-3 py-1.5 text-sm font-medium dark:border-slate-700">
            + Agregar cuatri
          </button>
        </div>
      </div>

      <p className="text-xs text-slate-500 dark:text-slate-400">
        💡 Arrastrá una materia a un <strong>día y turno</strong> de un cuatri. Se
        pinta <span className="text-emerald-500">verde</span> (se puede),{' '}
        <span className="text-amber-500">ámbar</span> (se puede pero no hay oferta
        ese día/turno o no entra en tu disponibilidad) o{' '}
        <span className="text-rose-500">rojo</span> (rompe correlativas o calendario).
        Igual te deja soltarla; queda señalada. Arrastrala a “Sin ubicar” para sacarla.
      </p>

      {/* Fantasma que sigue al cursor mientras arrastrás */}
      {drag && (
        <div
          className="pointer-events-none fixed z-[60] rounded-md border-l-4 border-brand-500 bg-white px-2 py-1 text-[11px] font-medium shadow-xl dark:bg-slate-800"
          style={{ left: drag.x + 12, top: drag.y + 12 }}
        >
          {name(drag.code)}
        </div>
      )}

      {hoverStatus && (
        <div
          className={`pointer-events-none fixed inset-x-0 bottom-5 z-50 mx-auto w-fit max-w-[92vw] rounded-xl border px-4 py-2.5 text-sm font-medium shadow-2xl backdrop-blur ${
            hoverStatus.kind === 'ok'
              ? 'border-emerald-500/50 bg-emerald-500/95 text-white'
              : hoverStatus.kind === 'no-oferta'
                ? 'border-amber-500/50 bg-amber-500/95 text-white'
                : 'border-rose-500/50 bg-rose-500/95 text-white'
          }`}
        >
          {hoverStatus.kind === 'ok' ? '✅' : hoverStatus.kind === 'no-oferta' ? '⚠️' : '⛔'}{' '}
          <strong>{name(dragging!)}</strong> → {hoverStatus.reason}
        </div>
      )}

      <div className="grid gap-4 lg:grid-cols-[220px_1fr]">
        <div
          data-slot
          data-pool="1"
          className={`rounded-xl border border-dashed p-3 dark:bg-slate-900/50 ${
            drag ? 'border-brand-400 bg-brand-500/5' : 'border-slate-300 bg-slate-50 dark:border-slate-700'
          }`}
        >
          <h4 className="mb-2 text-sm font-semibold">
            Sin ubicar ({pool.length})
            {drag && <span className="ml-1 text-[10px] font-normal text-brand-500">soltá acá para sacar</span>}
          </h4>
          <div className="space-y-1.5">
            {pool.map((code) => (
              <MateriaChip
                key={code}
                code={code}
                chain={new Set(autoSched.criticalChain)}
                onPointerDown={startPointerDrag(code)}
                dimmed={dragging === code}
                hideSchedule
              />
            ))}
            {pool.length === 0 && <p className="py-4 text-center text-xs text-slate-400">Todas ubicadas 🎉</p>}
          </div>
        </div>

        <div className="space-y-3">
          {diag.terms.map((t, idx) => {
            const groups = groupTerm(t.subjects, t.continuing);
            const chipOf = ({ sd, cont }: Item) => (
              <MateriaChip
                key={sd.code}
                code={sd.code}
                time={commTime(sd.commission)}
                subtitle={sd.commission?.label}
                continuing={cont}
                onPointerDown={cont ? undefined : startPointerDrag(sd.code)}
                dimmed={dragging === sd.code}
                warn={cont ? null : warnOf(sd)}
                note={cont ? undefined : noteOf(sd)}
              />
            );
            return (
              <div
                key={t.id}
                className={`rounded-xl border p-3 ${
                  t.summer
                    ? 'border-orange-400/50 bg-orange-500/5 dark:border-orange-500/40'
                    : 'border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-900'
                }`}
              >
                <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
                  <h4 className="text-sm font-semibold">
                    {t.summer && <span className="mr-1" title="Cuatrimestre intensivo">☀️</span>}
                    {titleOf(t)}
                    {t.summer && (
                      <span className="ml-1.5 text-[10px] font-normal text-orange-600 dark:text-orange-400">
                        intensivo · hasta {SUMMER_MAX} materias
                      </span>
                    )}
                    {pinnedTerm?.label === titleOf(t) && (
                      <span className="ml-1.5 rounded bg-brand-500/15 px-1.5 py-0.5 text-[10px] font-medium text-brand-600 dark:text-brand-300">
                        📌 tu próximo cuatri
                      </span>
                    )}
                  </h4>
                  <div className="flex items-center gap-1.5 text-[10px]">
                    <span className={`rounded px-1.5 py-0.5 ${t.overCapacity ? 'bg-rose-500/15 text-rose-500' : 'bg-slate-500/10 text-slate-500'}`}>
                      {t.count}/{t.summer ? SUMMER_MAX : settings.maxPerTerm}
                    </span>
                    {t.conflictCount > 0 && (
                      <span className="rounded bg-rose-500/15 px-1.5 py-0.5 text-rose-500">
                        {t.conflictCount} choque{t.conflictCount > 1 ? 's' : ''}
                      </span>
                    )}
                    <button
                      onClick={() => copyTerm(t)}
                      disabled={t.subjects.length === 0}
                      className="rounded bg-slate-500/10 px-1.5 py-0.5 text-slate-600 hover:bg-slate-500/20 disabled:opacity-40 dark:text-slate-300"
                      title="Copiar las materias con código de materia y comisión (para la inscripción)"
                    >
                      {flash === `copiado:${t.id}` ? '✅ copiado' : flash === `error:${t.id}` ? '⚠️ no se pudo' : '📋 copiar'}
                    </button>
                    <button
                      onClick={() => pinTerm(t)}
                      disabled={t.subjects.length === 0}
                      className="rounded bg-brand-500/10 px-1.5 py-0.5 text-brand-600 hover:bg-brand-500/20 disabled:opacity-40 dark:text-brand-300"
                      title="Mostrar este cuatri como “tu próximo cuatrimestre” en el Tablero"
                    >
                      {flash === `fijado:${t.id}` ? '✅ fijado' : '📌 es mi próximo'}
                    </button>
                    <button
                      onClick={() => autocompleteFrom(idx)}
                      className="rounded bg-brand-500/10 px-1.5 py-0.5 text-brand-600 hover:bg-brand-500/20 dark:text-brand-300"
                      title={
                        'Fijar hasta este cuatri (incluido) y rearmar los siguientes.\n\n' +
                        'Si tu plan ya está completo y no se puede terminar antes, no toca nada: ' +
                        'mover materias de cuatri sin ahorrar tiempo no sirve.'
                      }
                    >
                      {flash === `optimo:${t.id}`
                        ? '✅ ya es lo más corto'
                        : '🪄 completar desde acá'}
                    </button>
                    {!t.summer && t.term === 2 && !diag.terms[idx + 1]?.summer && (
                      <button
                        onClick={() => addSummerTerm(t.id)}
                        className="rounded bg-orange-500/10 px-1.5 py-0.5 text-orange-600 hover:bg-orange-500/20 dark:text-orange-400"
                        title="Agregar el cuatrimestre intensivo de verano después de este"
                      >
                        ☀️ + verano
                      </button>
                    )}
                    <button onClick={() => removeManualTerm(t.id)} className="text-slate-400 hover:text-rose-500" title="Eliminar cuatri">
                      ✕
                    </button>
                  </div>
                </div>

                {t.summerErrors?.map((e) => (
                  <div key={e} className="mb-1.5 rounded bg-rose-500/10 px-2 py-1 text-[11px] text-rose-600 dark:text-rose-400">
                    ⛔ {e}
                  </div>
                ))}
                {t.summer && !t.summerErrors && (
                  <p className="mb-1.5 text-[10px] text-orange-600/80 dark:text-orange-400/80">
                    La oferta de verano depende de la demanda, así que elegí materia y horario
                    libremente: no te avisamos por horarios. Sí valen las correlativas.
                  </p>
                )}

                <div className="grid grid-cols-[repeat(6,minmax(0,1fr))] gap-1.5">
                  {DAYS.map((day) => {
                    const col = groups.cols.get(day)!;
                    // Chips en un layout ESTABLE (no cambia al arrastrar): mañana,
                    // tarde, noche de arriba hacia abajo.
                    const chips = [...col.m, ...col.t, ...col.n];
                    return (
                      <div
                        key={day}
                        data-slot
                        data-term={t.id}
                        data-idx={idx}
                        data-day={day}
                        className="relative min-h-[92px] min-w-0"
                      >
                        <div className="mb-1 text-center text-[10px] font-semibold text-slate-400">
                          {DAY_SHORT[day]}
                        </div>
                        {/* Al arrastrar, las materias se desvanecen: así las bandas
                            de color se leen limpias y no queda todo mezclado. */}
                        <div
                          className={`space-y-1 transition-opacity duration-150 ${
                            dragging ? 'opacity-[0.06]' : ''
                          }`}
                        >
                          {chips.map(chipOf)}
                        </div>
                        {dragging && (
                          <div className="pointer-events-none absolute inset-x-0 bottom-0 top-[18px] flex flex-col gap-0.5">
                            {TURNOS.map(({ key: turno, label }) => {
                              const st = slotStatus(idx, day, turno);
                              const isHover =
                                hover?.term === idx && hover?.day === day && hover?.turno === turno;
                              const ocupadas = col[turno].length;
                              return (
                                <div
                                  key={turno}
                                  className={`flex flex-1 flex-col items-center justify-center gap-0.5 overflow-hidden rounded-md text-white ${cellColor(
                                    st,
                                  )} ${isHover ? 'ring-2 ring-white shadow-lg' : ''}`}
                                >
                                  <span className="text-[8px] font-semibold uppercase tracking-wide">
                                    {label}
                                  </span>
                                  {ocupadas > 0 && (
                                    <span className="text-[8px] leading-none text-white/85">
                                      {ocupadas} ubicada{ocupadas > 1 ? 's' : ''}
                                    </span>
                                  )}
                                </div>
                              );
                            })}
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
                {groups.noDay.length > 0 && (
                  <div className="mt-2 flex flex-wrap items-center gap-1.5">
                    <span className="text-[10px] font-semibold text-slate-400">💻 Sin día fijo:</span>
                    {groups.noDay.map(chipOf)}
                  </div>
                )}

                {/* Motivos de conflictos ya soltados */}
                {t.subjects
                  .filter((sd) => !sd.ok)
                  .map((sd) => (
                    <div key={sd.code} className="mt-1 text-[10px] text-rose-500">
                      {sd.missingPrereqs.length > 0 &&
                        `${name(sd.code)}: faltan ${sd.missingPrereqs.map(name).join(', ')}`}
                      {sd.calendarError && `${name(sd.code)}: ${sd.calendarError}`}
                      {sd.hasConflict && `${name(sd.code)}: choque de horario`}
                      {sd.forcedNoDay && (
                        <span className="text-amber-500">
                          {name(sd.code)}: la oferta actual no la tiene ese día
                        </span>
                      )}
                    </div>
                  ))}
              </div>
            );
          })}
          {diag.terms.length === 0 && (
            <div className="rounded-xl border border-dashed border-slate-300 p-8 text-center text-sm text-slate-500 dark:border-slate-700">
              Empezá con “Sembrar desde automático” o “+ Agregar cuatri” y arrastrá materias a los días.
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
