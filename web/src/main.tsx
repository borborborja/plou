import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import 'leaflet/dist/leaflet.css';
import { App } from './App';
import { registerServiceWorker } from './lib/push';
import { StoreProvider } from './store';
import './styles.css';

const container = document.getElementById('root');
if (!container) throw new Error('Falta el contenedor #root');

createRoot(container).render(
  <StrictMode>
    <StoreProvider>
      <App />
    </StoreProvider>
  </StrictMode>,
);

// El service worker atiende los avisos push aunque la pestaña esté cerrada.
void registerServiceWorker();
