import { useStore } from '@/store/useStore';
import { TALLER_CODE } from '@/domain/types';
import { getSubject } from '@/data/plan';

/** Controles de configuración del simulador (compartidos). */
export function SettingsBar() {
  const s = useStore((x) => x.user.settings);
  const update = useStore((x) => x.updateSettings);
  const taller = getSubject(TALLER_CODE);

  const input =
    'w-20 rounded-lg border border-slate-300 bg-transparent px-2 py-1 text-sm dark:border-slate-700 dark:bg-slate-900';

  return (
    <div className="flex flex-wrap items-end gap-4 rounded-xl border border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-slate-900">
      <Field label="Materias/cuatri (mín)">
        <input
          type="number"
          min={1}
          max={12}
          value={s.minPerTerm}
          onChange={(e) => update({ minPerTerm: Math.max(1, +e.target.value || 1) })}
          className={input}
        />
      </Field>
      <Field label="Materias/cuatri (máx)">
        <input
          type="number"
          min={1}
          max={12}
          value={s.maxPerTerm}
          onChange={(e) => update({ maxPerTerm: Math.max(1, +e.target.value || 1) })}
          className={input}
        />
      </Field>
      <Field label="Año inicio">
        <input
          type="number"
          value={s.startYear}
          onChange={(e) => update({ startYear: +e.target.value || s.startYear })}
          className={input}
        />
      </Field>
      <Field label="Cuatri inicio">
        <select
          value={s.startTerm}
          onChange={(e) => update({ startTerm: +e.target.value === 2 ? 2 : 1 })}
          className={`${input} w-24`}
        >
          <option value={1}>1° cuatri</option>
          <option value={2}>2° cuatri</option>
        </select>
      </Field>
      <Field label="Trámite título (meses)">
        <input
          type="number"
          min={0}
          value={s.degreeProcessingMonths}
          onChange={(e) => update({ degreeProcessingMonths: Math.max(0, +e.target.value || 0) })}
          className={input}
        />
      </Field>

      <label className="flex items-center gap-2 text-sm">
        <input
          type="checkbox"
          checked={s.includeTaller}
          onChange={(e) => update({ includeTaller: e.target.checked })}
          className="h-4 w-4 rounded border-slate-300"
        />
        Incluir {taller?.name ?? 'Taller de Integración'} (optativa)
      </label>

      <label className="flex items-center gap-2 text-sm text-slate-500 dark:text-slate-400">
        <input
          type="checkbox"
          checked={s.limitDifficult}
          onChange={(e) => update({ limitDifficult: e.target.checked })}
          className="h-4 w-4 rounded border-slate-300"
        />
        Limitar difíciles/cuatri
        {s.limitDifficult && (
          <input
            type="number"
            min={1}
            max={6}
            value={s.maxDifficultPerTerm}
            onChange={(e) => update({ maxDifficultPerTerm: Math.max(1, +e.target.value || 1) })}
            className="ml-1 w-14 rounded-lg border border-slate-300 bg-transparent px-2 py-1 dark:border-slate-700 dark:bg-slate-900"
          />
        )}
      </label>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="flex flex-col gap-1">
      <span className="text-xs text-slate-500 dark:text-slate-400">{label}</span>
      {children}
    </label>
  );
}
