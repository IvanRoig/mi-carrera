/** Export/import del estado completo y compartir por URL (sin backend). */
import { compressToEncodedURIComponent, decompressFromEncodedURIComponent } from 'lz-string';
import type { StoreState } from '@/store/useStore';

/** Subconjunto exportable del store. */
export type ExportableState = Pick<
  StoreState,
  | 'user'
  | 'electiveNames'
  | 'scenarios'
  | 'manualTerms'
  | 'manualForcedDay'
  | 'manualForcedTurno'
  | 'offer'
>;

export function pickExportable(s: StoreState): ExportableState {
  // No guardamos la oferta base (viene del código y se actualiza con la app):
  // guardarla congelaría una versión vieja. Solo persistimos una oferta subida
  // por el usuario (identificada por tener otro `cuatrimestre`).
  const isBaseOffer = !s.offer || s.offer.cuatrimestre?.startsWith('Oferta base');
  return {
    user: s.user,
    electiveNames: s.electiveNames,
    scenarios: s.scenarios,
    manualTerms: s.manualTerms,
    manualForcedDay: s.manualForcedDay,
    manualForcedTurno: s.manualForcedTurno,
    offer: isBaseOffer ? null : s.offer,
  };
}

/** Descarga el estado como archivo JSON. */
export function downloadState(s: StoreState): void {
  const data = JSON.stringify({ app: 'unlam-planner', version: 1, ...pickExportable(s) }, null, 2);
  const blob = new Blob([data], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `mi-carrera-unlam-${new Date().toISOString().slice(0, 10)}.json`;
  a.click();
  URL.revokeObjectURL(url);
}

/** Lee y valida un JSON de estado importado. */
export function parseImportedState(text: string): Partial<ExportableState> | null {
  try {
    const obj = JSON.parse(text);
    if (!obj || typeof obj !== 'object') return null;
    const out: Partial<ExportableState> = {};
    if (obj.user) out.user = obj.user;
    if (obj.electiveNames) out.electiveNames = obj.electiveNames;
    if (obj.scenarios) out.scenarios = obj.scenarios;
    if (obj.manualTerms) out.manualTerms = obj.manualTerms;
    if (obj.manualForcedDay) out.manualForcedDay = obj.manualForcedDay;
    if (obj.manualForcedTurno) out.manualForcedTurno = obj.manualForcedTurno;
    if (obj.offer !== undefined) out.offer = obj.offer;
    return out;
  } catch {
    return null;
  }
}

/** Genera una URL para compartir el estado comprimido en el hash. */
export function buildShareUrl(s: StoreState): string {
  const payload = compressToEncodedURIComponent(JSON.stringify(pickExportable(s)));
  const base = `${location.origin}${location.pathname}`;
  return `${base}#s=${payload}`;
}

/** Lee el estado del hash de la URL (si viene un plan compartido). */
export function readShareFromHash(): Partial<ExportableState> | null {
  const hash = location.hash;
  const m = hash.match(/#s=(.+)$/);
  if (!m) return null;
  try {
    const json = decompressFromEncodedURIComponent(m[1]);
    if (!json) return null;
    return parseImportedState(json);
  } catch {
    return null;
  }
}
