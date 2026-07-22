import { useMemo, useState } from 'react';
import { useDerived } from '@/lib/useDerived';
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
  DAY_SHORT,
  type Commission,
} from '@/domain/conflicts';

const PFC = '03671';
const DAYS = [0, 1, 2, 3, 4, 5];

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
  draggable,
  onDragStart,
  onDragEnd,
  warn,
  note,
  hideSchedule,
}: {
  code: string;
  time?: string;
  chain?: Set<string>;
  continuing?: boolean;
  draggable?: boolean;
  onDragStart?: (e: React.DragEvent) => void;
  onDragEnd?: () => void;
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
      draggable={draggable}
      onDragStart={onDragStart}
      onDragEnd={onDragEnd}
      title={name(code)}
      className={`rounded-md border-l-4 bg-slate-50 px-1.5 py-1 text-[11px] leading-tight dark:bg-slate-800/60 ${
        draggable ? 'cursor-grab active:cursor-grabbing' : ''
      } ${warnRing} ${s.isElective ? 'border border-dashed border-slate-300 dark:border-slate-600' : ''}`}
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
    <div className="grid grid-cols-[repeat(7,minmax(0,1fr))] gap-1.5">
      {DAYS.map((d) => (
        <div key={d} className="min-w-0">
          <div className="mb-1 text-center text-[10px] font-semibold text-slate-400">{DAY_SHORT[d]}</div>
          <div className="space-y-1">{cols.get(d)!.map(chip)}</div>
        </div>
      ))}
      <div className="min-w-0">
        <div className="mb-1 text-center text-[10px] font-semibold text-slate-400">Distancia</div>
        <div className="space-y-1">{noDay.map(chip)}</div>
      </div>
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
  const settings = useStore((s) => s.user.settings);
  const offer = useStore((s) => s.offer);
  const difficultArr = useStore((s) => s.user.difficult);

  const s = useMemo(() => {
    if (!sicario) return d.schedule;
    return schedule({
      graph,
      pending: d.pending,
      done: d.done,
      settings,
      offer,
      difficult: new Set(difficultArr),
      sicario: true,
    });
  }, [sicario, d.schedule, d.pending, d.done, settings, offer, difficultArr]);

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
  const name = useSubjectName();
  const manualTerms = useStore((s) => s.manualTerms);
  const manualForcedDay = useStore((s) => s.manualForcedDay);
  const setManualTerms = useStore((s) => s.setManualTerms);
  const moveToManualTerm = useStore((s) => s.moveToManualTerm);
  const placeOnDay = useStore((s) => s.placeOnDay);
  const addManualTerm = useStore((s) => s.addManualTerm);
  const removeManualTerm = useStore((s) => s.removeManualTerm);
  const offer = useStore((s) => s.offer);
  const settings = useStore((s) => s.user.settings);
  const difficultArr = useStore((s) => s.user.difficult);
  const [dragging, setDragging] = useState<string | null>(null);
  const [hover, setHover] = useState<{ term: number; day: number } | null>(null);

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
      ),
    [d.done, manualTerms, settings, offer, difficultArr, manualForcedDay],
  );

  function seedFromAuto() {
    setManualTerms(d.schedule.terms.map((t) => ({ id: crypto.randomUUID(), subjects: [...t.subjects] })));
  }

  function autocompleteRest() {
    const preScheduled = new Map<string, number>();
    manualTerms.forEach((t, i) => t.subjects.forEach((c) => preScheduled.set(c, i)));
    const remaining = new Set([...d.pending].filter((c) => !preScheduled.has(c)));
    const res = schedule({
      graph,
      pending: remaining,
      done: d.done,
      settings,
      offer,
      difficult: new Set(difficultArr),
      preScheduled,
      firstFreeTerm: manualTerms.length,
    });
    setManualTerms(res.terms.map((t) => ({ id: crypto.randomUUID(), subjects: [...t.subjects] })));
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

  // Estado de una celda (cuatri, día) para la materia que se arrastra.
  function dayStatus(termIdx: number, day: number): DayStatus {
    if (!dragging) return { kind: 'ok', reason: '' };
    const s = graph.byCode.get(dragging)!;
    const cal = calendarOf(termIdx, settings.startYear, settings.startTerm);
    if ((s.annual || s.startsOnlyFirstSemester) && !cal.isFirstSemester)
      return { kind: 'block', reason: 'Solo puede arrancar en un 1er cuatrimestre.' };
    const reqs = graph.prereqs.get(dragging) ?? [];
    const missing = reqs.filter((p) => (finishMap.get(p) ?? Infinity) >= termIdx);
    if (missing.length)
      return { kind: 'block', reason: `Te faltan correlativas antes: ${missing.map(name).join(', ')}.` };

    const o = offMap?.get(dragging);
    const onDay = o?.commissions.filter((c) =>
      day === -1 ? c.meetings.length === 0 || c.modality === 'distancia' : c.meetings.some((m) => m.day === day),
    );
    if (!o || o.commissions.length === 0)
      return { kind: 'ok', reason: 'No está en la oferta (sin horario fijo). Podés ubicarla.' };
    if (!onDay || onDay.length === 0)
      return { kind: 'no-oferta', reason: `La oferta actual no tiene esta materia el ${DAY_SHORT[day] ?? 'ese día'}. Podés igual (quedará marcada) o actualizá la oferta.` };

    // Disponibilidad.
    if (availSet && !onDay.some((c) => commissionFitsAvailability(c, availSet)))
      return { kind: 'no-oferta', reason: 'Ese día/horario no entra en tu disponibilidad.' };

    // Choque con las otras materias del cuatri.
    const others = diag.terms[termIdx]?.subjects.filter((sd) => sd.code !== dragging && sd.commission) ?? [];
    const clashes = onDay.every((c) => others.some((sd) => commissionsOverlap(sd.commission!, c)));
    if (onDay.length > 0 && others.length > 0 && clashes)
      return { kind: 'conflict', reason: 'Se solapa con otra materia de ese cuatri.' };

    return { kind: 'ok', reason: `Podés cursarla el ${DAY_SHORT[day]} 👍` };
  }

  const startDrag = (code: string) => (e: React.DragEvent) => {
    e.dataTransfer.setData('text/plain', code);
    setDragging(code);
  };
  const endDrag = () => {
    setDragging(null);
    setHover(null);
  };

  const hoverStatus = dragging && hover ? dayStatus(hover.term, hover.day) : null;
  const cellColor = (st: DayStatus) =>
    st.kind === 'ok'
      ? 'bg-emerald-500/15 ring-1 ring-emerald-400'
      : st.kind === 'no-oferta'
        ? 'bg-amber-500/15 ring-1 ring-amber-400'
        : 'bg-rose-500/15 ring-1 ring-rose-400';

  // Agrupa las materias de un cuatri (con su diagnóstico) por día.
  type Item = { sd: SubjectDiag; cont: boolean };
  function groupTerm(subs: SubjectDiag[], continuing: SubjectDiag[]) {
    const cols = new Map<number, Item[]>();
    for (const dd of DAYS) cols.set(dd, []);
    const noDay: Item[] = [];
    const add = (sd: SubjectDiag, cont: boolean) => {
      if (sd.day != null && sd.day <= 5) cols.get(sd.day)!.push({ sd, cont });
      else noDay.push({ sd, cont });
    };
    for (const sd of subs) add(sd, false);
    for (const sd of continuing) add(sd, true);
    // Mañana arriba, noche abajo.
    const startMin = (it: Item) => {
      const t = commTime(it.sd.commission);
      return t ? Number(t.slice(0, 2)) * 60 + Number(t.slice(3)) : 0;
    };
    for (const dd of DAYS) cols.get(dd)!.sort((a, b) => startMin(a) - startMin(b));
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
            Automático: {d.schedule.makespan} cuatris
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
          >
            Autocompletar el resto
          </button>
          <button onClick={addManualTerm} className="rounded-lg border border-slate-300 px-3 py-1.5 text-sm font-medium dark:border-slate-700">
            + Agregar cuatri
          </button>
        </div>
      </div>

      <p className="text-xs text-slate-500 dark:text-slate-400">
        💡 Arrastrá una materia a un <strong>día</strong> de un cuatri. Se pinta{' '}
        <span className="text-emerald-500">verde</span> (se puede),{' '}
        <span className="text-amber-500">ámbar</span> (se puede pero no hay oferta
        ese día / no entra en tu disponibilidad) o{' '}
        <span className="text-rose-500">rojo</span> (rompe correlativas o calendario).
        Igual te deja soltarla; queda señalada.
      </p>

      {hoverStatus && (
        <div
          className={`sticky top-2 z-10 rounded-lg border px-4 py-2 text-sm font-medium shadow ${
            hoverStatus.kind === 'ok'
              ? 'border-emerald-500/40 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300'
              : hoverStatus.kind === 'no-oferta'
                ? 'border-amber-500/40 bg-amber-500/10 text-amber-700 dark:text-amber-300'
                : 'border-rose-500/40 bg-rose-500/10 text-rose-700 dark:text-rose-300'
          }`}
        >
          {name(dragging!)} → {hoverStatus.reason}
        </div>
      )}

      <div className="grid gap-4 lg:grid-cols-[220px_1fr]">
        <div
          className="rounded-xl border border-dashed border-slate-300 bg-slate-50 p-3 dark:border-slate-700 dark:bg-slate-900/50"
          onDragOver={(e) => e.preventDefault()}
          onDrop={(e) => {
            e.preventDefault();
            moveToManualTerm(e.dataTransfer.getData('text/plain'), null);
            endDrag();
          }}
        >
          <h4 className="mb-2 text-sm font-semibold">Sin ubicar ({pool.length})</h4>
          <div className="space-y-1.5">
            {pool.map((code) => (
              <MateriaChip
                key={code}
                code={code}
                chain={new Set(d.schedule.criticalChain)}
                draggable
                onDragStart={startDrag(code)}
                onDragEnd={endDrag}
                hideSchedule
              />
            ))}
            {pool.length === 0 && <p className="py-4 text-center text-xs text-slate-400">Todas ubicadas 🎉</p>}
          </div>
        </div>

        <div className="space-y-3">
          {diag.terms.map((t, idx) => {
            const groups = groupTerm(t.subjects, t.continuing);
            const dropOnDay = (day: number) => (e: React.DragEvent) => {
              e.preventDefault();
              const code = e.dataTransfer.getData('text/plain');
              placeOnDay(code, t.id, day);
              endDrag();
            };
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
                    <button onClick={() => removeManualTerm(t.id)} className="text-slate-400 hover:text-rose-500" title="Eliminar cuatri">
                      ✕
                    </button>
                  </div>
                </div>

                <div className="grid grid-cols-[repeat(7,minmax(0,1fr))] gap-1.5">
                  {DAYS.map((day) => {
                    const st = dragging ? dayStatus(idx, day) : null;
                    return (
                      <div
                        key={day}
                        onDragEnter={() => setHover({ term: idx, day })}
                        onDragOver={(e) => e.preventDefault()}
                        onDrop={dropOnDay(day)}
                        className={`min-h-[52px] min-w-0 rounded-md p-0.5 transition ${st ? cellColor(st) : ''}`}
                      >
                        <div className="mb-1 text-center text-[10px] font-semibold text-slate-400">{DAY_SHORT[day]}</div>
                        <div className="space-y-1">
                          {groups.cols.get(day)!.map(({ sd, cont }) => (
                            <MateriaChip
                              key={sd.code}
                              code={sd.code}
                              time={commTime(sd.commission)}
                              continuing={cont}
                              draggable={!cont}
                              onDragStart={cont ? undefined : startDrag(sd.code)}
                              onDragEnd={cont ? undefined : endDrag}
                              warn={cont ? null : warnOf(sd)}
                              note={cont ? undefined : noteOf(sd)}
                            />
                          ))}
                        </div>
                      </div>
                    );
                  })}
                  <div
                    onDragEnter={() => setHover({ term: idx, day: -1 })}
                    onDragOver={(e) => e.preventDefault()}
                    onDrop={dropOnDay(-1)}
                    className={`min-h-[52px] min-w-0 rounded-md p-0.5 transition ${dragging ? cellColor(dayStatus(idx, -1)) : ''}`}
                  >
                    <div className="mb-1 text-center text-[10px] font-semibold text-slate-400">Distancia</div>
                    <div className="space-y-1">
                      {groups.noDay.map(({ sd, cont }) => (
                        <MateriaChip
                          key={sd.code}
                          code={sd.code}
                          time={commTime(sd.commission)}
                          continuing={cont}
                          draggable={!cont}
                          onDragStart={cont ? undefined : startDrag(sd.code)}
                          onDragEnd={cont ? undefined : endDrag}
                          warn={cont ? null : warnOf(sd)}
                          note={cont ? undefined : sd.notOffered ? 'no está en la oferta' : noteOf(sd)}
                        />
                      ))}
                    </div>
                  </div>
                </div>

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
