import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import App from './App.tsx';
import { ActualizarApp } from './components/ActualizarApp.tsx';
import { useStore } from './store/useStore';
import './index.css';

// Solo en desarrollo: poder inspeccionar el estado desde la consola ayuda
// muchísimo a diagnosticar "esto me cambió y no sé por qué".
if (import.meta.env.DEV) {
  (window as unknown as { __store: typeof useStore }).__store = useStore;
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
    {/* Instalable y usable sin internet. Cuando hay versión nueva avisa y
        recargás vos: nunca te corta lo que estabas haciendo. */}
    <ActualizarApp />
  </StrictMode>,
);
