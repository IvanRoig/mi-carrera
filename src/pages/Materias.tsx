import { useMemo, useRef, useState } from 'react';
import { subjects, tracks, years, getSubject } from '@/data/plan';
import { useStore } from '@/store/useStore';
import { useDerived } from '@/lib/useDerived';
import { useSubjectName } from '@/lib/subjectName';
import { Badge } from '@/components/Badge';
import { STATUS_CHIP, STATUS_LABEL, gradeClass } from '@/lib/ui';
import type { SubjectStatus } from '@/domain/types';
import { parseTabular } from '@/lib/parseTabular';
import { parseHistoriaPdf } from '@/lib/parsePdf';

const STATUS_FILTERS: { id: SubjectStatus | 'all'; label: string }[] = [
  { id: 'all', label: 'Todas' },
  { id: 'approved', label: 'Aprobadas' },
  { id: 'regularized', label: 'Regularizadas' },
  { id: 'inProgress', label: 'Cursando' },
  { id: 'eligible', label: 'Podés cursar' },
  { id: 'blocked', label: 'Bloqueadas' },
];

export function Materias() {
  const d = useDerived();
  const name = useSubjectName();
  const [q, setQ] = useState('');
  const [year, setYear] = useState<number | 'all'>('all');
  const [track, setTrack] = useState<string | 'all'>('all');
  const [status, setStatus] = useState<SubjectStatus | 'all'>('all');
  const [showImport, setShowImport] = useState(false);
  const importApproved = useStore((s) => s.importApproved);
  const toggleRegularized = useStore((s) => s.toggleRegularized);
  const pdfRef = useRef<HTMLInputElement>(null);
  const [pdfMsg, setPdfMsg] = useState('');
  const [pdfBusy, setPdfBusy] = useState(false);

  async function handlePdf(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setPdfBusy(true);
    setPdfMsg('Leyendo el PDF…');
    try {
      const res = await parseHistoriaPdf(file);
      importApproved(res.approved);
      for (const c of res.regularized) toggleRegularized(c);
      setPdfMsg(
        `Detecté ${res.approved.length} aprobadas` +
          (res.regularized.length ? ` y ${res.regularized.length} regularizadas` : '') +
          (res.ignored.length ? ` · ${res.ignored.length} filas ignoradas (plan viejo)` : '') +
          '.',
      );
    } catch (err) {
      console.error(err);
      setPdfMsg('No pude leer ese PDF. ¿Es la historia académica del campus?');
    } finally {
      setPdfBusy(false);
      if (pdfRef.current) pdfRef.current.value = '';
    }
  }

  const filtered = useMemo(() => {
    const nq = q.trim().toLowerCase();
    return subjects.filter((s) => {
      if (year !== 'all' && s.year !== year) return false;
      if (track !== 'all' && s.track !== track) return false;
      if (status !== 'all' && d.statuses.get(s.code) !== status) return false;
      if (nq) {
        const hay = `${s.code} ${s.name} ${name(s.code)}`.toLowerCase();
        if (!hay.includes(nq)) return false;
      }
      return true;
    });
  }, [q, year, track, status, d.statuses, name]);

  const counts = useMemo(() => {
    const c: Record<string, number> = {};
    for (const s of subjects) {
      const st = d.statuses.get(s.code)!;
      c[st] = (c[st] ?? 0) + 1;
    }
    return c;
  }, [d.statuses]);

  return (
    <div className="space-y-6">
      {/* Resumen por estado */}
      <div className="flex flex-wrap gap-2">
        {(['approved', 'regularized', 'inProgress', 'eligible', 'blocked'] as SubjectStatus[]).map(
          (st) => (
            <Badge key={st} className={STATUS_CHIP[st]}>
              {STATUS_LABEL[st]}: {counts[st] ?? 0}
            </Badge>
          ),
        )}
      </div>

      {/* Controles */}
      <div className="flex flex-wrap items-center gap-2">
        <input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Buscar por nombre o código…"
          className="min-w-52 flex-1 rounded-lg border border-slate-300 bg-transparent px-3 py-2 text-sm dark:border-slate-700"
        />
        <select
          value={year}
          onChange={(e) => setYear(e.target.value === 'all' ? 'all' : +e.target.value)}
          className="rounded-lg border border-slate-300 bg-transparent px-3 py-2 text-sm dark:border-slate-700 dark:bg-slate-900"
        >
          <option value="all">Todos los años</option>
          {years.map((y) => (
            <option key={y} value={y}>
              {y}° año
            </option>
          ))}
        </select>
        <select
          value={track}
          onChange={(e) => setTrack(e.target.value)}
          className="rounded-lg border border-slate-300 bg-transparent px-3 py-2 text-sm dark:border-slate-700 dark:bg-slate-900"
        >
          <option value="all">Todos los trayectos</option>
          {tracks.map((t) => (
            <option key={t} value={t}>
              {t}
            </option>
          ))}
        </select>
        <input ref={pdfRef} type="file" accept="application/pdf,.pdf" className="hidden" onChange={handlePdf} />
        <button
          onClick={() => pdfRef.current?.click()}
          disabled={pdfBusy}
          className="rounded-lg bg-emerald-600 px-3 py-2 text-sm font-medium text-white hover:bg-emerald-700 disabled:opacity-50"
        >
          {pdfBusy ? 'Leyendo…' : '📄 Subir historia (PDF)'}
        </button>
        <button
          onClick={() => setShowImport((v) => !v)}
          className="rounded-lg border border-slate-300 px-3 py-2 text-sm font-medium dark:border-slate-700"
        >
          Pegar texto
        </button>
      </div>
      {pdfMsg && (
        <p className="text-sm text-emerald-600 dark:text-emerald-400">{pdfMsg}</p>
      )}

      {/* Filtro por estado */}
      <div className="flex flex-wrap gap-1.5">
        {STATUS_FILTERS.map((f) => (
          <button
            key={f.id}
            onClick={() => setStatus(f.id)}
            className={`rounded-full px-3 py-1 text-xs font-medium transition ${
              status === f.id
                ? 'bg-slate-900 text-white dark:bg-white dark:text-slate-900'
                : 'bg-slate-100 text-slate-600 hover:bg-slate-200 dark:bg-slate-800 dark:text-slate-300 dark:hover:bg-slate-700'
            }`}
          >
            {f.label}
          </button>
        ))}
      </div>

      <p className="text-xs text-slate-500 dark:text-slate-400">
        <span className="font-medium text-amber-500">★</span> = materias que marcás
        como <strong>difíciles</strong> (opcional). Sirve si después querés limitar
        cuántas difíciles hacer por cuatrimestre en el Simulador.
      </p>

      {showImport && <ImportPanel onClose={() => setShowImport(false)} />}

      {/* Lista */}
      <div className="overflow-hidden rounded-xl border border-slate-200 dark:border-slate-800">
        <table className="w-full text-sm">
          <thead className="bg-slate-50 text-left text-xs uppercase text-slate-500 dark:bg-slate-900 dark:text-slate-400">
            <tr>
              <th className="px-3 py-2 font-medium">Materia</th>
              <th className="px-3 py-2 font-medium">Estado</th>
              <th className="px-3 py-2 text-right font-medium">Acciones</th>
            </tr>
          </thead>
          <tbody>
            {filtered.map((s) => (
              <SubjectRow key={s.code} code={s.code} />
            ))}
            {filtered.length === 0 && (
              <tr>
                <td colSpan={3} className="px-3 py-8 text-center text-slate-500">
                  No hay materias con esos filtros.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function SubjectRow({ code }: { code: string }) {
  const s = getSubject(code)!;
  const d = useDerived();
  const name = useSubjectName();
  const st = d.statuses.get(code)!;
  const user = useStore((x) => x.user);
  const setApproved = useStore((x) => x.setApproved);
  const setGrade = useStore((x) => x.setGrade);
  const toggleRegularized = useStore((x) => x.toggleRegularized);
  const toggleInProgress = useStore((x) => x.toggleInProgress);
  const toggleDifficult = useStore((x) => x.toggleDifficult);
  const clearStatus = useStore((x) => x.clearStatus);
  const renameElective = useStore((x) => x.renameElective);
  const offer = useStore((x) => x.offer);
  const electivePref = useStore((x) => x.electivePref);
  const setElectivePref = useStore((x) => x.setElectivePref);

  const grade = user.approved.find((a) => a.code === code)?.grade;
  const isDifficult = user.difficult.includes(code);

  const btn =
    'rounded-md px-2 py-1 text-xs font-medium border transition';
  const btnOn = 'bg-brand-600 text-white border-brand-600';
  const btnOff =
    'border-slate-300 text-slate-600 hover:bg-slate-100 dark:border-slate-700 dark:text-slate-300 dark:hover:bg-slate-800';

  return (
    <tr className="border-t border-slate-100 dark:border-slate-800">
      <td className="px-3 py-2">
        <div className="flex items-center gap-2">
          <span
            className="h-2 w-2 shrink-0 rounded-full"
            style={{ background: 'currentColor' }}
          />
          <div>
            <div className="font-medium">
              {name(code)}
              {s.annual && (
                <span className="ml-2 text-xs text-orange-500">anual</span>
              )}
            </div>
            <div className="text-xs text-slate-400">
              {s.code} · {s.year}° año · {s.track}
            </div>
            {s.isElective && (() => {
              // Opciones = las electivas reales ofrecidas (una por día) según la oferta.
              const opts = (offer?.offerings.find((o) => o.code === code)?.commissions ?? [])
                .map((c) => ({ day: c.meetings[0]?.day, label: c.label }))
                .filter((o): o is { day: number; label: string } => o.day != null && !!o.label);
              // Días ya elegidos por OTRAS electivas (para no repetir la misma).
              const takenByOthers = new Set(
                Object.entries(electivePref)
                  .filter(([k]) => k !== code)
                  .map(([, day]) => day),
              );
              const current = electivePref[code];
              return (
                <div className="mt-1">
                  <select
                    value={current ?? ''}
                    onChange={(e) => {
                      const v = e.target.value;
                      if (v === '') {
                        setElectivePref(code, null);
                        renameElective(code, '');
                      } else {
                        const day = Number(v);
                        setElectivePref(code, day);
                        const lbl = opts.find((o) => o.day === day)?.label ?? '';
                        renameElective(code, lbl);
                      }
                    }}
                    className="w-64 rounded border border-slate-300 bg-transparent px-2 py-0.5 text-xs dark:border-slate-700 dark:bg-slate-900"
                  >
                    <option value="">Sin preferencia (que el simulador elija)</option>
                    {opts.map((o) => (
                      <option key={o.day} value={o.day} disabled={takenByOthers.has(o.day)}>
                        {o.label}
                        {takenByOthers.has(o.day) ? ' (ya elegida en otra)' : ''}
                      </option>
                    ))}
                  </select>
                </div>
              );
            })()}
          </div>
        </div>
      </td>
      <td className="px-3 py-2">
        <Badge className={STATUS_CHIP[st]}>{STATUS_LABEL[st]}</Badge>
        {st === 'approved' && grade != null && (
          <span className={`ml-2 font-semibold ${gradeClass(grade)}`}>
            {grade}
          </span>
        )}
        {isDifficult && (
          <span className="ml-2 rounded-full bg-amber-500/15 px-2 py-0.5 text-xs font-medium text-amber-600 ring-1 ring-inset ring-amber-500/30 dark:text-amber-400">
            ★ difícil
          </span>
        )}
      </td>
      <td className="px-3 py-2">
        <div className="flex flex-wrap items-center justify-end gap-1">
          {st === 'approved' ? (
            <select
              value={grade}
              onChange={(e) => setGrade(code, +e.target.value)}
              className="rounded-md border border-slate-300 bg-transparent px-1.5 py-1 text-xs dark:border-slate-700 dark:bg-slate-900"
            >
              {[4, 5, 6, 7, 8, 9, 10].map((g) => (
                <option key={g} value={g}>
                  Nota {g}
                </option>
              ))}
            </select>
          ) : (
            <button
              className={`${btn} ${btnOff}`}
              onClick={() => setApproved(code, 4)}
            >
              Aprobar
            </button>
          )}
          <button
            className={`${btn} ${st === 'regularized' ? btnOn : btnOff}`}
            onClick={() => toggleRegularized(code)}
          >
            Regular
          </button>
          <button
            className={`${btn} ${st === 'inProgress' ? btnOn : btnOff}`}
            onClick={() => toggleInProgress(code)}
          >
            Cursando
          </button>
          <button
            className={`${btn} ${isDifficult ? 'border-amber-500 bg-amber-500/15 text-amber-600 dark:text-amber-400' : btnOff}`}
            onClick={() => toggleDifficult(code)}
            title="Marcar como difícil (opcional)"
          >
            {isDifficult ? '★' : '☆'}
          </button>
          {st !== 'blocked' && st !== 'eligible' && (
            <button
              className={`${btn} ${btnOff}`}
              onClick={() => clearStatus(code)}
              title="Quitar estado"
            >
              ✕
            </button>
          )}
        </div>
      </td>
    </tr>
  );
}

function ImportPanel({ onClose }: { onClose: () => void }) {
  const importApproved = useStore((s) => s.importApproved);
  const toggleRegularized = useStore((s) => s.toggleRegularized);
  const [text, setText] = useState('');
  const result = useMemo(() => (text.trim() ? parseTabular(text) : null), [text]);

  function apply() {
    if (!result) return;
    importApproved(result.approved);
    for (const c of result.regularized) toggleRegularized(c);
    onClose();
  }

  return (
    <div className="rounded-xl border border-brand-500/30 bg-brand-500/5 p-4">
      <h3 className="font-semibold">Importar aprobadas pegando texto</h3>
      <p className="mt-1 text-sm text-slate-600 dark:text-slate-400">
        Pegá las filas de tu historia académica o intraconsulta (código, nombre,
        condición, nota). Se matchea por código o nombre e ignora las materias
        del plan viejo automáticamente.
      </p>
      <textarea
        value={text}
        onChange={(e) => setText(e.target.value)}
        rows={6}
        placeholder="03635 TOPICOS DE PROGRAMACION  Promocion  7&#10;03638 ARQUITECTURA DE COMPUTADORAS  Promocion  9"
        className="mt-3 w-full rounded-lg border border-slate-300 bg-white p-3 font-mono text-xs dark:border-slate-700 dark:bg-slate-950"
      />
      {result && (
        <div className="mt-2 text-sm">
          <span className="font-medium text-emerald-600 dark:text-emerald-400">
            {result.approved.length} aprobadas
          </span>
          {result.regularized.length > 0 && (
            <span className="ml-3 font-medium text-cyan-600 dark:text-cyan-400">
              {result.regularized.length} regularizadas
            </span>
          )}
          {result.ignored.length > 0 && (
            <span className="ml-3 text-slate-500">
              {result.ignored.length} ignoradas (plan viejo / sin match)
            </span>
          )}
        </div>
      )}
      <div className="mt-3 flex gap-2">
        <button
          onClick={apply}
          disabled={!result || (result.approved.length === 0 && result.regularized.length === 0)}
          className="rounded-lg bg-brand-600 px-4 py-2 text-sm font-medium text-white hover:bg-brand-700 disabled:opacity-40"
        >
          Aplicar
        </button>
        <button
          onClick={onClose}
          className="rounded-lg border border-slate-300 px-4 py-2 text-sm font-medium dark:border-slate-700"
        >
          Cancelar
        </button>
      </div>
    </div>
  );
}
