import { useState } from 'react';
import { useDerived, useSchedule } from '@/lib/useDerived';
import { useStore } from '@/store/useStore';
import { DAY_SHORT } from '@/domain/conflicts';
import { Intocables } from '@/components/Intocables';
import { HorarioSemanal } from '@/components/HorarioSemanal';
import { termToClipboardText, copyToClipboard, type TermItem } from '@/lib/exportTerm';
import { getSubject } from '@/data/plan';
import { graph } from '@/domain/planGraph';
import { generateAlerts } from '@/domain/alerts';
import { INTERMEDIATE_TITLE } from '@/domain/degrees';
import { TALLER_CODE } from '@/domain/types';
import { Badge } from '@/components/Badge';
import { useSubjectName } from '@/lib/subjectName';
import {
  formatGraduation,
  gradeClass,
  termLabel,
} from '@/lib/ui';

export function Tablero() {
  const d = useDerived();
  const sched = useSchedule();
  const updateSettings = useStore((s) => s.updateSettings);
  const name = useSubjectName();

  const offer = useStore((s) => s.offer);
  const pinned = useStore((s) => s.pinnedTerm);
  const includeTaller = useStore((s) => s.user.settings.includeTaller);
  const grad = sched.graduation;
  const restantes = sched.makespan;
  const chain = sched.criticalChain;
  // Si marcaste materias como "cursando", el primer cuatri del plan es ese
  // mismo: no es una sugerencia, es lo que ya estás haciendo.
  const cursandoAhora =
    (sched.terms[0]?.subjects.length ?? 0) > 0 &&
    sched.terms[0].subjects.every((c) => d.enCurso.has(c));
  // Si fijaste un cuatrimestre, ese manda: es tu decisión, no una sugerencia.
  // Mostrar los dos (con dos grillas semanales) sería puro ruido.
  const hayFijado = (pinned?.items.length ?? 0) > 0;
  const alerts = generateAlerts(
    graph,
    d.statuses,
    d.pending,
    sched,
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
              ? `${yearsShort(sched.years)} · egreso ${formatGraduation(grad)}`
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

      {/* Tu próximo cuatri (el que fijaste desde el armado manual) */}
      {pinned && pinned.items.length > 0 && <PinnedTermCard />}

      {/* Próximo cuatri: el que estás cursando, o el que sugiere el simulador.
          Se muestra SIEMPRE que haya algo por planificar — también si recién
          arrancás y no cargaste ninguna aprobada: ahí es justamente lo más útil
          que te puede decir la app. Si fijaste uno a mano, ese manda y este no
          se repite. */}
      {sched.terms.length > 0 && (
        <section>
          {!hayFijado && (
            <>
              <h3 className="mb-1 text-lg font-semibold">
                {cursandoAhora ? 'Lo que estás cursando' : 'Próximo cuatrimestre sugerido'}{' '}
                <span className="text-sm font-normal text-slate-500 dark:text-slate-400">
                  ({termLabel(sched.terms[0].term, sched.terms[0].year)})
                </span>
              </h3>
              <p className="mb-3 text-xs text-slate-500 dark:text-slate-400">
                {cursandoAhora
                  ? 'Lo marcaste como “en curso”, así que el plan arranca acá.'
                  : '¿Ya te inscribiste? Marcálas como “Cursando” en la solapa Materias y el plan va a arrancar por ellas.'}
              </p>
              <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
                {sched.terms[0].subjects.map((code) => {
                  const s = getSubject(code);
                  const inChain = chain.includes(code);
                  const comm = sched.commissionByCode.get(code);
                  const m = comm?.meetings?.[0];
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
                      <div className="mt-1 inline-block rounded bg-brand-500/10 px-1.5 py-0.5 text-xs font-semibold text-brand-700 dark:text-brand-300">
                        {m
                          ? `🕒 ${DAY_SHORT[m.day]} ${m.start}–${m.end}`
                          : 'sin horario fijo'}
                        {comm?.label ? ` · ${comm.label}` : ''}
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
              <div className="mt-4 rounded-xl border border-slate-200 bg-white p-3 dark:border-slate-800 dark:bg-slate-900">
                <h4 className="mb-2 text-sm font-medium text-slate-500 dark:text-slate-400">
                  Cómo te queda la semana
                </h4>
                <HorarioSemanal
                  materias={sched.terms[0].subjects.map((code) => {
                    const commission = sched.commissionByCode.get(code);
                    return { code, titulo: commission?.label, commission };
                  })}
                />
              </div>
            </>
          )}
          {/* Si fijaste un cuatri, el riesgo se calcula sobre ESAS materias:
              son las que vas a cursar. */}
          <Intocables
            materias={hayFijado ? pinned!.items.map((it) => it.code) : undefined}
          />
          <p className="mt-2 text-xs text-slate-500 dark:text-slate-400">
            Detalle completo del cronograma en la solapa{' '}
            <strong>Simulador</strong>.
          </p>
        </section>
      )}
    </div>
  );
}

/**
 * El cuatrimestre que fijaste desde el armado manual. Es lo que vas a inscribir,
 * así que se muestra con día, horario y los códigos listos para copiar.
 */
function PinnedTermCard() {
  const pinned = useStore((s) => s.pinnedTerm)!;
  const setPinnedTerm = useStore((s) => s.setPinnedTerm);
  const name = useSubjectName();
  const [copied, setCopied] = useState<'ok' | 'err' | null>(null);

  const items: TermItem[] = pinned.items.map((it) => ({
    code: it.code,
    name: it.label ?? name(it.code),
    commission:
      it.day != null && it.start && it.end
        ? {
            id: it.commId ?? '',
            modality: 'presencial',
            meetings: [{ day: it.day, start: it.start, end: it.end }],
            label: it.label,
            subjectCode: it.subjectCode,
          }
        : undefined,
    day: it.day,
  }));

  async function copy() {
    const ok = await copyToClipboard(termToClipboardText(items, pinned.label));
    setCopied(ok ? 'ok' : 'err');
    setTimeout(() => setCopied(null), 1800);
  }

  const sorted = [...pinned.items].sort(
    (a, b) => (a.day ?? 9) - (b.day ?? 9) || (a.start ?? '').localeCompare(b.start ?? ''),
  );

  return (
    <section className="rounded-xl border border-brand-500/40 bg-brand-500/5 p-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h3 className="text-lg font-semibold">
            📌 Tu próximo cuatrimestre{' '}
            <span className="text-sm font-normal text-slate-500 dark:text-slate-400">
              ({pinned.label})
            </span>
          </h3>
          <p className="text-xs text-slate-500 dark:text-slate-400">
            El que fijaste desde el <strong>Simulador</strong>. Copialo para tenerlo
            a mano en la inscripción.
          </p>
        </div>
        <div className="flex gap-2">
          <button
            onClick={copy}
            className="rounded-lg bg-brand-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-brand-700"
          >
            {copied === 'ok' ? '✅ Copiado' : copied === 'err' ? '⚠️ No se pudo' : '📋 Copiar'}
          </button>
          <button
            onClick={() => setPinnedTerm(null)}
            className="rounded-lg border border-slate-300 px-3 py-1.5 text-sm font-medium text-slate-600 hover:bg-slate-100 dark:border-slate-700 dark:text-slate-300 dark:hover:bg-slate-800"
          >
            Quitar
          </button>
        </div>
      </div>

      <div className="mt-3 rounded-lg border border-slate-200 bg-white p-3 dark:border-slate-800 dark:bg-slate-900">
        <HorarioSemanal materias={items} />
      </div>

      <div className="mt-3 grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
        {sorted.map((it) => (
          <div
            key={it.code}
            className="rounded-lg border border-slate-200 bg-white p-3 dark:border-slate-800 dark:bg-slate-900"
          >
            <div className="font-medium">{it.label ?? name(it.code)}</div>
            <div className="mt-1 text-xs text-slate-500 dark:text-slate-400">
              {it.day != null && it.start
                ? `${DAY_SHORT[it.day]} ${it.start}${it.end ? `–${it.end}` : ''}`
                : 'sin día fijo'}
            </div>
            <div className="mt-1 font-mono text-[11px] text-slate-400">
              mat {(it.subjectCode ?? it.code).replace(/^0+/, '')}
              {it.commId && /^\d+$/.test(it.commId) ? ` · com ${it.commId}` : ''}
            </div>
          </div>
        ))}
      </div>
    </section>
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
