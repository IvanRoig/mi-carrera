import { useMemo, useState } from 'react';
import { useDerived } from '@/lib/useDerived';
import { useStore } from '@/store/useStore';
import { graph } from '@/domain/planGraph';
import { schedule } from '@/domain/scheduler';
import { formatGraduation } from '@/lib/ui';
import type { UserSettings } from '@/domain/types';

type Row = {
  id: string;
  name: string;
  makespan: number;
  years: number;
  graduation: { year: number; month: number };
  avgLoad: number;
  riesgo: number;
  isCurrent?: boolean;
  builtin?: boolean;
};

export function Comparador() {
  const d = useDerived();
  const settings = useStore((s) => s.user.settings);
  const offer = useStore((s) => s.offer);
  const difficultArr = useStore((s) => s.user.difficult);
  const scenarios = useStore((s) => s.scenarios);
  const addScenario = useStore((s) => s.addScenario);
  const removeScenario = useStore((s) => s.removeScenario);
  const [name, setName] = useState('');
  const [maxPerTerm, setMaxPerTerm] = useState(settings.maxPerTerm);

  const rows: Row[] = useMemo(() => {
    const difficult = new Set(difficultArr);
    function compute(
      id: string,
      label: string,
      over: Partial<UserSettings>,
      opts: { isCurrent?: boolean; builtin?: boolean; sicario?: boolean } = {},
    ): Row {
      const s = schedule({
        graph,
        pending: d.pending,
        done: d.done,
        settings: { ...settings, ...over },
        offer,
        difficult,
        sicario: opts.sicario,
      });
      return {
        id,
        name: label,
        makespan: s.makespan,
        years: s.years,
        graduation: s.graduation,
        avgLoad: s.makespan ? d.pending.size / s.makespan : 0,
        riesgo: s.criticalChain.length,
        isCurrent: opts.isCurrent,
        builtin: opts.builtin,
      };
    }

    return [
      compute('current', `Actual (hasta ${settings.maxPerTerm}/cuatri)`, {}, { isCurrent: true }),
      compute('sicario', '🔪 Sicario (máximo posible)', {}, { builtin: true, sicario: true }),
      ...scenarios.map((sc) =>
        compute(sc.id, sc.name, { maxPerTerm: sc.maxPerTerm }, { sicario: sc.sicario }),
      ),
    ];
  }, [d.pending, d.done, settings, scenarios, offer, difficultArr]);

  const best = rows.reduce((a, b) => (b.makespan < a.makespan ? b : a), rows[0]);

  return (
    <div className="space-y-6">
      <p className="text-sm text-slate-600 dark:text-slate-400">
        Compará estrategias (p.ej. “hasta 5” vs “hasta 6 por cuatri”) para ver
        cómo cambian la fecha de egreso, la carga y el riesgo. El{' '}
        <strong>riesgo</strong> es la cantidad de materias en la ruta crítica:
        cuantas más, menos margen si se cae una comisión.
      </p>

      <div className="flex flex-wrap items-end gap-3 rounded-xl border border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-slate-900">
        <label className="flex flex-col gap-1">
          <span className="text-xs text-slate-500 dark:text-slate-400">Nombre</span>
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Ej: a full"
            className="w-52 rounded-lg border border-slate-300 bg-transparent px-3 py-1.5 text-sm dark:border-slate-700"
          />
        </label>
        <label className="flex flex-col gap-1">
          <span className="text-xs text-slate-500 dark:text-slate-400">Máx materias/cuatri</span>
          <input
            type="number"
            min={1}
            max={12}
            value={maxPerTerm}
            onChange={(e) => setMaxPerTerm(Math.max(1, +e.target.value || 1))}
            className="w-28 rounded-lg border border-slate-300 bg-transparent px-3 py-1.5 text-sm dark:border-slate-700 dark:bg-slate-900"
          />
        </label>
        <button
          onClick={() => {
            addScenario({ name: name.trim() || `hasta ${maxPerTerm}/cuatri`, maxPerTerm });
            setName('');
          }}
          className="rounded-lg bg-brand-600 px-4 py-2 text-sm font-medium text-white hover:bg-brand-700"
        >
          + Agregar escenario
        </button>
      </div>

      <div className="overflow-x-auto rounded-xl border border-slate-200 dark:border-slate-800">
        <table className="w-full text-sm">
          <thead className="bg-slate-50 text-left text-xs uppercase text-slate-500 dark:bg-slate-900 dark:text-slate-400">
            <tr>
              <th className="px-4 py-2 font-medium">Escenario</th>
              <th className="px-4 py-2 font-medium">Cuatris</th>
              <th className="px-4 py-2 font-medium">Años</th>
              <th className="px-4 py-2 font-medium">Egreso</th>
              <th className="px-4 py-2 font-medium">Carga prom.</th>
              <th className="px-4 py-2 font-medium">Riesgo</th>
              <th className="px-4 py-2"></th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr
                key={r.id}
                className={`border-t border-slate-100 dark:border-slate-800 ${
                  r.id === best.id ? 'bg-emerald-500/5' : ''
                }`}
              >
                <td className="px-4 py-2 font-medium">
                  {r.name}
                  {r.isCurrent && (
                    <span className="ml-2 rounded bg-brand-500/15 px-1.5 py-0.5 text-[10px] text-brand-500">
                      actual
                    </span>
                  )}
                  {r.id === best.id && (
                    <span className="ml-2 rounded bg-emerald-500/15 px-1.5 py-0.5 text-[10px] text-emerald-500">
                      más rápido
                    </span>
                  )}
                </td>
                <td className="px-4 py-2 font-semibold">{r.makespan}</td>
                <td className="px-4 py-2">{r.years % 1 === 0 ? r.years : r.years.toFixed(1)}</td>
                <td className="px-4 py-2">{formatGraduation(r.graduation)}</td>
                <td className="px-4 py-2">{r.avgLoad.toFixed(1)} / cuatri</td>
                <td className="px-4 py-2">{r.riesgo}</td>
                <td className="px-4 py-2 text-right">
                  {!r.isCurrent && !r.builtin && (
                    <button
                      onClick={() => removeScenario(r.id)}
                      className="text-xs text-slate-400 hover:text-rose-500"
                    >
                      eliminar
                    </button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
