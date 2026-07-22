/**
 * cloudSync.ts — Sincroniza el estado del planificador con Supabase.
 *
 * Regla:
 *  - Al iniciar sesión: si el usuario ya tiene datos en la nube, se cargan
 *    (la nube gana). Si no tiene (cuenta nueva), se SUBEN los datos locales
 *    del modo invitado (así no perdés lo que venías armando).
 *  - Mientras estás logueado, cada cambio se guarda en la nube (con debounce).
 */
import { supabase, STATE_TABLE } from './supabase';
import { useStore } from '@/store/useStore';
import { pickExportable, type ExportableState } from './persistence';

let saveTimer: ReturnType<typeof setTimeout> | null = null;
let unsub: (() => void) | null = null;
let currentUserId: string | null = null;

/** Trae el estado guardado en la nube para un usuario (o null). */
export async function pullCloudState(
  userId: string,
): Promise<ExportableState | null> {
  if (!supabase) return null;
  const { data, error } = await supabase
    .from(STATE_TABLE)
    .select('data')
    .eq('user_id', userId)
    .maybeSingle();
  if (error) {
    console.error('[cloudSync] pull error', error.message);
    return null;
  }
  return (data?.data as ExportableState) ?? null;
}

/** Guarda (upsert) el estado del usuario en la nube. */
export async function pushCloudState(
  userId: string,
  state: ExportableState,
): Promise<void> {
  if (!supabase) return;
  const { error } = await supabase.from(STATE_TABLE).upsert({
    user_id: userId,
    data: state,
    updated_at: new Date().toISOString(),
  });
  if (error) console.error('[cloudSync] push error', error.message);
}

/** Se llama al iniciar sesión: decide si baja o sube, y arranca el auto-guardado. */
export async function onLogin(userId: string): Promise<void> {
  currentUserId = userId;
  const cloud = await pullCloudState(userId);
  if (cloud && cloud.user) {
    useStore.getState().importFullState(cloud);
  } else {
    await pushCloudState(userId, pickExportable(useStore.getState()));
  }
  startAutoSave();
}

/** Se llama al cerrar sesión. */
export function onLogout(): void {
  currentUserId = null;
  stopAutoSave();
}

function startAutoSave(): void {
  stopAutoSave();
  unsub = useStore.subscribe(() => {
    if (!currentUserId) return;
    if (saveTimer) clearTimeout(saveTimer);
    saveTimer = setTimeout(() => {
      if (currentUserId) {
        void pushCloudState(currentUserId, pickExportable(useStore.getState()));
      }
    }, 1200);
  });
}

function stopAutoSave(): void {
  if (unsub) {
    unsub();
    unsub = null;
  }
  if (saveTimer) {
    clearTimeout(saveTimer);
    saveTimer = null;
  }
}
