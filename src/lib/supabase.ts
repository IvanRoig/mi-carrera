/**
 * supabase.ts — Cliente de Supabase (auth + almacenamiento en la nube).
 *
 * Las credenciales se leen de variables de entorno de Vite:
 *   VITE_SUPABASE_URL, VITE_SUPABASE_ANON_KEY
 * La anon key es PÚBLICA por diseño: no da acceso a nada por sí sola, los datos
 * están protegidos por Row-Level Security (cada usuario ve solo lo suyo).
 *
 * Si no están seteadas, la app funciona igual en MODO INVITADO (solo localStorage).
 */
import { createClient, type SupabaseClient } from '@supabase/supabase-js';

const url = import.meta.env.VITE_SUPABASE_URL as string | undefined;
const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined;

/** ¿Está configurado el backend de cuentas? */
export const isSupabaseConfigured = Boolean(url && anonKey);

/** Cliente (null si no hay credenciales → modo invitado). */
export const supabase: SupabaseClient | null = isSupabaseConfigured
  ? createClient(url!, anonKey!, {
      auth: {
        persistSession: true,
        autoRefreshToken: true,
        detectSessionInUrl: true,
      },
    })
  : null;

/** Nombre de la tabla donde se guarda el estado de cada usuario. */
export const STATE_TABLE = 'planner_states';
