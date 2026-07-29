/**
 * ActualizarApp.tsx — Aviso de versión nueva, sin recargar por sorpresa.
 *
 * Antes la app se actualizaba sola: apenas publicábamos algo, la pestaña se
 * recargaba y te devolvía al Tablero, cortando lo que estuvieras haciendo (por
 * ejemplo, un análisis de riesgo a medio calcular). Ahora aparece este cartelito
 * y recargás vos cuando te viene bien.
 */
import { useEffect, useState } from 'react';
import { registerSW } from 'virtual:pwa-register';

export function ActualizarApp() {
  const [hayNueva, setHayNueva] = useState(false);
  const [actualizar, setActualizar] = useState<(() => void) | null>(null);

  useEffect(() => {
    const update = registerSW({
      immediate: true,
      onNeedRefresh() {
        setHayNueva(true);
      },
    });
    // Guardamos la función en un closure: si la pasáramos directo, React la
    // trataría como updater y la llamaría (recargando al toque).
    setActualizar(() => () => update(true));
  }, []);

  if (!hayNueva) return null;

  return (
    <div className="fixed inset-x-0 bottom-0 z-50 flex justify-center p-3">
      <div className="flex items-center gap-3 rounded-xl border border-brand-500/40 bg-white px-4 py-2.5 text-sm shadow-lg dark:bg-slate-900">
        <span>✨ Hay una versión nueva de Mi Carrera.</span>
        <button
          onClick={() => actualizar?.()}
          className="rounded-lg bg-brand-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-brand-700"
        >
          Actualizar
        </button>
        <button
          onClick={() => setHayNueva(false)}
          className="text-slate-400 hover:text-slate-600 dark:hover:text-slate-200"
          title="Después"
        >
          ✕
        </button>
      </div>
    </div>
  );
}
