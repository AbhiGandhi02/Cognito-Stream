/**
 * ThemeToggle — Sun/Moon pill that flips between dark and light. The two icons
 * cross-fade and counter-rotate on swap for a buttery transition.
 */

import { Moon, Sun } from 'lucide-react';
import { useTheme } from '../hooks/useTheme';

export function ThemeToggle({ className = '' }: { className?: string }) {
    const { theme, toggle } = useTheme();
    const isDark = theme === 'dark';

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
