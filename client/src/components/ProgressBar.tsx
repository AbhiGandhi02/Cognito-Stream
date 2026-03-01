/**
 * ProgressBar — animated progress indicator with percentage.
 * Used during storyboard processing to show global progress.
 */

interface ProgressBarProps {
    progress: number;  // 0-100
    label?: string;
    compact?: boolean;
}

export function ProgressBar({ progress, label, compact = false }: ProgressBarProps) {
    const clamped = Math.max(0, Math.min(100, progress));

    if (compact) {
        return (
            <div className="flex items-center gap-2">
                <div className="flex-1 h-1 rounded-full bg-navy-800 overflow-hidden">
                    <div
                        className="h-full rounded-full bg-gradient-to-r from-primary-500 to-info transition-all duration-500 ease-out"
                        style={{ width: `${clamped}%` }}
                    />
                </div>
                <span className="text-[10px] text-slate-600 font-mono w-8 text-right">
                    {Math.round(clamped)}%
                </span>
            </div>
        );
    }

    return (
        <div className="glass-light rounded-xl p-4 space-y-2">
            <div className="flex items-center justify-between">
                <span className="text-xs font-medium text-slate-500">
                    {label || 'Processing'}
                </span>
                <span className="text-xs font-mono text-primary-300">
                    {Math.round(clamped)}%
                </span>
            </div>

            <div className="h-2 rounded-full bg-navy-800/80 overflow-hidden">
                <div
                    className="h-full rounded-full bg-gradient-to-r from-primary-500 via-primary-400 to-info transition-all duration-700 ease-out relative"
                    style={{ width: `${clamped}%` }}
                >
                    {/* Shimmer effect */}
                    <div className="absolute inset-0 bg-gradient-to-r from-transparent via-white/20 to-transparent animate-[shimmer_2s_infinite]" />
                </div>
            </div>

            {clamped < 100 && (
                <p className="text-[10px] text-slate-700">
                    Generating scenes, rendering, and processing audio...
                </p>
            )}
        </div>
    );
}
