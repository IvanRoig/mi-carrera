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
import { validateManualPlan } from '@/domain/manual';
import { schedule, calendarOf, type ScheduleResult } from '@/domain/scheduler';
import {
  offeringMap,
  commissionFitsAvailability,
  isNightCommission,
  DAY_SHORT,
  type Commission,
  type Offering,
} from '@/domain/conflicts';

const PFC = '03671';

function yearsLabel(years: number): string {
  if (years <= 0) return '—';
  const whole = Math.floor(years);
  const half = years - whole >= 0.5;
  if (whole === 0) return 'medio año';
  return half ? `${whole} años y medio` : `${whole} año${whole === 1 ? '' : 's'}`;
}

/** Comisión representativa: prioriza tu disponibilidad, si no la noche, si no la 1°. */
function pickCommission(o: Offering, availableSlots: Set<string> | null): Commission | undefined {
  if (o.commissions.length === 0) return undefined;
  if (availableSlots) {
    const fit = o.commissions.find((c) => commissionFitsAvailability(c, availableSlots));
    if (fit) return fit;
  }
  return o.commissions.find((c) => isNightCommission(c)) ?? o.commissions[0];
}

/** Agrupa las materias de un cuatri por día (según la comisión representativa). */
function groupByDay(
  codes: string[],
  offMap: Map<string, Offering> | null,
  availableSlots: Set<string> | null,
) {
  const cols = new Map<number, { code: string; time: string }[]>();
  for (let d = 0; d < 6; d++) cols.set(d, []);
  const noDay: string[] = [];
  for (const code of codes) {
    const o = offMap?.get(code);
    const comm = o ? pickCommission(o, availableSlots) : undefined;
    if (comm && comm.meetings.length) {
      const seen = new Set<number>();
      for (const m of comm.meetings) {
        if (seen.has(m.day) || m.day > 5) continue;
        seen.add(m.day);
        cols.get(m.day)!.push({ code, time: `${m.start}` });
      }
    } else {
      noDay.push(code);
    }
  }
  return { cols, noDay };
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

/* ---------------- Chip de materia ---------------- */

function MateriaChip({
  code,
  time,
  chain,
  continuing,
  draggable,
  onDragStart,
  onDragEnd,
  invalid,
}: {
  code: string;
  time?: string;
  chain?: Set<string>;
  continuing?: boolean;
  draggable?: boolean;
  onDragStart?: (e: React.DragEvent) => void;
  onDragEnd?: () => void;
  invalid?: boolean;
}) {
  const name = useSubjectName();
  const s = getSubject(code)!;
  const isPFC = code === PFC;
  const border = isPFC ? '#fb923c' : chain?.has(code) ? '#3479f6' : trackColor(s.track);
  return (
    <div
      draggable={draggable}
      onDragStart={onDragStart}
      onDragEnd={onDragEnd}
      title={name(code)}
      className={`rounded-md border-l-4 bg-slate-50 px-1.5 py-1 text-[11px] leading-tight dark:bg-slate-800/60 ${
        draggable ? 'cursor-grab active:cursor-grabbing' : ''
      } ${invalid ? 'ring-1 ring-rose-400' : ''} ${
        s.isElective ? 'border border-dashed border-slate-300 dark:border-slate-600' : ''
      }`}
      style={{ borderLeftColor: border }}
    >
      <div className="font-medium">
        {s.isElective && '◌ '}
        {name(code)}
      </div>
      <div className="text-[9px] text-slate-500 dark:text-slate-400">
        {continuing ? 'continúa (anual)' : time ? `🕒 ${time}` : 'a distancia'}
        {chain?.has(code) && !continuing && ' · crítica'}
      </div>
    </div>
  );
}

/* ---------------- Grilla de un cuatri por día ---------------- */

function TermGrid({
  codes,
  continuing = [],
  offMap,
  availableSlots,
  chain,
  drag,
}: {
  codes: string[];
  continuing?: string[];
  offMap: Map<string, Offering> | null;
  availableSlots: Set<string> | null;
  chain?: Set<string>;
  drag?: {
    onDragStart: (code: string) => (e: React.DragEvent) => void;
    onDragEnd: () => void;
    invalidCodes?: Set<string>;
  };
}) {
  const contSet = new Set(continuing);
  const groups = groupByDay([...codes, ...continuing], offMap, availableSlots);
  const days = [0, 1, 2, 3, 4, 5];

  const renderChip = (code: string, time?: string) => (
    <MateriaChip
      key={code}
      code={code}
      time={time}
      chain={chain}
      continuing={contSet.has(code)}
      draggable={!!drag}
      onDragStart={drag?.onDragStart(code)}
      onDragEnd={drag?.onDragEnd}
      invalid={drag?.invalidCodes?.has(code)}
    />
  );

  return (
    <div className="grid grid-cols-[repeat(7,minmax(0,1fr))] gap-1.5">
      {days.map((d) => (
        <div key={d} className="min-w-0">
          <div className="mb-1 text-center text-[10px] font-semibold text-slate-400">
            {DAY_SHORT[d]}
          </div>
          <div className="space-y-1">
            {groups.cols.get(d)!.map((it) => renderChip(it.code, it.time))}
          </div>
        </div>
      ))}
      <div className="min-w-0">
        <div className="mb-1 text-center text-[10px] font-semibold text-slate-400">
          Distancia
        </div>
        <div className="space-y-1">{groups.noDay.map((code) => renderChip(code))}</div>
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
  const offMap = useMemo(() => (offer ? offeringMap(offer) : null), [offer]);
  const availSet = settings.restrictAvailability ? new Set(settings.availableSlots) : null;

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
          posible (usando todos los turnos), respetando choques de horario.
        </p>
      )}
      <ResultBanner s={s} />

      <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-slate-200 bg-white px-4 py-3 dark:border-slate-800 dark:bg-slate-900">
        <p className="text-sm text-slate-600 dark:text-slate-400">
          ¿Querés cambiar algo? (mover una materia, sacar o adelantar alguna). Pasá
          este plan al <strong>modo manual</strong> y editalo libre: se siguen
          validando correlativas, cupos de horario y choques.
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
                offMap={offMap}
                availableSlots={availSet}
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

/* ---------------- Vista manual (drag & drop) ---------------- */

function ManualView() {
  const d = useDerived();
  const name = useSubjectName();
  const manualTerms = useStore((s) => s.manualTerms);
  const setManualTerms = useStore((s) => s.setManualTerms);
  const moveToManualTerm = useStore((s) => s.moveToManualTerm);
  const addManualTerm = useStore((s) => s.addManualTerm);
  const removeManualTerm = useStore((s) => s.removeManualTerm);
  const offer = useStore((s) => s.offer);
  const settings = useStore((s) => s.user.settings);
  const difficultArr = useStore((s) => s.user.difficult);
  const [dragging, setDragging] = useState<string | null>(null);
  const [hoverTerm, setHoverTerm] = useState<number | null>(null);

  const offMap = useMemo(() => (offer ? offeringMap(offer) : null), [offer]);
  const availSet = settings.restrictAvailability ? new Set(settings.availableSlots) : null;
  const placed = new Set(manualTerms.flatMap((t) => t.subjects));
  const pool = [...d.pending].filter((c) => !placed.has(c));

  const diag = useMemo(
    () => validateManualPlan(graph, d.done, manualTerms, settings, offer, new Set(difficultArr)),
    [d.done, manualTerms, settings, offer, difficultArr],
  );

  function seedFromAuto() {
    setManualTerms(
      d.schedule.terms.map((t) => ({ id: crypto.randomUUID(), subjects: [...t.subjects] })),
    );
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

  // Motivo por el que una materia arrastrada puede/no puede ir a un cuatri.
  const dragInfo = useMemo(() => {
    if (!dragging) return null;
    const s = graph.byCode.get(dragging);
    const finish = new Map<string, number>();
    for (const c of d.done) finish.set(c, -1);
    manualTerms.forEach((t, i) =>
      t.subjects.forEach((c) => {
        if (c !== dragging) finish.set(c, i + (graph.byCode.get(c)?.annual ? 1 : 0));
      }),
    );
    const reqs = graph.prereqs.get(dragging) ?? [];
    const availableSlots = settings.restrictAvailability ? new Set(settings.availableSlots) : null;
    return (i: number): { ok: boolean; reason: string } => {
      const cal = calendarOf(i, settings.startYear, settings.startTerm);
      if ((s?.annual || s?.startsOnlyFirstSemester) && !cal.isFirstSemester)
        return { ok: false, reason: 'Solo puede arrancar en un 1er cuatrimestre (materia anual / Proyecto Final).' };
      const missing = reqs.filter((p) => (finish.get(p) ?? Infinity) >= i);
      if (missing.length)
        return { ok: false, reason: `Te faltan correlativas antes: ${missing.map(name).join(', ')}.` };
      const cnt = manualTerms[i]?.subjects.filter((c) => c !== dragging).length ?? 0;
      if (cnt >= settings.maxPerTerm)
        return { ok: false, reason: `Ese cuatri ya llegó al tope (${settings.maxPerTerm} materias).` };
      if (i === 0 && offMap && availableSlots) {
        const o = offMap.get(dragging);
        if (o && o.commissions.length && !o.commissions.some((c) => commissionFitsAvailability(c, availableSlots)))
          return { ok: false, reason: 'No hay comisión en tu disponibilidad horaria para ese día/turno.' };
      }
      return { ok: true, reason: 'Podés cursarla acá 👍' };
    };
  }, [dragging, manualTerms, d.done, settings, offMap, name]);

  const dragCode = (e: React.DragEvent) => e.dataTransfer.getData('text/plain');
  const startDrag = (code: string) => (e: React.DragEvent) => {
    e.dataTransfer.setData('text/plain', code);
    setDragging(code);
  };
  const endDrag = () => {
    setDragging(null);
    setHoverTerm(null);
  };

  const hoverReason = dragging && hoverTerm != null && dragInfo ? dragInfo(hoverTerm) : null;

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
            <span className="text-xs text-rose-600 dark:text-rose-400">
              ⚠ hay conflictos (ver bordes rojos)
            </span>
          )}
        </div>
        <div className="flex flex-wrap gap-2">
          <button
            onClick={seedFromAuto}
            className="rounded-lg bg-brand-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-brand-700"
          >
            Sembrar desde automático
          </button>
          <button
            onClick={autocompleteRest}
            disabled={manualTerms.length === 0}
            className="rounded-lg border border-brand-500 px-3 py-1.5 text-sm font-medium text-brand-600 hover:bg-brand-500/10 disabled:opacity-40 dark:text-brand-300"
            title="Deja fijos los cuatris que armaste y completa el resto automáticamente"
          >
            Autocompletar el resto
          </button>
          <button
            onClick={addManualTerm}
            className="rounded-lg border border-slate-300 px-3 py-1.5 text-sm font-medium dark:border-slate-700"
          >
            + Agregar cuatri
          </button>
        </div>
      </div>

      <p className="text-xs text-slate-500 dark:text-slate-400">
        💡 Arrastrá materias entre cuatris. Los cuatris se pintan{' '}
        <span className="text-emerald-500">verde</span> (podés) o{' '}
        <span className="text-rose-500">rojo</span> (rompería algo); pasando por
        encima te digo el motivo. También podés armar los primeros cuatris a mano y
        tocar <strong>“Autocompletar el resto”</strong>.
      </p>

      {/* Banner de motivo al arrastrar */}
      {hoverReason && (
        <div
          className={`sticky top-2 z-10 rounded-lg border px-4 py-2 text-sm font-medium shadow ${
            hoverReason.ok
              ? 'border-emerald-500/40 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300'
              : 'border-rose-500/40 bg-rose-500/10 text-rose-700 dark:text-rose-300'
          }`}
        >
          {hoverReason.ok ? '✅' : '⛔'} {name(dragging!)} → {hoverReason.reason}
        </div>
      )}

      <div className="grid gap-4 lg:grid-cols-[240px_1fr]">
        <div
          className="rounded-xl border border-dashed border-slate-300 bg-slate-50 p-3 dark:border-slate-700 dark:bg-slate-900/50"
          onDragOver={(e) => e.preventDefault()}
          onDrop={(e) => {
            e.preventDefault();
            moveToManualTerm(dragCode(e), null);
            endDrag();
          }}
        >
          <h4 className="mb-2 text-sm font-semibold">Sin ubicar ({pool.length})</h4>
          <div className="space-y-1.5">
            {pool.map((code) => (
              <div key={code} draggable onDragStart={startDrag(code)} onDragEnd={endDrag}>
                <MateriaChip code={code} chain={new Set(d.schedule.criticalChain)} draggable />
              </div>
            ))}
            {pool.length === 0 && (
              <p className="py-4 text-center text-xs text-slate-400">Todas ubicadas 🎉</p>
            )}
          </div>
        </div>

        <div className="space-y-3">
          {diag.terms.map((t, idx) => {
            const info = dragInfo ? dragInfo(idx) : null;
            const ring = !dragging
              ? ''
              : info?.ok
                ? 'ring-2 ring-emerald-400'
                : 'ring-2 ring-rose-400 opacity-70';
            const invalidCodes = new Set(
              t.subjects.filter((sd) => !sd.ok).map((sd) => sd.code),
            );
            return (
              <div
                key={t.id}
                className={`rounded-xl border border-slate-200 bg-white p-3 transition dark:border-slate-800 dark:bg-slate-900 ${ring}`}
                onDragEnter={() => setHoverTerm(idx)}
                onDragOver={(e) => e.preventDefault()}
                onDrop={(e) => {
                  e.preventDefault();
                  moveToManualTerm(dragCode(e), t.id);
                  endDrag();
                }}
              >
                <div className="mb-2 flex items-center justify-between">
                  <h4 className="text-sm font-semibold">{termLabel(t.term, t.year)}</h4>
                  <div className="flex items-center gap-2 text-[10px]">
                    <span
                      className={`rounded px-1.5 py-0.5 ${
                        t.overCapacity ? 'bg-rose-500/15 text-rose-500' : 'bg-slate-500/10 text-slate-500'
                      }`}
                    >
                      {t.count}/{settings.maxPerTerm}
                    </span>
                    {t.conflictCount > 0 && (
                      <span className="rounded bg-rose-500/15 px-1.5 py-0.5 text-rose-500">
                        {t.conflictCount} choque{t.conflictCount > 1 ? 's' : ''}
                      </span>
                    )}
                    <button
                      onClick={() => removeManualTerm(t.id)}
                      className="text-slate-400 hover:text-rose-500"
                      title="Eliminar cuatri"
                    >
                      ✕
                    </button>
                  </div>
                </div>

                {t.subjects.length === 0 ? (
                  <p className="py-3 text-center text-[11px] text-slate-400">
                    Arrastrá materias acá
                  </p>
                ) : (
                  <TermGrid
                    codes={t.subjects.map((sd) => sd.code)}
                    offMap={offMap}
                    availableSlots={availSet}
                    drag={{ onDragStart: startDrag, onDragEnd: endDrag, invalidCodes }}
                  />
                )}

                {/* Motivos de los conflictos ya soltados */}
                {t.subjects
                  .filter((sd) => !sd.ok || sd.notOffered || sd.notAvailable)
                  .map((sd) => (
                    <div key={sd.code} className="mt-1 text-[10px]">
                      {sd.missingPrereqs.length > 0 && (
                        <div className="text-rose-500">
                          {name(sd.code)}: faltan {sd.missingPrereqs.map(name).join(', ')}
                        </div>
                      )}
                      {sd.calendarError && (
                        <div className="text-rose-500">
                          {name(sd.code)}: {sd.calendarError}
                        </div>
                      )}
                      {sd.hasConflict && (
                        <div className="text-rose-500">{name(sd.code)}: choque de horario</div>
                      )}
                      {sd.notOffered && (
                        <div className="text-amber-500">
                          ⚠ {name(sd.code)}: no figura en la oferta actual
                        </div>
                      )}
                      {sd.notAvailable && (
                        <div className="text-amber-500">
                          ⚠ {name(sd.code)}: no hay comisión en tu disponibilidad
                        </div>
                      )}
                    </div>
                  ))}
              </div>
            );
          })}
          {diag.terms.length === 0 && (
            <div className="rounded-xl border border-dashed border-slate-300 p-8 text-center text-sm text-slate-500 dark:border-slate-700">
              Empezá con “Sembrar desde automático” o “+ Agregar cuatri” y arrastrá materias.
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
