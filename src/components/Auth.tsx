import { useEffect, useRef, useState } from 'react';
import { useAuth } from '@/store/useAuth';

type Tab = 'signin' | 'signup' | 'reset';

/** Botón de cuenta para el header. Oculto si no hay backend configurado. */
export function AccountButton() {
  const { configured, user, signOut } = useAuth();
  const [openModal, setOpenModal] = useState(false);
  const [menu, setMenu] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function onClick(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setMenu(false);
    }
    document.addEventListener('mousedown', onClick);
    return () => document.removeEventListener('mousedown', onClick);
  }, []);

  if (!configured) return null; // modo invitado puro

  if (!user) {
    return (
      <>
        <button
          onClick={() => setOpenModal(true)}
          className="rounded-lg bg-brand-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-brand-700"
        >
          Iniciar sesión
        </button>
        {openModal && <AuthModal onClose={() => setOpenModal(false)} />}
      </>
    );
  }

  return (
    <div className="relative" ref={ref}>
      <button
        onClick={() => setMenu((m) => !m)}
        className="flex items-center gap-2 rounded-lg border border-slate-300 px-3 py-1.5 text-sm font-medium hover:bg-slate-100 dark:border-slate-700 dark:hover:bg-slate-800"
        title="Sincronizado en la nube"
      >
        <span className="grid h-5 w-5 place-items-center rounded-full bg-brand-600 text-[10px] text-white">
          {user.email?.[0]?.toUpperCase() ?? '·'}
        </span>
        <span className="hidden max-w-32 truncate sm:inline">{user.email}</span>
        <span className="text-emerald-500" title="Datos sincronizados">☁</span>
      </button>
      {menu && (
        <div className="absolute right-0 z-30 mt-2 w-56 rounded-xl border border-slate-200 bg-white p-1.5 shadow-xl dark:border-slate-700 dark:bg-slate-900">
          <div className="px-3 py-2 text-xs text-slate-500 dark:text-slate-400">
            Sesión iniciada como
            <div className="truncate font-medium text-slate-700 dark:text-slate-200">
              {user.email}
            </div>
          </div>
          <div className="my-1 border-t border-slate-200 dark:border-slate-800" />
          <button
            className="w-full rounded-md px-3 py-2 text-left text-sm text-rose-600 hover:bg-slate-100 dark:text-rose-400 dark:hover:bg-slate-800"
            onClick={() => {
              void signOut();
              setMenu(false);
            }}
          >
            Cerrar sesión
          </button>
        </div>
      )}
    </div>
  );
}

/** Modal de ingreso / registro / recuperación. */
function AuthModal({ onClose }: { onClose: () => void }) {
  const { signIn, signUp, sendReset, error, info, clearMessages } = useAuth();
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
    // Si se logueó, el cambio de sesión cierra el modal desde el efecto de abajo.
  }

  // Cerrar cuando se establece sesión.
  const user = useAuth((s) => s.user);
  useEffect(() => {
    if (user) onClose();
  }, [user, onClose]);

  const input =
    'w-full rounded-lg border border-slate-300 bg-transparent px-3 py-2 text-sm dark:border-slate-700';
  const tabBtn = (t: Tab, label: string) => (
    <button
      type="button"
      onClick={() => setTab(t)}
      className={`flex-1 rounded-md px-3 py-1.5 text-sm font-medium transition ${
        tab === t
          ? 'bg-brand-600 text-white'
          : 'text-slate-600 hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-slate-800'
      }`}
    >
      {label}
    </button>
  );

  return (
    <div
      className="fixed inset-0 z-50 grid place-items-center bg-black/50 p-4"
      onClick={onClose}
    >
      <div
        className="w-full max-w-sm rounded-2xl border border-slate-200 bg-white p-5 shadow-2xl dark:border-slate-700 dark:bg-slate-900"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-lg font-bold">
            {tab === 'signin'
              ? 'Iniciar sesión'
              : tab === 'signup'
                ? 'Crear cuenta'
                : 'Recuperar contraseña'}
          </h2>
          <button
            onClick={onClose}
            className="text-slate-400 hover:text-slate-600"
            aria-label="Cerrar"
          >
            ✕
          </button>
        </div>

        <div className="mb-4 flex rounded-lg border border-slate-200 p-0.5 dark:border-slate-700">
          {tabBtn('signin', 'Ingresar')}
          {tabBtn('signup', 'Registrarse')}
        </div>

        <form onSubmit={submit} className="space-y-3">
          <label className="block">
            <span className="mb-1 block text-xs text-slate-500 dark:text-slate-400">
              Email
            </span>
            <input
              type="email"
              required
              autoComplete="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className={input}
              placeholder="vos@ejemplo.com"
            />
          </label>
          {tab !== 'reset' && (
            <label className="block">
              <span className="mb-1 block text-xs text-slate-500 dark:text-slate-400">
                Contraseña
              </span>
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
            </label>
          )}

          {error && (
            <p className="rounded-lg bg-rose-500/10 px-3 py-2 text-sm text-rose-600 dark:text-rose-400">
              {error}
            </p>
          )}
          {info && (
            <p className="rounded-lg bg-emerald-500/10 px-3 py-2 text-sm text-emerald-600 dark:text-emerald-400">
              {info}
            </p>
          )}

          <button
            type="submit"
            disabled={busy}
            className="w-full rounded-lg bg-brand-600 px-4 py-2 text-sm font-semibold text-white hover:bg-brand-700 disabled:opacity-50"
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

        <div className="mt-3 flex items-center justify-between text-xs">
          {tab === 'signin' ? (
            <button
              onClick={() => setTab('reset')}
              className="text-brand-600 hover:underline dark:text-brand-300"
            >
              Olvidé mi contraseña
            </button>
          ) : (
            <button
              onClick={() => setTab('signin')}
              className="text-brand-600 hover:underline dark:text-brand-300"
            >
              ← Volver a ingresar
            </button>
          )}
          <button
            onClick={onClose}
            className="text-slate-500 hover:underline"
          >
            Seguir sin cuenta
          </button>
        </div>

        {tab === 'signup' && (
          <p className="mt-3 text-[11px] text-slate-500 dark:text-slate-400">
            Al registrarte, los datos que cargaste en modo invitado se suben a tu
            cuenta para que los tengas en cualquier dispositivo.
          </p>
        )}
      </div>
    </div>
  );
}

/** Pantalla de nueva contraseña (tras el link de recuperación). */
export function RecoveryScreen() {
  const { recovery, updatePassword, error, info } = useAuth();
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);

  if (!recovery) return null;

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    await updatePassword(password);
    setBusy(false);
  }

  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-black/60 p-4">
      <form
        onSubmit={submit}
        className="w-full max-w-sm rounded-2xl border border-slate-200 bg-white p-5 shadow-2xl dark:border-slate-700 dark:bg-slate-900"
      >
        <h2 className="mb-1 text-lg font-bold">Elegí una nueva contraseña</h2>
        <p className="mb-4 text-sm text-slate-500 dark:text-slate-400">
          Escribí tu nueva contraseña para tu cuenta.
        </p>
        <input
          type="password"
          required
          minLength={6}
          autoComplete="new-password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          className="w-full rounded-lg border border-slate-300 bg-transparent px-3 py-2 text-sm dark:border-slate-700"
          placeholder="nueva contraseña (mín. 6)"
        />
        {error && (
          <p className="mt-3 rounded-lg bg-rose-500/10 px-3 py-2 text-sm text-rose-600 dark:text-rose-400">
            {error}
          </p>
        )}
        {info && (
          <p className="mt-3 rounded-lg bg-emerald-500/10 px-3 py-2 text-sm text-emerald-600 dark:text-emerald-400">
            {info}
          </p>
        )}
        <button
          type="submit"
          disabled={busy}
          className="mt-4 w-full rounded-lg bg-brand-600 px-4 py-2 text-sm font-semibold text-white hover:bg-brand-700 disabled:opacity-50"
        >
          {busy ? 'Guardando…' : 'Guardar contraseña'}
        </button>
      </form>
    </div>
  );
}
