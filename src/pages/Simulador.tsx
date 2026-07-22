import { useEffect, useMemo, useRef, useState } from 'react';
import { useDerived, useSchedule } from '@/lib/useDerived';
import { useStore } from '@/store/useStore';
import { graph } from '@/domain/planGraph';
import { getSubject } from '@/data/plan';
import { useSubjectName } from '@/lib/subjectName';
import { SettingsBar } from '@/components/SettingsBar';
import { AvailabilityGrid } from '@/components/AvailabilityGrid';
import { Badge } from '@/components/Badge';
import { formatGraduation, termLabel, trackColor } from '@/lib/ui';
import { validateManualPlan, type SubjectDiag } from '@/domain/manual';
import { schedule, calendarOf, type ScheduleResult } from '@/domain/scheduler';
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
  const [mode, setMode] = useState<'auto' | 'sicario' | 'manual'>('auto');
  const setManualTerms = useStore((s) => s.setManualTerms);

  const editInManual = (terms: { subjects: string[] }[]) => {
    setManualTerms(terms.map((t) => ({ id: crypto.randomUUID(), subjects: [...t.subjects] })));
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

/* ---------------- Chip de materia ---------------- */

function MateriaChip({
  code,
  time,
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
  onEditManual: (terms: { subjects: string[] }[]) => void;
}) {
  const d = useDerived();
  const autoSched = useSchedule();
  const settings = useStore((s) => s.user.settings);
  const offer = useStore((s) => s.offer);
  const difficultArr = useStore((s) => s.user.difficult);

  const s = useMemo(() => {
    if (!sicario) return autoSched;
    return schedule({
      graph,
      pending: d.pending,
      done: d.done,
      settings,
      offer,
      difficult: new Set(difficultArr),
      sicario: true,
    });
  }, [sicario, autoSched, d.pending, d.done, settings, offer, difficultArr]);

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
          onClick={() => onEditManual(s.terms)}
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
              <div className="mb-2 flex items-baseline justify-between">
                <h4 className="font-semibold">{termLabel(t.term, t.year)}</h4>
                <span className="text-xs text-slate-500 dark:text-slate-400">
                  {t.subjects.length} materias · {t.totalHours} hs
                </span>
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
    <div className="flex flex-wrap items-center gap-6 rounded-xl border border-brand-500/40 bg-brand-500/5 p-5">
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
  const removeManualTerm = useStore((s) => s.removeManualTerm);
  const offer = useStore((s) => s.offer);
  const settings = useStore((s) => s.user.settings);
  const difficultArr = useStore((s) => s.user.difficult);

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

  // Fija el día/turno de cada materia según la comisión que le asignó el
  // scheduler (así en el manual quedan estables y no se reordenan solas).
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

  function seedFromAuto() {
    const { fd, ft } = forcedFromSchedule(autoSched);
    seedManual(
      autoSched.terms.map((t) => ({ id: crypto.randomUUID(), subjects: [...t.subjects] })),
      fd,
      ft,
    );
  }

  // Deja fijos los cuatris 0..keepUpTo (incluido) TAL CUAL están (materias y días)
  // y autocompleta SOLO los siguientes.
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
    const cal = calendarOf(termIdx, settings.startYear, settings.startTerm);
    if ((s.annual || s.startsOnlyFirstSemester) && !cal.isFirstSemester)
      return { kind: 'block', reason: 'Solo puede arrancar en un 1er cuatrimestre (anual / Proyecto Final).' };
    const reqs = graph.prereqs.get(dragging) ?? [];
    const missing = reqs.filter((p) => (finishMap.get(p) ?? Infinity) >= termIdx);
    if (missing.length)
      return { kind: 'block', reason: `Te faltan correlativas antes: ${missing.map(name).join(', ')}.` };

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
  const cellColor = (st: DayStatus) =>
    st.kind === 'ok'
      ? 'bg-emerald-500/20 ring-1 ring-emerald-400'
      : st.kind === 'no-oferta'
        ? 'bg-amber-500/20 ring-1 ring-amber-400'
        : 'bg-rose-500/20 ring-1 ring-rose-400';

  // Agrupa las materias de un cuatri (con su diagnóstico) por día y turno.
  type Item = { sd: SubjectDiag; cont: boolean };
  type DayCol = Record<'m' | 't' | 'n', Item[]>;
  function groupTerm(subs: SubjectDiag[], continuing: SubjectDiag[]) {
    const cols = new Map<number, DayCol>();
    for (const dd of DAYS) cols.set(dd, { m: [], t: [], n: [] });
    const noDay: Item[] = [];
    const add = (sd: SubjectDiag, cont: boolean) => {
      const c = sd.commission;
      if (sd.day != null && sd.day <= 5 && c && c.meetings.length) {
        const m = c.meetings.find((mm) => mm.day === sd.day) ?? c.meetings[0];
        cols.get(sd.day)![turnoOf(toMinutes(m.start))].push({ sd, cont });
      } else if (sd.day != null && sd.day <= 5) {
        // forzada a un día sin comisión: la ubicamos en la noche por defecto.
        cols.get(sd.day)!.n.push({ sd, cont });
      } else noDay.push({ sd, cont });
    };
    for (const sd of subs) add(sd, false);
    for (const sd of continuing) add(sd, true);
    return { cols, noDay };
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
                continuing={cont}
                onPointerDown={cont ? undefined : startPointerDrag(sd.code)}
                dimmed={dragging === sd.code}
                warn={cont ? null : warnOf(sd)}
                note={cont ? undefined : noteOf(sd)}
              />
            );
            return (
              <div key={t.id} className="rounded-xl border border-slate-200 bg-white p-3 dark:border-slate-800 dark:bg-slate-900">
                <div className="mb-2 flex items-center justify-between">
                  <h4 className="text-sm font-semibold">{termLabel(t.term, t.year)}</h4>
                  <div className="flex items-center gap-2 text-[10px]">
                    <span className={`rounded px-1.5 py-0.5 ${t.overCapacity ? 'bg-rose-500/15 text-rose-500' : 'bg-slate-500/10 text-slate-500'}`}>
                      {t.count}/{settings.maxPerTerm}
                    </span>
                    {t.conflictCount > 0 && (
                      <span className="rounded bg-rose-500/15 px-1.5 py-0.5 text-rose-500">
                        {t.conflictCount} choque{t.conflictCount > 1 ? 's' : ''}
                      </span>
                    )}
                    <button
                      onClick={() => autocompleteFrom(idx)}
                      className="rounded bg-brand-500/10 px-1.5 py-0.5 text-brand-600 hover:bg-brand-500/20 dark:text-brand-300"
                      title="Fijar hasta este cuatri (incluido) y autocompletar los siguientes"
                    >
                      🪄 completar desde acá
                    </button>
                    <button onClick={() => removeManualTerm(t.id)} className="text-slate-400 hover:text-rose-500" title="Eliminar cuatri">
                      ✕
                    </button>
                  </div>
                </div>

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
                        <div className="space-y-1">{chips.map(chipOf)}</div>
                        {/* Colores de turno superpuestos (solo visual) mientras arrastrás. */}
                        {dragging && (
                          <div className="pointer-events-none absolute inset-x-0 bottom-0 top-[18px] flex flex-col gap-0.5">
                            {TURNOS.map(({ key: turno, label }) => {
                              const st = slotStatus(idx, day, turno);
                              const isHover =
                                hover?.term === idx && hover?.day === day && hover?.turno === turno;
                              return (
                                <div
                                  key={turno}
                                  className={`flex flex-1 items-start justify-center rounded-md ${cellColor(st)} ${
                                    isHover ? 'ring-2 ring-white/80' : ''
                                  }`}
                                >
                                  <span className="mt-0.5 text-[8px] uppercase tracking-wide text-white/90">
                                    {label}
                                  </span>
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
