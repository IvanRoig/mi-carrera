import { useEffect, useState, type ReactNode } from 'react';
import { useAuth } from '@/store/useAuth';
import { studyPlan } from '@/data/plan';

type Tab = 'signin' | 'signup' | 'reset';

/**
 * Portón de entrada: muestra la pantalla de login/registro (con opción de
 * invitado) hasta que el usuario tenga sesión o elija entrar sin cuenta.
 */
export function AuthGate({ children }: { children: ReactNode }) {
  const { status, user, guest } = useAuth();

  if (status === 'loading') {
    return (
      <div className="grid min-h-screen place-items-center bg-slate-950 text-slate-300">
        <div className="animate-pulse text-sm">Cargando…</div>
      </div>
    );
  }

  if (user || guest) return <>{children}</>;

  return <Landing />;
}

function Landing() {
  const { configured, signIn, signUp, sendReset, continueAsGuest, error, info, clearMessages } =
    useAuth();
  const [tab, setTab] = useState<Tab>('signin');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    clearMessages();
  }, [tab, clearMessages]);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    if (tab === 'signin') await signIn(email, password);
    else if (tab === 'signup') await signUp(email, password);
    else await sendReset(email);
    setBusy(false);
  }

  const input =
    'w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100';

  return (
    <div className="grid min-h-screen place-items-center bg-gradient-to-br from-slate-950 via-slate-900 to-brand-900 p-4 text-slate-100">
      <div className="w-full max-w-md">
        {/* Marca */}
        <div className="mb-6 text-center">
          <div className="mx-auto mb-3 grid h-14 w-14 place-items-center rounded-2xl bg-brand-600 text-2xl font-black text-white shadow-lg">
            Mi
          </div>
          <h1 className="text-2xl font-bold">Mi Carrera · UNLaM</h1>
          <p className="mt-1 text-sm text-slate-400">
            Planificá {studyPlan.career} y recibite lo antes posible.
          </p>
        </div>

        <div className="rounded-2xl border border-slate-700 bg-slate-900/80 p-6 shadow-2xl backdrop-blur">
          {configured ? (
            <>
              <div className="mb-4 flex rounded-lg border border-slate-700 p-0.5">
                <TabBtn active={tab === 'signin'} onClick={() => setTab('signin')}>
                  Ingresar
                </TabBtn>
                <TabBtn active={tab === 'signup'} onClick={() => setTab('signup')}>
                  Crear cuenta
                </TabBtn>
              </div>

              <form onSubmit={submit} className="space-y-3">
                <div>
                  <label className="mb-1 block text-xs text-slate-400">Email</label>
                  <input
                    type="email"
                    required
                    autoComplete="email"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    className={input}
                    placeholder="vos@ejemplo.com"
                  />
                </div>
                {tab !== 'reset' && (
                  <div>
                    <label className="mb-1 block text-xs text-slate-400">Contraseña</label>
                    <input
                      type="password"
                      required
                      minLength={6}
                      autoComplete={tab === 'signup' ? 'new-password' : 'current-password'}
                      value={password}
                      onChange={(e) => setPassword(e.target.value)}
                      className={input}
                      placeholder="mínimo 6 caracteres"
                    />
                  </div>
                )}

                {error && (
                  <p className="rounded-lg bg-rose-500/15 px-3 py-2 text-sm text-rose-300">{error}</p>
                )}
                {info && (
                  <p className="rounded-lg bg-emerald-500/15 px-3 py-2 text-sm text-emerald-300">{info}</p>
                )}

                <button
                  type="submit"
                  disabled={busy}
                  className="w-full rounded-lg bg-brand-600 px-4 py-2.5 text-sm font-semibold text-white hover:bg-brand-700 disabled:opacity-50"
                >
                  {busy
                    ? 'Procesando…'
                    : tab === 'signin'
                      ? 'Ingresar'
                      : tab === 'signup'
                        ? 'Crear cuenta'
                        : 'Enviarme el enlace'}
                </button>
              </form>

              <div className="mt-3 text-center text-xs">
                {tab === 'signin' ? (
                  <button onClick={() => setTab('reset')} className="text-brand-300 hover:underline">
                    Olvidé mi contraseña
                  </button>
                ) : (
                  <button onClick={() => setTab('signin')} className="text-brand-300 hover:underline">
                    ← Volver a ingresar
                  </button>
                )}
              </div>
            </>
          ) : (
            <p className="text-center text-sm text-slate-400">
              Las cuentas no están configuradas en este despliegue. Podés usar la
              app en modo invitado (tus datos quedan en este navegador).
            </p>
          )}

          <div className="my-4 flex items-center gap-3 text-xs text-slate-500">
            <span className="h-px flex-1 bg-slate-700" />o<span className="h-px flex-1 bg-slate-700" />
          </div>

          <button
            onClick={continueAsGuest}
            className="w-full rounded-lg border border-slate-600 px-4 py-2.5 text-sm font-medium text-slate-200 hover:bg-slate-800"
          >
            Entrar como invitado
          </button>
          <p className="mt-2 text-center text-[11px] text-slate-500">
            Como invitado tu progreso <strong>no se guarda</strong> (se pierde al
            recargar). Creá una cuenta para guardarlo en la nube y usarlo en
            cualquier dispositivo.
          </p>
        </div>
      </div>
    </div>
  );
}

function TabBtn({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`flex-1 rounded-md px-3 py-1.5 text-sm font-medium transition ${
        active ? 'bg-brand-600 text-white' : 'text-slate-300 hover:bg-slate-800'
      }`}
    >
      {children}
    </button>
  );
}
