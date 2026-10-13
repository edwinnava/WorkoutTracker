import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { registerSW } from 'virtual:pwa-register';
import App from './App';
import { ensureSeed } from './db/db';
import { initAccount } from './sync/state';
import './styles.css';

registerSW({ immediate: true });
initAccount();

ensureSeed()
  .catch((e) => console.error('Failed to seed exercise library', e))
  .finally(() => {
    navigator.storage?.persist?.().catch(() => {});
    createRoot(document.getElementById('root')!).render(
      <StrictMode>
        <App />
      </StrictMode>,
    );
  });
