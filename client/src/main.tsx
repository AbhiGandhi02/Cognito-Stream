import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import './index.css';
import App from './App';
import { applyThemeAttribute } from './hooks/useTheme';

// Apply persisted/system theme BEFORE React mounts so we don't flash the wrong
// palette for one frame. Mirrors the read in useTheme so the hook agrees.
(() => {
  try {
    const stored = window.localStorage.getItem('theme');
    if (stored === 'dark' || stored === 'light') {
      applyThemeAttribute(stored);
      return;
    }
    const prefersLight = window.matchMedia?.('(prefers-color-scheme: light)').matches;
    applyThemeAttribute(prefersLight ? 'light' : 'dark');
  } catch {
    applyThemeAttribute('dark');
  }
})();

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <BrowserRouter>
      <App />
    </BrowserRouter>
  </StrictMode>,
);
