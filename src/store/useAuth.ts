/**
 * useAuth.ts — Estado de autenticación (Supabase). Maneja sesión, registro,
 * login, logout, recuperación de contraseña y el modo invitado.
 */
import { create } from 'zustand';
import type { User } from '@supabase/supabase-js';
import { supabase, isSupabaseConfigured } from '@/lib/supabase';
import { onLogin, onLogout } from '@/lib/cloudSync';

/** Traduce errores comunes de Supabase a español. */
function translateError(msg: string): string {
  const m = msg.toLowerCase();
  if (m.includes('already registered') || m.includes('already exists'))
    return 'Ya existe una cuenta con ese email.';
  if (m.includes('invalid login credentials'))
    return 'Email o contraseña incorrectos.';
  if (m.includes('email not confirmed'))
    return 'Todavía no confirmaste tu email. Revisá tu casilla (y el spam).';
  if (m.includes('password should be at least'))
    return 'La contraseña debe tener al menos 6 caracteres.';
  if (m.includes('unable to validate email') || m.includes('invalid email'))
    return 'El email no es válido.';
  if (m.includes('rate limit') || m.includes('too many'))
    return 'Demasiados intentos. Esperá unos minutos.';
  return msg;
}

export type AuthState = {
  configured: boolean;
  user: User | null;
  status: 'loading' | 'ready';
  /** true cuando el usuario llegó desde el link de recuperación de contraseña. */
  recovery: boolean;
  error: string | null;
  info: string | null;

  init: () => void;
  signUp: (email: string, password: string) => Promise<void>;
  signIn: (email: string, password: string) => Promise<void>;
  signOut: () => Promise<void>;
  sendReset: (email: string) => Promise<void>;
  updatePassword: (password: string) => Promise<void>;
  clearMessages: () => void;
};

export const useAuth = create<AuthState>((set, get) => ({
  configured: isSupabaseConfigured,
  user: null,
  status: isSupabaseConfigured ? 'loading' : 'ready',
  recovery: false,
  error: null,
  info: null,

  init: () => {
    if (!supabase) {
      set({ status: 'ready' });
      return;
    }
    // Sesión inicial.
    supabase.auth.getSession().then(({ data }) => {
      const user = data.session?.user ?? null;
      set({ user, status: 'ready' });
      if (user) void onLogin(user.id);
    });

    // Cambios de sesión.
    supabase.auth.onAuthStateChange((event, session) => {
      const user = session?.user ?? null;
      if (event === 'PASSWORD_RECOVERY') {
        set({ recovery: true, user });
        return;
      }
      if (event === 'SIGNED_IN') {
        set({ user, error: null });
        if (user) void onLogin(user.id);
      }
      if (event === 'SIGNED_OUT') {
        set({ user: null });
        onLogout();
      }
    });
  },

  signUp: async (email, password) => {
    if (!supabase) return;
    set({ error: null, info: null });
    const { data, error } = await supabase.auth.signUp({ email, password });
    if (error) {
      set({ error: translateError(error.message) });
      return;
    }
    // Si requiere confirmación por email, no hay sesión todavía.
    if (!data.session) {
      set({
        info: 'Te mandamos un mail para confirmar tu cuenta. Confirmá y después iniciá sesión.',
      });
    }
  },

  signIn: async (email, password) => {
    if (!supabase) return;
    set({ error: null, info: null });
    const { error } = await supabase.auth.signInWithPassword({ email, password });
    if (error) set({ error: translateError(error.message) });
  },

  signOut: async () => {
    if (!supabase) return;
    await supabase.auth.signOut();
    set({ recovery: false });
  },

  sendReset: async (email) => {
    if (!supabase) return;
    set({ error: null, info: null });
    const redirectTo = `${location.origin}${location.pathname}`;
    const { error } = await supabase.auth.resetPasswordForEmail(email, {
      redirectTo,
    });
    if (error) set({ error: translateError(error.message) });
    else
      set({
        info: 'Si el email existe, te llegó un enlace para restablecer la contraseña.',
      });
  },

  updatePassword: async (password) => {
    if (!supabase) return;
    set({ error: null, info: null });
    const { error } = await supabase.auth.updateUser({ password });
    if (error) {
      set({ error: translateError(error.message) });
      return;
    }
    set({ recovery: false, info: 'Contraseña actualizada. ¡Listo!' });
    void get();
  },

  clearMessages: () => set({ error: null, info: null }),
}));
