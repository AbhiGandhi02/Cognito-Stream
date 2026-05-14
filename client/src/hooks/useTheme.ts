/**
 * useTheme — dark/light theme controller.
 *
 * Reads localStorage on init (key: "theme"), then falls back to the user's
 * system preference. Persists every change. The CSS in index.css is driven by
 * `[data-theme]` on <html>, so toggling re-skins the entire app via vars.
 */

import { useCallback, useEffect, useState } from 'react';

export type Theme = 'dark' | 'light';

const STORAGE_KEY = 'theme';

function readInitial(): Theme {
    if (typeof window === 'undefined') return 'dark';
    const stored = window.localStorage.getItem(STORAGE_KEY);
    if (stored === 'dark' || stored === 'light') return stored;
    if (window.matchMedia?.('(prefers-color-scheme: light)').matches) return 'light';
    return 'dark';
}

/** Apply the data-theme attribute synchronously. Called from main.tsx before
 * React mounts to avoid a one-frame flash of the wrong theme. */
export function applyThemeAttribute(theme: Theme): void {
    document.documentElement.setAttribute('data-theme', theme);
}

export function useTheme(): { theme: Theme; setTheme: (t: Theme) => void; toggle: () => void } {
    const [theme, setThemeState] = useState<Theme>(() => readInitial());

    useEffect(() => {
        applyThemeAttribute(theme);
        try {
            window.localStorage.setItem(STORAGE_KEY, theme);
        } catch { /* private mode / quota — ignore */ }
    }, [theme]);

    const setTheme = useCallback((t: Theme) => setThemeState(t), []);
    const toggle = useCallback(() => setThemeState((t) => (t === 'dark' ? 'light' : 'dark')), []);

    return { theme, setTheme, toggle };
}
