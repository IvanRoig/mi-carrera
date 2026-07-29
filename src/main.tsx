import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import App from './App.tsx';
import { ActualizarApp } from './components/ActualizarApp.tsx';
import './index.css';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
    {/* Instalable y usable sin internet. Cuando hay versión nueva avisa y
        recargás vos: nunca te corta lo que estabas haciendo. */}
    <ActualizarApp />
  </StrictMode>,
);
