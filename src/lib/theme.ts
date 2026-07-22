/** Manejo simple del tema claro/oscuro persistido en localStorage. */

const KEY = 'unlam-planner-theme';

export function getInitialTheme(): 'dark' | 'light' {
  try {
    const saved = localStorage.getItem(KEY);
    if (saved === 'dark' || saved === 'light') return saved;
  } catch {
    /* ignore */
  }
  return 'dark'; // oscuro por defecto
}

export function applyTheme(theme: 'dark' | 'light'): void {
  document.documentElement.classList.toggle('dark', theme === 'dark');
  try {
    localStorage.setItem(KEY, theme);
  } catch {
    /* ignore */
  }
}
