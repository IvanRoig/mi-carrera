import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import { fileURLToPath, URL } from 'node:url';

// El `base` debe ser el nombre del repo cuando se publica en usuario.github.io/repo.
// Si publicás en un repo `usuario.github.io` (dominio raíz), cambiá base a '/'.
// Se puede sobreescribir con la variable de entorno BASE_PATH en el workflow de CI.
const base = process.env.BASE_PATH ?? '/mi-carrera/';

export default defineConfig({
  base,
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
  test: {
    environment: 'node',
    include: ['src/**/*.{test,spec}.ts'],
  },
});
