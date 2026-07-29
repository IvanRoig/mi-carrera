import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import { VitePWA } from 'vite-plugin-pwa';
import { fileURLToPath, URL } from 'node:url';
import { execSync } from 'node:child_process';

/**
 * Sello de versión. Como la app avisa en vez de actualizarse sola, podés estar
 * viendo una versión vieja sin darte cuenta — y ahí un bug ya arreglado "sigue
 * ahí". Con esto se sabe de un vistazo qué versión está corriendo.
 */
function sello(): string {
  let sha = 'local';
  try {
    sha = execSync('git rev-parse --short HEAD', { encoding: 'utf8' }).trim();
  } catch {
    // Sin git (o build desde un tarball): con la fecha alcanza.
  }
  const f = new Date();
  const dosDigitos = (n: number) => String(n).padStart(2, '0');
  return `${sha} · ${f.getFullYear()}-${dosDigitos(f.getMonth() + 1)}-${dosDigitos(f.getDate())} ${dosDigitos(f.getHours())}:${dosDigitos(f.getMinutes())}`;
}

// El `base` debe ser el nombre del repo cuando se publica en usuario.github.io/repo.
// Si publicás en un repo `usuario.github.io` (dominio raíz), cambiá base a '/'.
// Se puede sobreescribir con la variable de entorno BASE_PATH en el workflow de CI.
const base = process.env.BASE_PATH ?? '/mi-carrera/';

export default defineConfig({
  base,
  define: {
    __VERSION__: JSON.stringify(sello()),
  },
  plugins: [
    react(),
    tailwindcss(),
    VitePWA({
      // 'prompt', no 'autoUpdate': con autoUpdate la página se recarga sola
      // apenas se publica una versión, y si estabas en medio de un análisis
      // pesado (o escribiendo notas) lo perdías. Ahora avisa y vos decidís.
      // Contracara: te podés quedar en una versión vieja sin notarlo, y por eso
      // la versión que corre se muestra en el pie (ver __VERSION__).
      registerType: 'prompt',
      includeAssets: ['apple-touch-icon.png'],
      manifest: {
        name: 'Mi Carrera · UNLaM',
        short_name: 'Mi Carrera',
        description:
          'Planificá Ingeniería en Informática (UNLaM) y recibite lo antes posible.',
        lang: 'es',
        start_url: base,
        scope: base,
        display: 'standalone',
        background_color: '#0b1220',
        theme_color: '#3479f6',
        icons: [
          { src: 'icon-192.png', sizes: '192x192', type: 'image/png' },
          { src: 'icon-512.png', sizes: '512x512', type: 'image/png' },
          { src: 'icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
        ],
      },
      workbox: {
        // El worker de análisis y el de PDF son grandes: los precacheamos igual
        // para que la app ande completa sin internet.
        maximumFileSizeToCacheInBytes: 4 * 1024 * 1024,
        globPatterns: ['**/*.{js,css,html,svg,png,woff2}'],
        cleanupOutdatedCaches: true,
      },
    }),
  ],
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
  server: {
    // No vigilar archivos de datos que el usuario deja en la raíz (PDFs, HTML
    // de la oferta): en Windows pueden estar bloqueados y romper el watcher.
    watch: {
      ignored: ['**/*.pdf', '**/*Intraconsulta*.html', '**/*.local.json'],
    },
  },
  test: {
    environment: 'node',
    include: ['src/**/*.{test,spec}.ts'],
  },
});
