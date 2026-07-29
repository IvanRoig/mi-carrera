/**
 * HorarioSemanal.tsx — Tu semana de cursada, con escala horaria real.
 *
 * A diferencia de la grilla por día del simulador, acá cada materia ocupa el
 * alto que le corresponde según su horario: se ve de un vistazo cómo te queda
 * la semana y cuánto aire tenés entre clases.
 */
import { DAY_SHORT, toMinutes, type Commission } from '@/domain/conflicts';
import { getSubject } from '@/data/plan';
import { trackColor } from '@/lib/ui';
import { useSubjectName } from '@/lib/subjectName';

export type BloqueMateria = {
  code: string;
  /** Nombre a mostrar (para electivas, el de la electiva real). */
  titulo?: string;
  commission?: Commission;
};

const DIAS = [0, 1, 2, 3, 4, 5];
const PFC = '03671';

export function HorarioSemanal({ materias }: { materias: BloqueMateria[] }) {
  const name = useSubjectName();

  // Bloques con horario y materias sin horario fijo (van aparte, abajo).
  const bloques: { m: BloqueMateria; day: number; ini: number; fin: number }[] = [];
  const sinHorario: BloqueMateria[] = [];
  for (const m of materias) {
    const encuentros = m.commission?.meetings ?? [];
    if (encuentros.length === 0) {
      sinHorario.push(m);
      continue;
    }
    for (const e of encuentros) {
      bloques.push({ m, day: e.day, ini: toMinutes(e.start), fin: toMinutes(e.end) });
    }
  }

  if (bloques.length === 0 && sinHorario.length === 0) return null;

  // La grilla se ajusta a tus horarios: no mostramos horas vacías de más.
  const desde = bloques.length ? Math.min(...bloques.map((b) => b.ini)) : 8 * 60;
  const hasta = bloques.length ? Math.max(...bloques.map((b) => b.fin)) : 23 * 60;
  const hIni = Math.floor(desde / 60);
  const hFin = Math.ceil(hasta / 60);
  const horas = hFin - hIni;
  const ALTO = 34; // px por hora con clase
  const ALTO_HUECO = 12; // las horas muertas se achican (si cursás 8 y 19, el medio sobra)

  // Alto de cada hora según si hay clase en algún día.
  const ocupada = Array.from({ length: horas }, (_, i) => {
    const ini = (hIni + i) * 60;
    return bloques.some((b) => b.ini < ini + 60 && b.fin > ini);
  });
  const altoDe = (i: number) => (ocupada[i] ? ALTO : ALTO_HUECO);
  // Posición acumulada del comienzo de cada hora.
  const top: number[] = [0];
  for (let i = 0; i < horas; i++) top.push(top[i] + altoDe(i));
  const alturaTotal = top[horas];
  const y = (min: number) => {
    const i = Math.min(horas - 1, Math.max(0, Math.floor(min / 60) - hIni));
    return top[i] + ((min - (hIni + i) * 60) / 60) * altoDe(i);
  };
  // Tramos comprimidos, para marcarlos con un "⋯" y que se note el salto.
  const huecos: { top: number; alto: number }[] = [];
  for (let i = 0; i < horas; i++) {
    if (ocupada[i]) continue;
    let j = i;
    while (j < horas && !ocupada[j]) j++;
    if (j - i >= 2) huecos.push({ top: top[i], alto: top[j] - top[i] });
    i = j - 1;
  }

  // Días con al menos una clase (para no mostrar columnas vacías si no hacen falta).
  const diasUsados = DIAS.filter((d) => bloques.some((b) => b.day === d));
  const dias = diasUsados.length ? diasUsados : [0, 1, 2, 3, 4];

  return (
    <div className="overflow-x-auto">
      {/* pb-1.5: el rótulo de la última hora sobresale media línea */}
      <div className="min-w-[520px] pb-1.5">
        {/* Encabezado de días */}
        <div
          className="grid gap-1 pl-10"
          style={{ gridTemplateColumns: `repeat(${dias.length}, minmax(0,1fr))` }}
        >
          {dias.map((d) => (
            <div
              key={d}
              className="pb-1 text-center text-[11px] font-semibold text-slate-500 dark:text-slate-400"
            >
              {DAY_SHORT[d]}
            </div>
          ))}
        </div>

        <div className="relative flex">
          {/* Escala horaria */}
          <div className="relative w-10 shrink-0" style={{ height: alturaTotal }}>
            {/* Solo rotulamos las horas que se ven: en los tramos comprimidos no
                entra el número y se amontonaría. */}
            {Array.from({ length: horas + 1 }, (_, i) => i)
              .filter((i) => i === 0 || i === horas || ocupada[i] || ocupada[i - 1])
              .map((i) => (
                <div
                  key={i}
                  className="absolute right-1 -translate-y-1/2 text-[10px] tabular-nums text-slate-400"
                  style={{ top: top[i] }}
                >
                  {String(hIni + i).padStart(2, '0')}
                </div>
              ))}
          </div>

          {/* Columnas de días */}
          <div
            className="relative grid flex-1 gap-1"
            style={{
              gridTemplateColumns: `repeat(${dias.length}, minmax(0,1fr))`,
              height: alturaTotal,
            }}
          >
            {/* Líneas de hora, de fondo */}
            <div className="pointer-events-none absolute inset-0">
              {Array.from({ length: horas + 1 }, (_, i) => i)
                .filter((i) => i === 0 || i === horas || ocupada[i] || ocupada[i - 1])
                .map((i) => (
                  <div
                    key={i}
                    className="absolute inset-x-0 border-t border-slate-200/70 dark:border-slate-700/50"
                    style={{ top: top[i] }}
                  />
                ))}
              {/* Franja de horas libres, comprimida */}
              {huecos.map((h) => (
                <div
                  key={h.top}
                  className="absolute inset-x-0 flex items-center justify-center text-[10px] text-slate-300 dark:text-slate-600"
                  style={{ top: h.top, height: h.alto }}
                >
                  ⋯
                </div>
              ))}
            </div>

            {dias.map((d) => (
              <div key={d} className="relative rounded-md bg-slate-50/60 dark:bg-slate-800/30">
                {bloques
                  .filter((b) => b.day === d)
                  .map((b, i) => {
                    const s = getSubject(b.m.code);
                    const color = b.m.code === PFC ? '#fb923c' : trackColor(s?.track ?? '');
                    const alto = Math.max(22, y(b.fin) - y(b.ini) - 2);
                    return (
                      <div
                        key={`${b.m.code}-${i}`}
                        className="absolute inset-x-0.5 overflow-hidden rounded-md border-l-4 bg-white px-1.5 py-1 shadow-sm dark:bg-slate-800"
                        style={{ top: y(b.ini) + 1, height: alto, borderLeftColor: color }}
                        title={`${b.m.titulo ?? name(b.m.code)} · ${DAY_SHORT[d]} ${String(
                          Math.floor(b.ini / 60),
                        ).padStart(2, '0')}:00–${String(Math.floor(b.fin / 60)).padStart(2, '0')}:00`}
                      >
                        <div className="text-[10px] font-semibold leading-tight">
                          {b.m.titulo ?? name(b.m.code)}
                        </div>
                        {alto > 40 && (
                          <div className="text-[9px] leading-tight text-slate-500 dark:text-slate-400">
                            {String(Math.floor(b.ini / 60)).padStart(2, '0')}:00–
                            {String(Math.floor(b.fin / 60)).padStart(2, '0')}:00
                          </div>
                        )}
                      </div>
                    );
                  })}
              </div>
            ))}
          </div>
        </div>

        {sinHorario.length > 0 && (
          <div className="mt-2 flex flex-wrap items-center gap-1.5 pl-10">
            <span className="text-[10px] font-semibold text-slate-400">💻 Sin horario fijo:</span>
            {sinHorario.map((m) => (
              <span
                key={m.code}
                className="rounded border border-dashed border-slate-300 px-1.5 py-0.5 text-[10px] dark:border-slate-600"
              >
                {m.titulo ?? name(m.code)}
              </span>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
