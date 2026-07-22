import { useMemo, useState } from 'react';
import { useDerived } from '@/lib/useDerived';
import { useStore } from '@/store/useStore';
import { graph } from '@/domain/planGraph';
import { getSubject } from '@/data/plan';
import { useSubjectName } from '@/lib/subjectName';
import { SettingsBar } from '@/components/SettingsBar';
import { Badge } from '@/components/Badge';
import { formatGraduation, termLabel, trackColor } from '@/lib/ui';
import { validateManualPlan } from '@/domain/manual';
import type { ScheduleResult } from '@/domain/scheduler';

export function Simulador() {
  const [mode, setMode] = useState<'auto' | 'manual'>('auto');

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-2">
        <ModeButton active={mode === 'auto'} onClick={() => setMode('auto')}>
          🤖 Automático (óptimo)
        </ModeButton>
        <ModeButton active={mode === 'manual'} onClick={() => setMode('manual')}>
          ✋ Armado manual
        </ModeButton>
      </div>

      <SettingsBar />

      {mode === 'auto' ? <AutoView /> : <ManualView />}
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

function AutoView() {
  const d = useDerived();
  const s = d.schedule;
  const chain = new Set(s.criticalChain);

  if (s.terms.length === 0) {
    return (
      <div className="rounded-xl border border-emerald-500/30 bg-emerald-500/5 p-8 text-center">
        <p className="text-lg font-semibold">¡No te queda nada por planificar! 🎓</p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <ResultBanner s={s} />
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
        {s.terms.map((t) => (
          <TermCard
            key={t.index}
            title={termLabel(t.term, t.year)}
            subtitle={`${t.subjects.length} materias · ${t.totalHours} hs`}
            codes={t.subjects}
            chain={chain}
          />
        ))}
      </div>
      <p className="text-xs text-slate-500 dark:text-slate-400">
        Calculado con <strong>list scheduling</strong> por ruta crítica (prioriza
        las materias que encabezan las cadenas más largas) + una pasada de
        compactación. Las materias con borde de color son de la{' '}
        <span className="text-brand-500">ruta crítica</span>.
      </p>
    </div>
  );
}

function ResultBanner({ s }: { s: ScheduleResult }) {
  return (
    <div className="flex flex-wrap items-center gap-6 rounded-xl border border-brand-500/40 bg-brand-500/5 p-5">
      <div>
        <div className="text-4xl font-bold tracking-tight">{s.makespan}</div>
        <div className="text-sm text-slate-500 dark:text-slate-400">
          cuatrimestres
        </div>
      </div>
      <div className="h-10 w-px bg-slate-300 dark:bg-slate-700" />
      <div>
        <div className="text-2xl font-semibold">
          {formatGraduation(s.graduation)}
        </div>
        <div className="text-sm text-slate-500 dark:text-slate-400">
          egreso estimado (con trámite de título)
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
  chain,
  warn,
}: {
  title: string;
  subtitle: string;
  codes: string[];
  chain: Set<string>;
  warn?: string;
}) {
  const name = useSubjectName();
  return (
    <div className="rounded-xl border border-slate-200 bg-white p-3 shadow-sm dark:border-slate-800 dark:bg-slate-900">
      <div className="mb-2 flex items-baseline justify-between">
        <h4 className="font-semibold">{title}</h4>
        <span className="text-xs text-slate-500 dark:text-slate-400">
          {subtitle}
        </span>
      </div>
      {warn && (
        <div className="mb-2 rounded-md bg-rose-500/10 px-2 py-1 text-xs text-rose-600 dark:text-rose-400">
          {warn}
        </div>
      )}
      <ul className="space-y-1.5">
        {codes.map((code) => {
          const s = getSubject(code)!;
          const inChain = chain.has(code);
          return (
            <li
              key={code}
              className={`rounded-lg border-l-4 bg-slate-50 px-2.5 py-1.5 text-sm dark:bg-slate-800/50 ${
                inChain ? '' : 'border-l-transparent'
              }`}
              style={inChain ? { borderLeftColor: '#3479f6' } : { borderLeftColor: trackColor(s.track) }}
            >
              <div className="flex items-center justify-between gap-2">
                <span className="font-medium leading-tight">{name(code)}</span>
                <span className="shrink-0 font-mono text-[10px] text-slate-400">
                  {s.code}
                </span>
              </div>
              {inChain && (
                <span className="text-[10px] font-medium text-brand-500">
                  ruta crítica
                </span>
              )}
            </li>
          );
        })}
        {codes.length === 0 && (
          <li className="py-2 text-center text-xs text-slate-400">
            (cuatri vacío)
          </li>
        )}
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

  // Materias pendientes no ubicadas todavía.
  const placed = new Set(manualTerms.flatMap((t) => t.subjects));
  const pool = [...d.pending].filter((c) => !placed.has(c));

  const diag = useMemo(
    () => validateManualPlan(graph, d.done, manualTerms, settings, offer),
    [d.done, manualTerms, settings, offer],
  );

  function seedFromAuto() {
    const terms = d.schedule.terms.map((t) => ({
      id: crypto.randomUUID(),
      subjects: [...t.subjects],
    }));
    setManualTerms(terms);
  }

  const dragCode = (e: React.DragEvent) => e.dataTransfer.getData('text/plain');

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <Badge className="bg-brand-500/15 text-brand-600 ring-brand-500/30 dark:text-brand-300">
            Manual: {diag.makespan} cuatris · {formatGraduation(diag.graduation)}
          </Badge>
          <Badge className="bg-slate-500/15 text-slate-600 ring-slate-500/30 dark:text-slate-300">
            Óptimo automático: {d.schedule.makespan} cuatris
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
            onClick={addManualTerm}
            className="rounded-lg border border-slate-300 px-3 py-1.5 text-sm font-medium dark:border-slate-700"
          >
            + Agregar cuatri
          </button>
        </div>
      </div>

      <div className="grid gap-4 lg:grid-cols-[260px_1fr]">
        {/* Pool de materias sin ubicar */}
        <div
          className="rounded-xl border border-dashed border-slate-300 bg-slate-50 p-3 dark:border-slate-700 dark:bg-slate-900/50"
          onDragOver={(e) => e.preventDefault()}
          onDrop={(e) => {
            e.preventDefault();
            moveToManualTerm(dragCode(e), null);
          }}
        >
          <h4 className="mb-2 text-sm font-semibold">
            Sin ubicar ({pool.length})
          </h4>
          <div className="space-y-1.5">
            {pool.map((code) => (
              <DraggableSubject key={code} code={code} termOptions={manualTerms} />
            ))}
            {pool.length === 0 && (
              <p className="py-4 text-center text-xs text-slate-400">
                Todas ubicadas 🎉
              </p>
            )}
          </div>
        </div>

        {/* Columnas de cuatrimestres */}
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
          {diag.terms.map((t) => (
            <div
              key={t.id}
              className="rounded-xl border border-slate-200 bg-white p-3 dark:border-slate-800 dark:bg-slate-900"
              onDragOver={(e) => e.preventDefault()}
              onDrop={(e) => {
                e.preventDefault();
                moveToManualTerm(dragCode(e), t.id);
              }}
            >
              <div className="mb-2 flex items-center justify-between">
                <h4 className="text-sm font-semibold">
                  {termLabel(t.term, t.year)}
                </h4>
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
                    t.overCapacityNight
                      ? 'bg-rose-500/15 text-rose-500'
                      : 'bg-slate-500/10 text-slate-500'
                  }`}
                >
                  noche {t.nightCount}/{settings.maxNightSlots}
                </span>
                {t.nonNightCount > 0 && (
                  <span
                    className={`rounded px-1.5 py-0.5 ${
                      t.overCapacityNonNight
                        ? 'bg-rose-500/15 text-rose-500'
                        : 'bg-slate-500/10 text-slate-500'
                    }`}
                  >
                    día {t.nonNightCount}/{settings.maxNonNightSlots}
                  </span>
                )}
                {t.conflictCount > 0 && (
                  <span className="rounded bg-rose-500/15 px-1.5 py-0.5 text-rose-500">
                    {t.conflictCount} choque{t.conflictCount > 1 ? 's' : ''}
                  </span>
                )}
                <span className="rounded bg-slate-500/10 px-1.5 py-0.5 text-slate-500">
                  {t.hours} hs
                </span>
              </div>
              <div className="min-h-[40px] space-y-1.5">
                {t.subjects.map((sd) => (
                  <div
                    key={sd.code}
                    draggable
                    onDragStart={(e) =>
                      e.dataTransfer.setData('text/plain', sd.code)
                    }
                    className={`cursor-grab rounded-lg border px-2.5 py-1.5 text-sm active:cursor-grabbing ${
                      sd.ok
                        ? 'border-slate-200 bg-slate-50 dark:border-slate-700 dark:bg-slate-800/50'
                        : 'border-rose-400 bg-rose-500/5'
                    }`}
                  >
                    <div className="flex items-center justify-between gap-1">
                      <span className="font-medium leading-tight">
                        {name(sd.code)}
                      </span>
                      <span className="font-mono text-[10px] text-slate-400">
                        {sd.code}
                      </span>
                    </div>
                    {sd.missingPrereqs.length > 0 && (
                      <div className="text-[10px] text-rose-500">
                        faltan correlativas:{' '}
                        {sd.missingPrereqs.map((c) => name(c)).join(', ')}
                      </div>
                    )}
                    {sd.calendarError && (
                      <div className="text-[10px] text-rose-500">
                        {sd.calendarError}
                      </div>
                    )}
                    {sd.hasConflict && (
                      <div className="text-[10px] text-rose-500">
                        choque de horario
                      </div>
                    )}
                  </div>
                ))}
                {t.subjects.length === 0 && (
                  <p className="py-2 text-center text-[11px] text-slate-400">
                    Arrastrá materias acá
                  </p>
                )}
              </div>
            </div>
          ))}
          {diag.terms.length === 0 && (
            <div className="col-span-full rounded-xl border border-dashed border-slate-300 p-8 text-center text-sm text-slate-500 dark:border-slate-700">
              Empezá con “Sembrar desde automático” o “+ Agregar cuatri” y
              arrastrá materias.
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

/** Materia arrastrable con fallback accesible (select para mover). */
function DraggableSubject({
  code,
  termOptions,
}: {
  code: string;
  termOptions: { id: string; subjects: string[] }[];
}) {
  const name = useSubjectName();
  const moveToManualTerm = useStore((s) => s.moveToManualTerm);
  const s = getSubject(code)!;
  return (
    <div
      draggable
      onDragStart={(e) => e.dataTransfer.setData('text/plain', code)}
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
