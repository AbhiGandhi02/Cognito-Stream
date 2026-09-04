/**
 * ThemeToggle — Sun/Moon pill that flips between dark and light. The two icons
 * cross-fade and counter-rotate on swap for a buttery transition.
 *
 * The `menuitem` variant renders the same control as a labelled row, for use
 * inside a dropdown menu where there is no room for the standalone pill.
 *
 * Theme state lives in `useTheme`, which is per-instance but localStorage-
 * backed, so a toggle that unmounts and remounts (e.g. moving between the bar
 * and a dropdown) picks the current theme back up on mount.
 */

import { Moon, Sun } from 'lucide-react';
import { useTheme } from '../hooks/useTheme';

export function ThemeToggle({
    className = '',
    variant = 'pill',
}: {
    className?: string;
    variant?: 'pill' | 'menuitem';
}) {
    const { theme, toggle } = useTheme();
    const isDark = theme === 'dark';

    if (variant === 'menuitem') {
        return (
            <button
                type="button"
                role="menuitem"
                onClick={toggle}
                aria-label={`Switch to ${isDark ? 'light' : 'dark'} theme`}
                className={`w-full flex items-center gap-2 px-3 py-2 rounded-lg text-sm text-slate-300 hover:text-slate-100 hover:bg-white/5 transition-colors ${className}`}
            >
                <span className="relative w-3.5 h-3.5 flex items-center justify-center shrink-0">
                    <Sun
                        className={`absolute w-3.5 h-3.5 transition-all duration-500 ease-out ${isDark ? 'opacity-0 -rotate-90 scale-50' : 'opacity-100 rotate-0 scale-100 text-amber-500'
                            }`}
                    />
                    <Moon
                        className={`absolute w-3.5 h-3.5 transition-all duration-500 ease-out ${isDark ? 'opacity-100 rotate-0 scale-100' : 'opacity-0 rotate-90 scale-50'
                            }`}
                    />
                </span>
                {isDark ? 'Light mode' : 'Dark mode'}
            </button>
        );
    }

    return (
        <button
            type="button"
            onClick={toggle}
            aria-label={`Switch to ${isDark ? 'light' : 'dark'} theme`}
            title={`Switch to ${isDark ? 'light' : 'dark'} theme`}
            className={`relative w-9 h-9 rounded-full flex items-center justify-center border border-white/10 bg-white/3 hover:bg-white/8 hover:border-white/20 transition-colors group ${className}`}
        >
            <Sun
                className={`absolute w-4 h-4 transition-all duration-500 ease-out ${isDark ? 'opacity-0 -rotate-90 scale-50' : 'opacity-100 rotate-0 scale-100 text-amber-500'
                    }`}
            />
            <Moon
                className={`absolute w-4 h-4 transition-all duration-500 ease-out ${isDark ? 'opacity-100 rotate-0 scale-100 text-slate-200' : 'opacity-0 rotate-90 scale-50'
                    }`}
            />
        </button>
    );
}
