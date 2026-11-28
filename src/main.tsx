import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { registerSW } from 'virtual:pwa-register';
import App from './App';
import { db, ensureSeed } from './db/db';
import { initAccount } from './sync/state';
import './styles.css';

registerSW({ immediate: true });
initAccount();

const boot = window as unknown as { __bootOk?: () => void; __bootFail?: (msg: string) => void };

// A newer version of the app wants to upgrade the database: let it, and reload onto the new version.
db.on('versionchange', () => {
  db.close();
  location.reload();
});
// This version needs to upgrade the database, but an older copy of the app still has it open.
db.on('blocked', () => {
  boot.__bootFail?.('An older copy of the app is open in another tab or window and is blocking this update. Close the other copy, then tap Try again.');
});

// Don't let a slow or stuck database keep the screen blank: the seed finishes in the background if it has to.
const seeded = ensureSeed().catch((e) => console.error('Failed to seed exercise library', e));
Promise.race([seeded, new Promise((r) => setTimeout(r, 4000))]).then(() => {
  navigator.storage?.persist?.().catch(() => {});
  createRoot(document.getElementById('root')!).render(
    <StrictMode>
      <App />
    </StrictMode>,
  );
  // The app only counts as started once the database answers; until then the start-up page can still explain a hang.
  seeded.then(() => boot.__bootOk?.());
});
