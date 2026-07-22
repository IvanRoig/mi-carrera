import { useMemo, useRef, useState } from 'react';
import { useStore } from '@/store/useStore';
import { useDerived } from '@/lib/useDerived';
import { getSubject } from '@/data/plan';
import { useSubjectName } from '@/lib/subjectName';
import exampleOffer from '@/data/oferta-ejemplo.json';
import {
  DAY_NAMES,
  detectConflicts,
  isNightCommission,
  offeringMap,
  toMinutes,
  type OfferData,
  type SelectedCommission,
} from '@/domain/conflicts';
import { parseOfertaHtml } from '@/lib/parseOfertaHtml';
import { Badge } from '@/components/Badge';

export function Oferta() {
  const offer = useStore((s) => s.offer);
  const setOffer = useStore((s) => s.setOffer);
  const fileRef = useRef<HTMLInputElement>(null);
  const [msg, setMsg] = useState('');

  function handleHtml(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const parsed = parseOfertaHtml(String(reader.result), file.name.replace(/\.html?$/i, ''));
        if (parsed.offerings.length === 0) {
          setMsg('No detecté comisiones en ese HTML. ¿Es la página de oferta de la intraconsulta?');
          return;
        }
        setOffer(parsed);
        setMsg(`Cargué ${parsed.offerings.length} materias desde el HTML.`);
      } catch {
        setMsg('No se pudo leer el HTML.');
      }
    };
    reader.readAsText(file, 'utf-8');
  }

  return (
    <div className="space-y-6">
      <div className="rounded-xl border border-brand-500/30 bg-brand-500/5 p-4 text-sm">
        <h3 className="font-semibold">Cómo funciona la oferta</h3>
        <p className="mt-1 text-slate-600 dark:text-slate-400">
          Entrá a la <strong>intraconsulta</strong> del campus, abrí la pantalla
          de <strong>oferta de comisiones</strong> y guardá esa página como
          archivo <strong>HTML</strong> (Ctrl+S → “Página web, solo HTML”).
          Subila acá y la app extrae automáticamente días, horarios y modalidades
          para detectar choques y mejorar el simulador.
        </p>
        <p className="mt-2 text-xs text-slate-500 dark:text-slate-400">
          Sobre las <strong>electivas</strong>: se ofrecen con nombres propios
          (ej: “Informática Biomédica”, martes noche). En el plan figuran como 3
          cupos genéricos (Electiva I/II/III) que cualquier electiva cumple; podés
          renombrarlos con la que cursás desde la solapa <strong>Materias</strong>.
        </p>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <input ref={fileRef} type="file" accept=".html,.htm,text/html" className="hidden" onChange={handleHtml} />
        <button
          onClick={() => fileRef.current?.click()}
          className="rounded-lg bg-brand-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-brand-700"
        >
          📄 Subir HTML de la oferta
        </button>
        <button
          onClick={() => {
            setOffer(exampleOffer as OfferData);
            setMsg('Cargué la oferta de ejemplo.');
          }}
          className="rounded-lg border border-slate-300 px-3 py-1.5 text-sm font-medium dark:border-slate-700"
        >
          Cargar ejemplo
        </button>
        {offer && (
          <button
            onClick={() => {
              setOffer(null);
              setMsg('');
            }}
            className="rounded-lg border border-slate-300 px-3 py-1.5 text-sm font-medium dark:border-slate-700"
          >
            Quitar oferta
          </button>
        )}
        {offer && (
          <Badge className="bg-brand-500/15 text-brand-600 ring-brand-500/30 dark:text-brand-300">
            {offer.cuatrimestre} · {offer.offerings.length} materias
          </Badge>
        )}
      </div>
      {msg && <p className="text-sm text-slate-500 dark:text-slate-400">{msg}</p>}

      {!offer ? (
        <div className="rounded-xl border border-dashed border-slate-300 p-8 text-center text-sm text-slate-500 dark:border-slate-700">
          Todavía no cargaste una oferta. Subí el HTML (o probá el ejemplo) para
          ver la grilla de horarios y detectar choques.
        </div>
      ) : (
        <OfferContent offer={offer} />
      )}
    </div>
  );
}

function OfferContent({ offer }: { offer: OfferData }) {
  const d = useDerived();
  const name = useSubjectName();
  const offMap = useMemo(() => offeringMap(offer), [offer]);

  const eligible = [...d.pending].filter((c) => d.statuses.get(c) === 'eligible');
  const eligibleOffered = eligible.filter((c) => offMap.has(c));
  // Las electivas se ofrecen con nombres propios (no como los placeholders del
  // plan), así que no las contamos como "no ofertadas".
  const eligibleNotOffered = eligible.filter(
    (c) => !offMap.has(c) && !getSubject(c)?.isElective,
  );

  const selected: SelectedCommission[] = eligibleOffered.flatMap((c) => {
    const o = offMap.get(c)!;
    return o.commissions.length ? [{ code: c, commission: o.commissions[0] }] : [];
  });
  const conflicts = detectConflicts(selected);

  return (
    <div className="space-y-6">
      {conflicts.length > 0 && (
        <div className="rounded-lg border border-rose-500/30 bg-rose-500/5 p-3 text-sm">
          <strong className="text-rose-600 dark:text-rose-400">
            {conflicts.length} choque{conflicts.length > 1 ? 's' : ''} de horario
          </strong>{' '}
          entre materias elegibles (usando la 1° comisión de cada una):
          <ul className="mt-1 list-inside list-disc text-slate-600 dark:text-slate-400">
            {conflicts.map((c, i) => {
              const m = c.a.commission.meetings[0];
              return (
                <li key={i}>
                  {name(c.a.code)} ✕ {name(c.b.code)}
                  {m && ` — ${DAY_NAMES[m.day]} ${m.start}`}
                </li>
              );
            })}
          </ul>
        </div>
      )}
      {eligibleNotOffered.length > 0 && (
        <div className="rounded-lg border border-amber-500/30 bg-amber-500/5 p-3 text-sm text-amber-700 dark:text-amber-300">
          <strong>Ojo:</strong> {eligibleNotOffered.length} materias que podrías
          cursar <em>no figuran</em> en esta oferta:{' '}
          {eligibleNotOffered.map((c) => name(c)).join(', ')}.
        </div>
      )}

      <WeeklyGrid offer={offer} highlight={new Set(eligibleOffered)} />

      <div>
        <h3 className="mb-2 text-lg font-semibold">Materias que podés cursar este cuatri</h3>
        <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
          {eligibleOffered.map((c) => {
            const o = offMap.get(c)!;
            return (
              <div key={c} className="rounded-lg border border-slate-200 bg-white p-3 dark:border-slate-800 dark:bg-slate-900">
                <div className="flex items-center justify-between">
                  <span className="font-medium">{name(c)}</span>
                  <span className="font-mono text-xs text-slate-400">{c}</span>
                </div>
                <div className="mt-1 space-y-0.5 text-xs text-slate-500 dark:text-slate-400">
                  {o.commissions.map((cm) => (
                    <div key={cm.id}>
                      {cm.meetings.length === 0
                        ? 'a distancia'
                        : cm.meetings
                            .map((m) => `${DAY_NAMES[m.day].slice(0, 3)} ${m.start}–${m.end}`)
                            .join(' + ')}{' '}
                      · {cm.modality}
                      {isNightCommission(cm) ? ' 🌙' : ' ☀️'}
                    </div>
                  ))}
                </div>
              </div>
            );
          })}
          {eligibleOffered.length === 0 && (
            <p className="text-sm text-slate-500">
              Ninguna de tus materias elegibles está en esta oferta.
            </p>
          )}
        </div>
      </div>
    </div>
  );
}

const START_HOUR = 8;
const END_HOUR = 23;

function WeeklyGrid({ offer, highlight }: { offer: OfferData; highlight: Set<string> }) {
  const name = useSubjectName();
  const days = [0, 1, 2, 3, 4, 5];
  const hours = Array.from({ length: END_HOUR - START_HOUR }, (_, i) => START_HOUR + i);

  const blocks = useMemo(() => {
    const list: { code: string; day: number; start: number; end: number; key: string }[] = [];
    for (const o of offer.offerings) {
      if (!highlight.has(o.code)) continue;
      for (const cm of o.commissions) {
        for (const m of cm.meetings) {
          list.push({
            code: o.code,
            day: m.day,
            start: toMinutes(m.start),
            end: toMinutes(m.end),
            key: `${o.code}-${cm.id}-${m.day}-${m.start}`,
          });
        }
      }
    }
    return list;
  }, [offer, highlight]);

  const rowH = 26;
  const total = (END_HOUR - START_HOUR) * rowH;

  return (
    <div className="overflow-x-auto rounded-xl border border-slate-200 dark:border-slate-800">
      <div className="min-w-[640px]">
        <div className="grid" style={{ gridTemplateColumns: `48px repeat(${days.length}, 1fr)` }}>
          <div />
          {days.map((dd) => (
            <div key={dd} className="border-b border-slate-200 py-2 text-center text-xs font-semibold dark:border-slate-800">
              {DAY_NAMES[dd]}
            </div>
          ))}
        </div>
        <div className="grid" style={{ gridTemplateColumns: `48px repeat(${days.length}, 1fr)` }}>
          <div className="relative" style={{ height: total }}>
            {hours.map((h) => (
              <div key={h} className="absolute right-1 -translate-y-1/2 text-[10px] text-slate-400" style={{ top: (h - START_HOUR) * rowH }}>
                {h}:00
              </div>
            ))}
          </div>
          {days.map((dd) => (
            <div key={dd} className="relative border-l border-slate-100 dark:border-slate-800/60" style={{ height: total }}>
              {hours.map((h) => (
                <div key={h} className="absolute w-full border-t border-slate-100 dark:border-slate-800/40" style={{ top: (h - START_HOUR) * rowH }} />
              ))}
              {blocks
                .filter((b) => b.day === dd)
                .map((b) => {
                  const top = ((b.start - START_HOUR * 60) / 60) * rowH;
                  const height = Math.max(14, ((b.end - b.start) / 60) * rowH);
                  return (
                    <div
                      key={b.key}
                      className="absolute left-0.5 right-0.5 overflow-hidden rounded-md bg-brand-600/85 p-1 text-[10px] leading-tight text-white shadow-sm"
                      style={{ top, height }}
                      title={name(b.code)}
                    >
                      {name(b.code)}
                    </div>
                  );
                })}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
