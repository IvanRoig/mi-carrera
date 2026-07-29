/**
 * pwa.ts — Registra el service worker UNA sola vez, al cargar el módulo.
 *
 * Antes esto vivía dentro de un useEffect. Mala idea: con StrictMode los efectos
 * corren dos veces en desarrollo, así que se registraba dos veces y la segunda
 * registración veía al worker de la primera como "hay versión nueva". Resultado:
 * el cartel aparecía de la nada y el botón Actualizar no hacía nada, porque no
 * había ningún worker esperando de verdad.
 *
 * A nivel de módulo se ejecuta exactamente una vez, sin importar cuántas veces
 * React monte el componente.
 */
import { registerSW } from 'virtual:pwa-register';

let hay = false;
const oyentes = new Set<(v: boolean) => void>();

const aplicar = registerSW({
  immediate: true,
  onNeedRefresh() {
    hay = true;
    for (const f of oyentes) f(true);
  },
});

export const hayVersionNueva = () => hay;

export function escucharVersionNueva(f: (v: boolean) => void): () => void {
  oyentes.add(f);
  return () => {
    oyentes.delete(f);
  };
}

/**
 * Fuerza la búsqueda de una versión nueva ahora mismo, sin esperar a que el
 * navegador la note por su cuenta. Devuelve true si encontró una.
 */
export async function buscarVersionNueva(): Promise<boolean> {
  if (!('serviceWorker' in navigator)) return false;
  try {
    const regs = await navigator.serviceWorker.getRegistrations();
    await Promise.all(regs.map((r) => r.update()));
  } catch {
    // Sin conexión o sin worker: no pasa nada.
  }
  // `update()` dispara onNeedRefresh si hay algo nuevo; le damos un momento.
  await new Promise((r) => setTimeout(r, 1200));
  return hay;
}

export async function aplicarVersionNueva(): Promise<void> {
  try {
    // Le dice al worker que espera que tome el control; al tomarlo, recarga.
    await aplicar(true);
  } catch {
    // Da igual por qué falló: abajo recargamos de todas formas.
  }
  // Red de seguridad: si no había worker esperando, lo de arriba no recarga nada
  // y el botón quedaría sin efecto. Nunca dejamos al usuario apretando al aire.
  setTimeout(() => location.reload(), 1500);
}
