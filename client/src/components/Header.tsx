/**
 * Header component — top navigation bar with brand identity and status.
 * Uses glassmorphism styling with a gradient brand accent.
 */

import { SparklesIcon } from '@heroicons/react/24/outline';

interface HeaderProps {
    isConnected: boolean;
}

export function Header({ isConnected }: HeaderProps) {
    return (
        <header className="glass sticky top-0 z-50 px-6 py-3 flex items-center justify-between">
            {/* Brand */}
            <div className="flex items-center gap-3">
                <div className="w-9 h-9 rounded-xl bg-gradient-to-br from-brand-400 to-accent-blue flex items-center justify-center shadow-lg shadow-brand-500/20">
                    <SparklesIcon className="w-5 h-5 text-white" />
                </div>
                <div>
                    <h1 className="text-lg font-bold tracking-tight gradient-text">
                        Cognito Stream
                    </h1>
                    <p className="text-[10px] text-surface-200/50 -mt-0.5 uppercase tracking-widest">
                        AI Video Engine
                    </p>
                </div>
            </div>

            {/* Status indicator */}
            <div className="flex items-center gap-2 text-xs">
                <div
                    className={`w-2 h-2 rounded-full ${isConnected
                            ? 'bg-accent-green shadow-sm shadow-accent-green/50'
                            : 'bg-accent-rose shadow-sm shadow-accent-rose/50'
                        }`}
                />
                <span className="text-surface-200/60">
                    {isConnected ? 'System Online' : 'Connecting...'}
                </span>
            </div>
        </header>
    );
}
