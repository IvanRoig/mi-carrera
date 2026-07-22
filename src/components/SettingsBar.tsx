import { useStore } from '@/store/useStore';

/** Controles de configuración del simulador (compartidos). */
export function SettingsBar() {
  const s = useStore((x) => x.user.settings);
  const update = useStore((x) => x.updateSettings);

  const input =
    'w-20 rounded-lg border border-slate-300 bg-transparent px-2 py-1 text-sm dark:border-slate-700 dark:bg-slate-900';

  return (
    <div className="flex flex-wrap items-end gap-4 rounded-xl border border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-slate-900">
      <Field label="Materias/noche">
        <input
          type="number"
          min={1}
          max={10}
          value={s.maxNightSlots}
          onChange={(e) => update({ maxNightSlots: Math.max(1, +e.target.value || 1) })}
          className={input}
        />
      </Field>
      <Field label="Fuera de noche">
        <input
          type="number"
          min={0}
          max={5}
          value={s.maxNonNightSlots}
          onChange={(e) => update({ maxNonNightSlots: Math.max(0, +e.target.value || 0) })}
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
