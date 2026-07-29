import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { registerSW } from 'virtual:pwa-register';
import App from './App.tsx';
import './index.css';

// Instalable y usable sin internet. Si publicamos una versión nueva, se baja
// sola y se aplica al recargar: nunca te quedás con una versión vieja pegada.
registerSW({ immediate: true });

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
