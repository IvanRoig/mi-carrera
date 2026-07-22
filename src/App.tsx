import { useEffect, useRef, useState } from 'react';
import { studyPlan } from '@/data/plan';
import { applyTheme, getInitialTheme } from '@/lib/theme';
import { useStore } from '@/store/useStore';
import {
  buildShareUrl,
  downloadState,
  parseImportedState,
  readShareFromHash,
} from '@/lib/persistence';
import { Tablero } from '@/pages/Tablero';
import { Materias } from '@/pages/Materias';
import { Grafo } from '@/pages/Grafo';
import { Simulador } from '@/pages/Simulador';
import { Comparador } from '@/pages/Comparador';
import { Oferta } from '@/pages/Oferta';
import { AccountButton, RecoveryScreen } from '@/components/Auth';
import { useAuth } from '@/store/useAuth';

type TabId = 'tablero' | 'materias' | 'grafo' | 'simulador' | 'comparador' | 'oferta';

const TABS: { id: TabId; label: string; icon: string }[] = [
  { id: 'tablero', label: 'Tablero', icon: '📊' },
  { id: 'materias', label: 'Materias', icon: '📚' },
  { id: 'grafo', label: 'Correlativas', icon: '🕸️' },
  { id: 'simulador', label: 'Simulador', icon: '🗓️' },
  { id: 'comparador', label: 'Comparador', icon: '⚖️' },
  { id: 'oferta', label: 'Oferta', icon: '🏫' },
];

export default function App() {
  const [theme, setTheme] = useState<'dark' | 'light'>(getInitialTheme());
  const [tab, setTab] = useState<TabId>('tablero');
  const importFullState = useStore((s) => s.importFullState);
  const initAuth = useAuth((s) => s.init);

  // Inicializa la sesión de Supabase (o modo invitado si no está configurado).
  useEffect(() => {
    initAuth();
  }, [initAuth]);

  // Al montar: si viene un plan compartido en el hash, ofrecer importarlo.
  useEffect(() => {
    const shared = readShareFromHash();
    if (shared && shared.user) {
      const ok = window.confirm(
        'Este enlace contiene un plan compartido. ¿Querés cargarlo? (reemplaza tu estado actual)',
      );
      if (ok) importFullState(shared);
      history.replaceState(null, '', location.pathname + location.search);
    }
  }, [importFullState]);

  function toggleTheme() {
    const next = theme === 'dark' ? 'light' : 'dark';
    setTheme(next);
    applyTheme(next);
  }

  return (
    <div className="min-h-full pb-16">
      <header className="sticky top-0 z-20 border-b border-slate-200/60 bg-white/80 backdrop-blur dark:border-slate-800 dark:bg-slate-950/80">
        <div className="mx-auto max-w-6xl px-4">
          <div className="flex items-center justify-between py-3">
            <div className="flex items-center gap-3">
              <div className="grid h-9 w-9 place-items-center rounded-xl bg-brand-600 text-white shadow-sm">
                <span className="text-lg font-black">Mi</span>
              </div>
              <div>
                <h1 className="text-base font-bold leading-tight">
                  Mi Carrera · UNLaM
                </h1>
                <p className="text-xs text-slate-500 dark:text-slate-400">
                  {studyPlan.career} · Plan {studyPlan.planVersion}
                </p>
              </div>
            </div>
            <div className="flex items-center gap-2">
              <AccountButton />
              <DataMenu />
              <button
                onClick={toggleTheme}
                className="rounded-lg border border-slate-300 px-3 py-1.5 text-sm font-medium transition hover:bg-slate-100 dark:border-slate-700 dark:hover:bg-slate-800"
                aria-label="Cambiar tema"
              >
                {theme === 'dark' ? '☀️' : '🌙'}
              </button>
            </div>
          </div>

          {/* Navegación por solapas */}
          <nav className="flex gap-1 overflow-x-auto pb-2" aria-label="Secciones">
            {TABS.map((t) => (
              <button
                key={t.id}
                onClick={() => setTab(t.id)}
                aria-current={tab === t.id ? 'page' : undefined}
                className={`flex shrink-0 items-center gap-1.5 rounded-lg px-3 py-1.5 text-sm font-medium transition ${
                  tab === t.id
                    ? 'bg-brand-600 text-white shadow-sm'
                    : 'text-slate-600 hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-slate-800'
                }`}
              >
                <span aria-hidden>{t.icon}</span>
                {t.label}
              </button>
            ))}
          </nav>
        </div>
      </header>

      <main className="mx-auto max-w-6xl px-4 py-8">
        {tab === 'tablero' && <Tablero />}
        {tab === 'materias' && <Materias />}
        {tab === 'grafo' && <Grafo />}
        {tab === 'simulador' && <Simulador />}
        {tab === 'comparador' && <Comparador />}
        {tab === 'oferta' && <Oferta />}
      </main>

      <RecoveryScreen />
    </div>
  );
}

/** Menú de gestión de datos (cargar, exportar, importar, compartir, imprimir). */
function DataMenu() {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const loadExampleData = useStore((s) => s.loadExampleData);
  const resetAll = useStore((s) => s.resetAll);
  const importFullState = useStore((s) => s.importFullState);
  const fileRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    function onClick(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener('mousedown', onClick);
    return () => document.removeEventListener('mousedown', onClick);
  }, []);

  function handleImportFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      const parsed = parseImportedState(String(reader.result));
      if (parsed) {
        importFullState(parsed);
        setOpen(false);
      } else {
        alert('No se pudo leer el archivo. ¿Es un JSON exportado por la app?');
      }
    };
    reader.readAsText(file);
  }

  async function share() {
    const url = buildShareUrl(useStore.getState());
    try {
      await navigator.clipboard.writeText(url);
      alert('¡Link copiado! Pegáselo a tu compañero/a.');
    } catch {
      prompt('Copiá este link para compartir tu plan:', url);
    }
    setOpen(false);
  }

  const item =
    'w-full text-left px-3 py-2 text-sm rounded-md hover:bg-slate-100 dark:hover:bg-slate-800';

  return (
    <div className="relative" ref={ref}>
      <button
        onClick={() => setOpen((o) => !o)}
        className="rounded-lg border border-slate-300 px-3 py-1.5 text-sm font-medium transition hover:bg-slate-100 dark:border-slate-700 dark:hover:bg-slate-800"
      >
        Datos ▾
      </button>
      {open && (
        <div className="absolute right-0 z-30 mt-2 w-60 rounded-xl border border-slate-200 bg-white p-1.5 shadow-xl dark:border-slate-700 dark:bg-slate-900">
          <button className={item} onClick={() => fileRef.current?.click()}>
            📂 Importar JSON (tu backup)
          </button>
          <button className={item} onClick={() => { loadExampleData(); setOpen(false); }}>
            🧪 Cargar datos de ejemplo
          </button>
          <div className="my-1 border-t border-slate-200 dark:border-slate-800" />
          <button className={item} onClick={() => { downloadState(useStore.getState()); setOpen(false); }}>
            💾 Exportar a JSON (backup)
          </button>
          <button className={item} onClick={share}>
            🔗 Compartir por link
          </button>
          <button className={item} onClick={() => { window.print(); setOpen(false); }}>
            🖨️ Imprimir / PDF
          </button>
          <div className="my-1 border-t border-slate-200 dark:border-slate-800" />
          <button
            className={`${item} text-rose-600 dark:text-rose-400`}
            onClick={() => {
              if (confirm('¿Borrar todo y empezar de cero?')) {
                resetAll();
                setOpen(false);
              }
            }}
          >
            🗑️ Empezar de cero
          </button>
          <input
            ref={fileRef}
            type="file"
            accept="application/json"
            className="hidden"
            onChange={handleImportFile}
          />
        </div>
      )}
    </div>
  );
}
