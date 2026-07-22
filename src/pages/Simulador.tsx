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
import { TALLER_CODE } from '@/domain/types';
import {
  offeringMap,
  DAY_SHORT,
  type Commission,
  type OfferData,
} from '@/domain/conflicts';

const PFC = '03671';

/** Texto corto de una comisión: días/horario + modalidad. */
function fmtCommission(c: Commission): string {
  const mod = c.modality;
  if (c.meetings.length === 0) return `a distancia · ${mod}`;
  const days = c.meetings.map((m) => `${DAY_SHORT[m.day]} ${m.start}–${m.end}`).join(' + ');
  return `${days} · ${mod}`;
}

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

  // Pasa el plan automático al modo manual para editarlo a mano.
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

  if (s.terms.length === 0) {
    return (
      <div className="rounded-xl border border-emerald-500/30 bg-emerald-500/5 p-8 text-center">
        <p className="text-lg font-semibold">¡No te queda nada por planificar! 🎓</p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {sicario && (
        <p className="rounded-lg border border-rose-400/40 bg-rose-500/5 px-4 py-2 text-sm text-rose-700 dark:text-rose-300">
          🔪 <strong>Modo sicario:</strong> mete la mayor cantidad de materias
          posible por cuatri (usando todos los turnos) para recibirte lo antes
          posible. {offer ? 'Respeta los choques de horario de la oferta cargada en el 1er cuatri.' : 'Cargá la oferta para evitar choques de día/horario reales.'}
        </p>
      )}
      <ResultBanner s={s} />

      {/* Pasar a manual para editar */}
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-slate-200 bg-white px-4 py-3 dark:border-slate-800 dark:bg-slate-900">
        <p className="text-sm text-slate-600 dark:text-slate-400">
          ¿Querés cambiar algo? (mover una materia a otro cuatri, sacar o adelantar
          alguna). Pasá este plan al <strong>modo manual</strong> y editalo libre:
          se siguen validando correlativas, cupos de horario y choques.
        </p>
        <button
          onClick={() => onEditManual(s.terms)}
          className="shrink-0 rounded-lg bg-brand-600 px-4 py-2 text-sm font-medium text-white hover:bg-brand-700"
        >
          ✏️ Editar en manual
        </button>
      </div>

      {!offer && (
        <p className="rounded-lg border border-slate-200 bg-white px-4 py-2 text-xs text-slate-500 dark:border-slate-800 dark:bg-slate-900 dark:text-slate-400">
          💡 Cargá la oferta (solapa <strong>Oferta</strong>) para ver el día,
          horario y modalidad de cada materia, y para que respete tu disponibilidad.
        </p>
      )}

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
        {s.terms.map((t) => {
          // Materias anuales que arrancaron el cuatri anterior y siguen acá.
          const continuing = [...s.startByCode.entries()]
            .filter(([c, st]) => st === t.index - 1 && getSubject(c)?.annual)
            .map(([c]) => c);
          return (
            <TermCard
              key={t.index}
              title={termLabel(t.term, t.year)}
              subtitle={`${t.subjects.length} materias · ${t.totalHours} hs`}
              codes={t.subjects}
              continuing={continuing}
              chain={chain}
              offer={offer}
            />
          );
        })}
      </div>
      {offMap && (
        <p className="text-xs text-slate-500 dark:text-slate-400">
          Día/horario/modalidad tomados de la oferta cargada. En cuatris futuros
          la oferta puede cambiar; sirven como referencia.
        </p>
      )}
      <Legenda />
    </div>
  );
}

function Legenda() {
  return (
    <p className="text-xs text-slate-500 dark:text-slate-400">
      <span className="mr-3">
        <span className="inline-block h-2 w-3 rounded-sm bg-brand-500 align-middle" />{' '}
        ruta crítica (destraba el egreso)
      </span>
      <span className="mr-3">
        <span className="inline-block h-2 w-3 rounded-sm bg-orange-400 align-middle" />{' '}
        Proyecto Final
      </span>
      <span>◌ electiva</span>
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

function TermCard({
  title,
  subtitle,
  codes,
  continuing = [],
  chain,
  offer,
}: {
  title: string;
  subtitle: string;
  codes: string[];
  continuing?: string[];
  chain: Set<string>;
  offer?: OfferData | null;
}) {
  const name = useSubjectName();
  const offMap = offer ? offeringMap(offer) : null;
  return (
    <div className="rounded-xl border border-slate-200 bg-white p-3 shadow-sm dark:border-slate-800 dark:bg-slate-900">
      <div className="mb-2 flex items-baseline justify-between">
        <h4 className="font-semibold">{title}</h4>
        <span className="text-xs text-slate-500 dark:text-slate-400">{subtitle}</span>
      </div>
      {continuing.map((c) => (
        <div
          key={c}
          className="mb-1.5 rounded-lg border-l-4 border-dashed bg-orange-500/5 px-2.5 py-1.5 text-sm"
          style={{ borderLeftColor: '#fb923c' }}
        >
          <span className="font-medium">{name(c)}</span>
          <span className="ml-1 text-[10px] text-orange-500">· continúa (anual)</span>
        </div>
      ))}
      <ul className="space-y-1.5">
        {codes.map((code) => {
          const s = getSubject(code)!;
          const inChain = chain.has(code);
          const isPFC = code === PFC;
          const borderColor = isPFC ? '#fb923c' : inChain ? '#3479f6' : trackColor(s.track);
          return (
            <li
              key={code}
              className={`rounded-lg border-l-4 bg-slate-50 px-2.5 py-1.5 text-sm dark:bg-slate-800/50 ${
                s.isElective ? 'border border-dashed border-slate-300 dark:border-slate-600' : ''
              }`}
              style={{ borderLeftColor: borderColor }}
            >
              <div className="flex items-center justify-between gap-2">
                <span className="font-medium leading-tight">
                  {s.isElective && '◌ '}
                  {name(code)}
                </span>
                <span className="shrink-0 font-mono text-[10px] text-slate-400">{s.code}</span>
              </div>
              <div className="flex gap-1 text-[10px]">
                {inChain && <span className="font-medium text-brand-500">ruta crítica</span>}
                {isPFC && <span className="font-medium text-orange-500">Proyecto Final</span>}
                {s.annual && <span className="text-orange-400">· anual</span>}
                {code === TALLER_CODE && <span className="text-slate-400">· optativa</span>}
              </div>
              {offMap &&
                (() => {
                  const o = offMap.get(code);
                  if (!o || o.commissions.length === 0) return null;
                  const first = o.commissions[0];
                  return (
                    <div className="mt-0.5 text-[10px] text-slate-500 dark:text-slate-400">
                      🕒 {fmtCommission(first)}
                      {o.commissions.length > 1 && ` · +${o.commissions.length - 1} comis.`}
                    </div>
                  );
                })()}
            </li>
          );
        })}
      </ul>
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

  // Autocompleta los cuatris que faltan, dejando fijos los que armaste a mano.
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

  // Al arrastrar una materia: a qué cuatris se puede mover sin romper nada.
  const validTerm = useMemo(() => {
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
    return (i: number): boolean => {
      const cal = calendarOf(i, settings.startYear, settings.startTerm);
      if ((s?.annual || s?.startsOnlyFirstSemester) && !cal.isFirstSemester) return false;
      if (!reqs.every((p) => (finish.get(p) ?? Infinity) < i)) return false;
      const cnt = manualTerms[i].subjects.filter((c) => c !== dragging).length;
      if (cnt >= settings.maxPerTerm) return false;
      return true;
    };
  }, [dragging, manualTerms, d.done, settings]);

  const dragCode = (e: React.DragEvent) => e.dataTransfer.getData('text/plain');

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
        <div className="flex gap-2">
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
        💡 Arrastrá materias entre cuatris. Mientras arrastrás, los cuatris se
        pintan de <span className="text-emerald-500">verde</span> (podés soltarla
        ahí) o <span className="text-rose-500">rojo</span> (rompería correlativas,
        calendario o el cupo). También podés armar los primeros cuatris a mano y
        tocar <strong>“Autocompletar el resto”</strong>.
      </p>

      <div className="grid gap-4 lg:grid-cols-[260px_1fr]">
        <div
          className="rounded-xl border border-dashed border-slate-300 bg-slate-50 p-3 dark:border-slate-700 dark:bg-slate-900/50"
          onDragOver={(e) => e.preventDefault()}
          onDrop={(e) => {
            e.preventDefault();
            moveToManualTerm(dragCode(e), null);
          }}
        >
          <h4 className="mb-2 text-sm font-semibold">Sin ubicar ({pool.length})</h4>
          <div className="space-y-1.5">
            {pool.map((code) => (
              <DraggableSubject
                key={code}
                code={code}
                termOptions={manualTerms}
                onDragStartCode={setDragging}
                onDragEndCode={() => setDragging(null)}
              />
            ))}
            {pool.length === 0 && (
              <p className="py-4 text-center text-xs text-slate-400">Todas ubicadas 🎉</p>
            )}
          </div>
        </div>

        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
          {diag.terms.map((t, idx) => {
            const ok = validTerm ? validTerm(idx) : null;
            const ring =
              ok === true
                ? 'ring-2 ring-emerald-400'
                : ok === false
                  ? 'ring-2 ring-rose-400 opacity-60'
                  : '';
            return (
            <div
              key={t.id}
              className={`rounded-xl border border-slate-200 bg-white p-3 transition dark:border-slate-800 dark:bg-slate-900 ${ring}`}
              onDragOver={(e) => e.preventDefault()}
              onDrop={(e) => {
                e.preventDefault();
                moveToManualTerm(dragCode(e), t.id);
              }}
            >
              <div className="mb-2 flex items-center justify-between">
                <h4 className="text-sm font-semibold">{termLabel(t.term, t.year)}</h4>
                <button
                  onClick={() => removeManualTerm(t.id)}
                  className="text-xs text-slate-400 hover:text-rose-500"
                  title="Eliminar cuatri"
                >
                  ✕
                </button>
              </div>
              <div className="mb-2 flex flex-wrap gap-1 text-[10px]">
                <span
                  className={`rounded px-1.5 py-0.5 ${
                    t.overCapacity ? 'bg-rose-500/15 text-rose-500' : 'bg-slate-500/10 text-slate-500'
                  }`}
                >
                  {t.count}/{settings.maxPerTerm} materias
                </span>
                {t.conflictCount > 0 && (
                  <span className="rounded bg-rose-500/15 px-1.5 py-0.5 text-rose-500">
                    {t.conflictCount} choque{t.conflictCount > 1 ? 's' : ''}
                  </span>
                )}
                <span className="rounded bg-slate-500/10 px-1.5 py-0.5 text-slate-500">{t.hours} hs</span>
              </div>
              <div className="min-h-[40px] space-y-1.5">
                {t.subjects.map((sd) => (
                  <div
                    key={sd.code}
                    draggable
                    onDragStart={(e) => {
                      e.dataTransfer.setData('text/plain', sd.code);
                      setDragging(sd.code);
                    }}
                    onDragEnd={() => setDragging(null)}
                    className={`cursor-grab rounded-lg border px-2.5 py-1.5 text-sm active:cursor-grabbing ${
                      sd.ok
                        ? 'border-slate-200 bg-slate-50 dark:border-slate-700 dark:bg-slate-800/50'
                        : 'border-rose-400 bg-rose-500/5'
                    }`}
                  >
                    <div className="flex items-center justify-between gap-1">
                      <span className="font-medium leading-tight">{name(sd.code)}</span>
                      <span className="font-mono text-[10px] text-slate-400">{sd.code}</span>
                    </div>
                    {sd.missingPrereqs.length > 0 && (
                      <div className="text-[10px] text-rose-500">
                        faltan correlativas: {sd.missingPrereqs.map((c) => name(c)).join(', ')}
                      </div>
                    )}
                    {sd.calendarError && (
                      <div className="text-[10px] text-rose-500">{sd.calendarError}</div>
                    )}
                    {sd.hasConflict && (
                      <div className="text-[10px] text-rose-500">choque de horario</div>
                    )}
                    {sd.notOffered && (
                      <div className="text-[10px] text-amber-500">
                        ⚠ no figura en la oferta actual
                      </div>
                    )}
                    {sd.notAvailable && (
                      <div className="text-[10px] text-amber-500">
                        ⚠ no hay comisión en tu disponibilidad
                      </div>
                    )}
                  </div>
                ))}
                {t.subjects.length === 0 && (
                  <p className="py-2 text-center text-[11px] text-slate-400">Arrastrá materias acá</p>
                )}
              </div>
            </div>
            );
          })}
          {diag.terms.length === 0 && (
            <div className="col-span-full rounded-xl border border-dashed border-slate-300 p-8 text-center text-sm text-slate-500 dark:border-slate-700">
              Empezá con “Sembrar desde automático” o “+ Agregar cuatri” y arrastrá materias.
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function DraggableSubject({
  code,
  termOptions,
  onDragStartCode,
  onDragEndCode,
}: {
  code: string;
  termOptions: { id: string; subjects: string[] }[];
  onDragStartCode?: (code: string) => void;
  onDragEndCode?: () => void;
}) {
  const name = useSubjectName();
  const moveToManualTerm = useStore((s) => s.moveToManualTerm);
  const s = getSubject(code)!;
  return (
    <div
      draggable
      onDragStart={(e) => {
        e.dataTransfer.setData('text/plain', code);
        onDragStartCode?.(code);
      }}
      onDragEnd={() => onDragEndCode?.()}
      className="cursor-grab rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-sm active:cursor-grabbing dark:border-slate-700 dark:bg-slate-800"
      style={{ borderLeft: `3px solid ${trackColor(s.track)}` }}
    >
      <div className="flex items-center justify-between gap-1">
        <span className="font-medium leading-tight">{name(code)}</span>
        <span className="font-mono text-[10px] text-slate-400">{s.code}</span>
      </div>
      {termOptions.length > 0 && (
        <select
          aria-label={`Mover ${name(code)} a un cuatrimestre`}
          className="mt-1 w-full rounded border border-slate-200 bg-transparent px-1 py-0.5 text-[11px] dark:border-slate-700"
          value=""
          onChange={(e) => e.target.value && moveToManualTerm(code, e.target.value)}
        >
          <option value="">Mover a…</option>
          {termOptions.map((t, i) => (
            <option key={t.id} value={t.id}>
              Cuatri {i + 1}
            </option>
          ))}
        </select>
      )}
    </div>
  );
}
