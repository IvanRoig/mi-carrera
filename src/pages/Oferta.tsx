import { useMemo, useState } from 'react';
import { useStore } from '@/store/useStore';
import { useDerived } from '@/lib/useDerived';
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
import { Badge } from '@/components/Badge';

export function Oferta() {
  const offer = useStore((s) => s.offer);
  const setOffer = useStore((s) => s.setOffer);
  const [text, setText] = useState('');
  const [err, setErr] = useState('');

  function tryParse(raw: string) {
    try {
      const obj = JSON.parse(raw) as OfferData;
      if (!obj.offerings) throw new Error('falta offerings');
      setOffer(obj);
      setErr('');
      setText('');
    } catch {
      setErr('No se pudo leer el JSON. Revisá el formato (ver oferta-ejemplo.json).');
    }
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center gap-2">
        <button
          onClick={() => setOffer(exampleOffer as OfferData)}
          className="rounded-lg bg-brand-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-brand-700"
        >
          Cargar oferta de ejemplo
        </button>
        {offer && (
          <button
            onClick={() => setOffer(null)}
            className="rounded-lg border border-slate-300 px-3 py-1.5 text-sm font-medium dark:border-slate-700"
          >
            Quitar oferta
          </button>
        )}
        {offer && (
          <Badge className="bg-brand-500/15 text-brand-600 ring-brand-500/30 dark:text-brand-300">
            {offer.cuatrimestre} · {offer.offerings.length} materias ofertadas
          </Badge>
        )}
      </div>

      <details className="rounded-xl border border-slate-200 p-4 dark:border-slate-800">
        <summary className="cursor-pointer text-sm font-medium">
          Pegar oferta en JSON (formato de oferta-ejemplo.json)
        </summary>
        <textarea
          value={text}
          onChange={(e) => setText(e.target.value)}
          rows={6}
          className="mt-3 w-full rounded-lg border border-slate-300 bg-white p-3 font-mono text-xs dark:border-slate-700 dark:bg-slate-950"
          placeholder='{ "cuatrimestre": "2C-2026", "offerings": [ ... ] }'
        />
        {err && <p className="mt-1 text-xs text-rose-500">{err}</p>}
        <button
          onClick={() => tryParse(text)}
          disabled={!text.trim()}
          className="mt-2 rounded-lg bg-brand-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-brand-700 disabled:opacity-40"
        >
          Cargar
        </button>
      </details>

      {!offer ? (
        <div className="rounded-xl border border-dashed border-slate-300 p-8 text-center text-sm text-slate-500 dark:border-slate-700">
          Cargá una oferta para ver la grilla de horarios, detectar choques y que
          el simulador tenga en cuenta días/horarios reales.
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

  // Elegibles pendientes (podés cursarlas ya).
  const eligible = [...d.pending].filter((c) => d.statuses.get(c) === 'eligible');
  const eligibleOffered = eligible.filter((c) => offMap.has(c));
  const eligibleNotOffered = eligible.filter((c) => !offMap.has(c));

  // Selección de comisiones (una por materia elegible, la primera) para choques.
  const selected: SelectedCommission[] = eligibleOffered.flatMap((c) => {
    const o = offMap.get(c)!;
    return o.commissions.length ? [{ code: c, commission: o.commissions[0] }] : [];
  });
  const conflicts = detectConflicts(selected);

  return (
    <div className="space-y-6">
      {/* Alertas */}
      {conflicts.length > 0 && (
        <div className="rounded-lg border border-rose-500/30 bg-rose-500/5 p-3 text-sm">
          <strong className="text-rose-600 dark:text-rose-400">
            {conflicts.length} choque{conflicts.length > 1 ? 's' : ''} de horario
          </strong>{' '}
          entre materias elegibles (usando la 1° comisión de cada una):
          <ul className="mt-1 list-inside list-disc text-slate-600 dark:text-slate-400">
            {conflicts.map((c, i) => (
              <li key={i}>
                {name(c.a.code)} ✕ {name(c.b.code)} —{' '}
                {DAY_NAMES[c.a.commission.day]} {c.a.commission.start}
              </li>
            ))}
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

      {/* Grilla semanal */}
      <WeeklyGrid offer={offer} highlight={new Set(eligibleOffered)} />

      {/* Lista de materias elegibles y su oferta */}
      <div>
        <h3 className="mb-2 text-lg font-semibold">
          Materias que podés cursar este cuatri
        </h3>
        <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
          {eligibleOffered.map((c) => {
            const o = offMap.get(c)!;
            return (
              <div
                key={c}
                className="rounded-lg border border-slate-200 bg-white p-3 dark:border-slate-800 dark:bg-slate-900"
              >
                <div className="flex items-center justify-between">
                  <span className="font-medium">{name(c)}</span>
                  <span className="font-mono text-xs text-slate-400">{c}</span>
                </div>
                <div className="mt-1 space-y-0.5 text-xs text-slate-500 dark:text-slate-400">
                  {o.commissions.map((cm) => (
                    <div key={cm.id}>
                      {DAY_NAMES[cm.day]} {cm.start}–{cm.end} · {cm.modality}
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

function WeeklyGrid({
  offer,
  highlight,
}: {
  offer: OfferData;
  highlight: Set<string>;
}) {
  const name = useSubjectName();
  const days = [0, 1, 2, 3, 4, 5]; // Lun..Sáb
  const hours = Array.from({ length: END_HOUR - START_HOUR }, (_, i) => START_HOUR + i);

  // Bloques por día.
  const blocks = useMemo(() => {
    const list: {
      code: string;
      day: number;
      start: number;
      end: number;
      commissionId: string;
    }[] = [];
    for (const o of offer.offerings) {
      if (!highlight.has(o.code)) continue;
      for (const cm of o.commissions) {
        if (cm.modality === 'distancia') continue;
        list.push({
          code: o.code,
          day: cm.day,
          start: toMinutes(cm.start),
          end: toMinutes(cm.end),
          commissionId: cm.id,
        });
      }
    }
    return list;
  }, [offer, highlight]);

  const rowH = 26; // px por hora
  const total = (END_HOUR - START_HOUR) * rowH;

  return (
    <div className="overflow-x-auto rounded-xl border border-slate-200 dark:border-slate-800">
      <div className="min-w-[640px]">
        <div className="grid" style={{ gridTemplateColumns: `48px repeat(${days.length}, 1fr)` }}>
          <div />
          {days.map((dd) => (
            <div
              key={dd}
              className="border-b border-slate-200 py-2 text-center text-xs font-semibold dark:border-slate-800"
            >
              {DAY_NAMES[dd]}
            </div>
          ))}
        </div>
        <div className="grid" style={{ gridTemplateColumns: `48px repeat(${days.length}, 1fr)` }}>
          {/* Columna de horas */}
          <div className="relative" style={{ height: total }}>
            {hours.map((h) => (
              <div
                key={h}
                className="absolute right-1 -translate-y-1/2 text-[10px] text-slate-400"
                style={{ top: (h - START_HOUR) * rowH }}
              >
                {h}:00
              </div>
            ))}
          </div>
          {days.map((dd) => (
            <div
              key={dd}
              className="relative border-l border-slate-100 dark:border-slate-800/60"
              style={{ height: total }}
            >
              {hours.map((h) => (
                <div
                  key={h}
                  className="absolute w-full border-t border-slate-100 dark:border-slate-800/40"
                  style={{ top: (h - START_HOUR) * rowH }}
                />
              ))}
              {blocks
                .filter((b) => b.day === dd)
                .map((b) => {
                  const top = ((b.start - START_HOUR * 60) / 60) * rowH;
                  const height = ((b.end - b.start) / 60) * rowH;
                  return (
                    <div
                      key={b.code + b.commissionId}
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
