/**
 * cloudSync.test.ts — Que volver a la pestaña no te pise lo que estabas haciendo.
 *
 * Supabase reemite `SIGNED_IN` cada vez que refresca el token (p.ej. al volver
 * a la pestaña con alt-tab). Si en cada aviso bajáramos el estado de la nube,
 * sobreescribiríamos los cambios locales con una copia vieja: al usuario le
 * cambiaba el plan solo (7 cuatrimestres pasaban a 6 sin tocar nada).
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

// Estado "en la nube" simulado y contador de descargas.
const nube = {
  data: {
    user: { approved: [{ code: '03621', grade: 8 }], regularized: [], inProgress: [], difficult: [] },
    electivePref: {},
  } as Record<string, unknown>,
};
let descargas = 0;
let subidas = 0;

vi.mock('./supabase', () => ({
  STATE_TABLE: 'planner_states',
  isSupabaseConfigured: true,
  supabase: {
    from: () => ({
      select: () => ({
        eq: () => ({
          maybeSingle: async () => {
            descargas++;
            return { data: { data: nube.data }, error: null };
          },
        }),
      }),
      upsert: async () => {
        subidas++;
        return { error: null };
      },
    }),
  },
}));

const { onLogin, onLogout } = await import('./cloudSync');

describe('sincronización con la nube', () => {
  beforeEach(() => {
    descargas = 0;
    subidas = 0;
    onLogout();
  });

  it('baja el estado UNA sola vez por sesión, aunque Supabase reavise el login', async () => {
    await onLogin('user-1');
    expect(descargas).toBe(1);

    // Supabase reemite SIGNED_IN al refrescar el token (volver a la pestaña).
    await onLogin('user-1');
    await onLogin('user-1');
    await onLogin('user-1');

    expect(descargas, 'no debe volver a bajar y pisar lo local').toBe(1);
  });

  it('si cambia de usuario, sí vuelve a bajar', async () => {
    await onLogin('user-1');
    expect(descargas).toBe(1);
    await onLogin('user-2');
    expect(descargas).toBe(2);
  });

  it('después de cerrar sesión, vuelve a bajar al entrar de nuevo', async () => {
    await onLogin('user-1');
    expect(descargas).toBe(1);
    onLogout();
    await onLogin('user-1');
    expect(descargas).toBe(2);
  });
});
