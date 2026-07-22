import { useStore } from '@/store/useStore';
import { ALL_SLOTS, NIGHT_SLOTS } from '@/domain/types';
import { DAY_SHORT } from '@/domain/conflicts';

const TURNOS: { key: 'm' | 't' | 'n'; label: string }[] = [
  { key: 'm', label: 'Mañana' },
  { key: 't', label: 'Tarde' },
  { key: 'n', label: 'Noche' },
];

/**
 * Grilla de disponibilidad día × turno. Solo se aplica al cuatri inmediato,
 * cuando hay una oferta cargada (es el único con días/horarios conocidos).
 */
export function AvailabilityGrid() {
  const restrict = useStore((s) => s.user.settings.restrictAvailability);
  const slots = useStore((s) => s.user.settings.availableSlots);
  const update = useStore((s) => s.updateSettings);
  const offer = useStore((s) => s.offer);

  const set = new Set(slots);
  const toggle = (day: number, turno: string) => {
    const key = `${day}-${turno}`;
    const next = new Set(set);
    if (next.has(key)) next.delete(key);
    else next.add(key);
    update({ availableSlots: [...next] });
  };

  return (
    <div className="rounded-xl border border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-slate-900">
      <label className="flex items-center gap-2 text-sm font-medium">
        <input
          type="checkbox"
          checked={restrict}
          onChange={(e) => update({ restrictAvailability: e.target.checked })}
          className="h-4 w-4 rounded border-slate-300"
        />
        Filtrar por mi disponibilidad horaria
      </label>
      <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
        Marcá los días/turnos en los que podés cursar. Se usa en el{' '}
        <strong>próximo cuatrimestre</strong> (con la oferta cargada): así el
        simulador no te manda una materia a un horario que no podés.
        {!offer && restrict && (
          <span className="text-amber-600 dark:text-amber-400">
            {' '}Cargá la oferta en la solapa Oferta para que tenga efecto.
          </span>
        )}
      </p>

      {restrict && (
        <>
          <div className="mt-3 flex gap-2 text-xs">
            <button
              onClick={() => update({ availableSlots: [...NIGHT_SLOTS] })}
              className="rounded-md border border-slate-300 px-2 py-1 dark:border-slate-700"
            >
              Solo noche
            </button>
            <button
              onClick={() => update({ availableSlots: [...ALL_SLOTS] })}
              className="rounded-md border border-slate-300 px-2 py-1 dark:border-slate-700"
            >
              Todo
            </button>
            <button
              onClick={() => update({ availableSlots: [] })}
              className="rounded-md border border-slate-300 px-2 py-1 dark:border-slate-700"
            >
              Nada
            </button>
          </div>

          <div className="mt-3 overflow-x-auto">
            <table className="text-sm">
              <thead>
                <tr>
                  <th />
                  {TURNOS.map((t) => (
                    <th key={t.key} className="px-3 py-1 text-xs font-medium text-slate-500">
                      {t.label}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {[0, 1, 2, 3, 4, 5].map((day) => (
                  <tr key={day}>
                    <td className="pr-3 text-xs font-medium text-slate-500">
                      {DAY_SHORT[day]}
                    </td>
                    {TURNOS.map((t) => {
                      const on = set.has(`${day}-${t.key}`);
                      return (
                        <td key={t.key} className="px-3 py-0.5 text-center">
                          <button
                            onClick={() => toggle(day, t.key)}
                            aria-label={`${DAY_SHORT[day]} ${t.label}`}
                            className={`h-6 w-10 rounded-md border text-xs transition ${
                              on
                                ? 'border-brand-600 bg-brand-600 text-white'
                                : 'border-slate-300 text-slate-400 dark:border-slate-700'
                            }`}
                          >
                            {on ? '✓' : ''}
                          </button>
                        </td>
                      );
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </div>
  );
}
