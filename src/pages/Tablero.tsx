import { useDerived } from '@/lib/useDerived';
import { useStore } from '@/store/useStore';
import { getSubject } from '@/data/plan';
import { graph } from '@/domain/planGraph';
import { generateAlerts } from '@/domain/alerts';
import { INTERMEDIATE_TITLE } from '@/domain/degrees';
import { TALLER_CODE } from '@/domain/types';
import { Badge } from '@/components/Badge';
import { useSubjectName } from '@/lib/subjectName';
import {
  STATUS_CHIP,
  formatGraduation,
  gradeClass,
  termLabel,
} from '@/lib/ui';

export function Tablero() {
  const d = useDerived();
  const user = useStore((s) => s.user);
  const updateSettings = useStore((s) => s.updateSettings);
  const name = useSubjectName();

  const offer = useStore((s) => s.offer);
  const includeTaller = useStore((s) => s.user.settings.includeTaller);
  const grad = d.schedule.graduation;
  const restantes = d.schedule.makespan;
  const chain = d.schedule.criticalChain;
  const alerts = generateAlerts(
    graph,
    d.statuses,
    d.pending,
    d.schedule,
    name,
    offer,
    d.loaded,
  );

  function yearsShort(years: number): string {
    if (years <= 0) return '';
    return years % 1 === 0 ? `${years} años` : `${years.toFixed(1)} años`;
  }

  return (
    <div className="space-y-8">
      {/* Fila de KPIs */}
      <section className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <Kpi
          label="Avance"
          value={`${d.progress.percent.toFixed(0)}%`}
          hint={`${d.progress.approvedCount} de ${d.progress.total} materias`}
        >
          <div className="mt-3 h-2 w-full overflow-hidden rounded-full bg-slate-200 dark:bg-slate-800">
            <div
              className="h-full rounded-full bg-brand-500 transition-all"
              style={{ width: `${d.progress.percent}%` }}
            />
          </div>
        </Kpi>

        <Kpi
          label="Horas cursadas"
          value={d.progress.hoursDone.toLocaleString('es-AR')}
          hint={`de ${d.progress.hoursTotal.toLocaleString('es-AR')} hs`}
        />

        <Kpi
          label="Te faltan"
          value={String(d.progress.remainingCount)}
          hint="materias para recibirte"
        />

        <Kpi
          label="Cuatris restantes"
          value={restantes > 0 ? String(restantes) : '—'}
          hint={
            restantes > 0
              ? `${yearsShort(d.schedule.years)} · egreso ${formatGraduation(grad)}`
              : '¡Ya terminaste! 🎓'
          }
          accent
        />
      </section>

      {/* Títulos: grado + intermedio, cada uno con materias faltantes y promedio */}
      <section className="grid gap-4 lg:grid-cols-2">
        <TitleCard
          label="Título de grado"
          name="Ingeniería en Informática"
          remaining={d.progress.remainingCount}
          approved={d.progress.approvedCount}
          total={d.progress.total}
          avg={d.promedio.grado}
          avgCount={d.promedio.count}
          requisito="Todas las materias del plan (63)."
        />
        <TitleCard
          label="Título intermedio"
          name={INTERMEDIATE_TITLE}
          remaining={d.intermediate.remaining}
          approved={d.intermediate.approved}
          total={d.intermediate.required}
          avg={d.promedio.intermedio}
          avgCount={d.promedio.intermedioCount}
          requisito="Todas las materias de 1° a 3° + Inglés I y II."
        />
      </section>

      {/* Taller de Integración (optativa) */}
      <section className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm dark:border-slate-800 dark:bg-slate-900">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h3 className="text-sm font-medium">
              {getSubject(TALLER_CODE)?.name}{' '}
              <span className="text-slate-500 dark:text-slate-400">(materia optativa)</span>
            </h3>
            <p className="text-xs text-slate-500 dark:text-slate-400">
              Elegí si se considera en el progreso, el simulador y el grafo, o se descarta de todo.
            </p>
          </div>
          <div className="flex gap-2">
            <button
              onClick={() => updateSettings({ includeTaller: true })}
              className={`rounded-lg px-3 py-1.5 text-sm font-medium ${
                includeTaller
                  ? 'bg-brand-600 text-white'
                  : 'border border-slate-300 text-slate-600 dark:border-slate-700 dark:text-slate-300'
              }`}
            >
              Considerarla
            </button>
            <button
              onClick={() => updateSettings({ includeTaller: false })}
              className={`rounded-lg px-3 py-1.5 text-sm font-medium ${
                !includeTaller
                  ? 'bg-brand-600 text-white'
                  : 'border border-slate-300 text-slate-600 dark:border-slate-700 dark:text-slate-300'
              }`}
            >
              Descartarla
            </button>
          </div>
        </div>
      </section>

      {/* Alertas inteligentes */}
      {alerts.length > 0 && (
        <section className="space-y-2">
          <h3 className="text-lg font-semibold">Alertas</h3>
          {alerts.map((a, i) => (
            <div
              key={i}
              className={`rounded-lg border p-3 text-sm ${
                a.level === 'warn'
                  ? 'border-amber-500/30 bg-amber-500/5'
                  : 'border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-900'
              }`}
            >
              <div className="flex items-start gap-2">
                <span aria-hidden>{a.level === 'warn' ? '⚠️' : '💡'}</span>
                <div>
                  <div className="font-medium">{a.title}</div>
                  <div className="text-slate-600 dark:text-slate-400">
                    {a.detail}
                  </div>
                </div>
              </div>
            </div>
          ))}
        </section>
      )}

      {/* En curso */}
      <section>
        <h3 className="mb-3 text-lg font-semibold">Cursando ahora</h3>
        {user.inProgress.length === 0 ? (
          <p className="text-sm text-slate-500 dark:text-slate-400">
            No tenés materias marcadas como “en curso”. Marcálas desde la
            solapa <strong>Materias</strong> para que el simulador las cuente
            como aprobadas al cierre.
          </p>
        ) : (
          <div className="flex flex-wrap gap-2">
            {user.inProgress.map((code) => (
              <Badge key={code} className={STATUS_CHIP.inProgress}>
                {name(code)}
              </Badge>
            ))}
          </div>
        )}
      </section>

      {/* Cadena crítica */}
      {d.loaded && chain.length > 0 && (
        <section className="rounded-xl border border-brand-500/30 bg-brand-500/5 p-5">
          <div className="flex items-center gap-2">
            <h3 className="text-lg font-semibold">Cadena crítica</h3>
            <Badge className="bg-brand-500/15 text-brand-600 ring-brand-500/30 dark:text-brand-300">
              {chain.length} cuatris
            </Badge>
          </div>
          <p className="mt-1 text-sm text-slate-600 dark:text-slate-400">
            Estas materias son las <strong>intocables</strong>: forman la
            secuencia de correlativas más larga que te queda. Si una se atrasa,
            se atrasa tu egreso. Priorizálas.
          </p>
          <ol className="mt-3 flex flex-wrap items-center gap-2">
            {chain.map((code, i) => (
              <li key={code} className="flex items-center gap-2">
                <span className="rounded-lg border border-brand-500/40 bg-white px-2.5 py-1 text-sm font-medium dark:bg-slate-900">
                  <span className="mr-1 text-xs text-slate-400">
                    {getSubject(code)?.code}
                  </span>
                  {name(code)}
                </span>
                {i < chain.length - 1 && (
                  <span className="text-brand-500">→</span>
                )}
              </li>
            ))}
          </ol>
        </section>
      )}

      {/* Próximo cuatri sugerido */}
      {d.loaded && d.schedule.terms.length > 0 && (
        <section>
          <h3 className="mb-3 text-lg font-semibold">
            Próximo cuatrimestre sugerido{' '}
            <span className="text-sm font-normal text-slate-500 dark:text-slate-400">
              ({termLabel(d.schedule.terms[0].term, d.schedule.terms[0].year)})
            </span>
          </h3>
          <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
            {d.schedule.terms[0].subjects.map((code) => {
              const s = getSubject(code);
              const inChain = chain.includes(code);
              return (
                <div
                  key={code}
                  className={`rounded-lg border p-3 ${
                    inChain
                      ? 'border-brand-500/50 bg-brand-500/5'
                      : 'border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-900'
                  }`}
                >
                  <div className="flex items-center justify-between gap-2">
                    <span className="font-medium">{name(code)}</span>
                    <span className="font-mono text-xs text-slate-400">
                      {s?.code}
                    </span>
                  </div>
                  <div className="mt-1 text-xs text-slate-500 dark:text-slate-400">
                    {s?.track} · {s?.year}° año
                    {inChain && (
                      <span className="ml-1 font-medium text-brand-500">
                        · ruta crítica
                      </span>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
          <p className="mt-2 text-xs text-slate-500 dark:text-slate-400">
            Detalle completo del cronograma en la solapa{' '}
            <strong>Simulador</strong>.
          </p>
        </section>
      )}
    </div>
  );
}

function TitleCard({
  label,
  name,
  remaining,
  approved,
  total,
  avg,
  avgCount,
  requisito,
}: {
  label: string;
  name: string;
  remaining: number;
  approved: number;
  total: number;
  avg: number;
  avgCount: number;
  requisito: string;
}) {
  const done = remaining === 0;
  return (
    <div className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm dark:border-slate-800 dark:bg-slate-900">
      <h3 className="text-sm font-medium text-slate-500 dark:text-slate-400">{label}</h3>
      <p className="text-base font-semibold">{name}</p>

      <div className="mt-3 flex items-end justify-between gap-4">
        <div>
          {done ? (
            <p className="text-sm font-medium text-emerald-600 dark:text-emerald-400">
              ¡Ya cumplís los requisitos! 🎓
            </p>
          ) : (
            <div className="flex items-baseline gap-2">
              <span className="text-2xl font-bold">{remaining}</span>
              <span className="text-sm text-slate-500 dark:text-slate-400">
                materias ({approved}/{total})
              </span>
            </div>
          )}
        </div>
        <div className="text-right">
          <div className={`text-2xl font-bold ${gradeClass(avg)}`}>
            {avgCount ? avg.toFixed(2) : '—'}
          </div>
          <div className="text-xs text-slate-500 dark:text-slate-400">promedio</div>
        </div>
      </div>

      <div className="mt-2 h-2 w-full overflow-hidden rounded-full bg-slate-200 dark:bg-slate-800">
        <div
          className="h-full rounded-full bg-emerald-500"
          style={{ width: `${total ? (approved / total) * 100 : 0}%` }}
        />
      </div>
      <p className="mt-2 text-xs text-slate-400">{requisito}</p>
    </div>
  );
}

function Kpi({
  label,
  value,
  hint,
  accent,
  children,
}: {
  label: string;
  value: string;
  hint: string;
  accent?: boolean;
  children?: React.ReactNode;
}) {
  return (
    <div
      className={`rounded-xl border p-4 shadow-sm ${
        accent
          ? 'border-brand-500/40 bg-brand-500/5'
          : 'border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-900'
      }`}
    >
      <div className="text-sm font-medium text-slate-500 dark:text-slate-400">
        {label}
      </div>
      <div className="mt-1 text-3xl font-bold tracking-tight">{value}</div>
      <div className="text-xs text-slate-500 dark:text-slate-400">{hint}</div>
      {children}
    </div>
  );
}
