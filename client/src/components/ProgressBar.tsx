import { useMemo } from 'react';

interface ProgressBarProps {
    value: number;
    status?: 'idle' | 'processing' | 'completed' | 'failed';
    showPercentage?: boolean;
    showLabel?: boolean;
    label?: string;
    size?: 'sm' | 'md' | 'lg';
}

export const ProgressBar = ({
    value,
    status = 'idle',
    showPercentage = true,
    showLabel = false,
    label,
    size = 'md',
}: ProgressBarProps) => {
    const clampedValue = Math.min(100, Math.max(0, value));

    const sizeClasses = useMemo(() => {
        switch (size) {
            case 'sm': return 'h-1.5';
            case 'lg': return 'h-3';
            default: return 'h-2';
        }
    }, [size]);

    const statusColor = useMemo(() => {
        switch (status) {
            case 'completed': return 'bg-gradient-to-r from-emerald-500 to-emerald-400';
            case 'failed': return 'bg-gradient-to-r from-red-500 to-red-400';
            case 'processing': return 'bg-gradient-to-r from-purple-500 via-purple-400 to-purple-500';
            default: return 'bg-gradient-to-r from-purple-600 to-purple-400';
        }
    }, [status]);

    const statusText = useMemo(() => {
        switch (status) {
            case 'completed': return 'Completed';
            case 'failed': return 'Failed';
            case 'processing': return 'Processing...';
            default: return 'Ready';
        }
    }, [status]);

    return (
        <div className="w-full">
            {(showLabel || showPercentage) && (
                <div className="mb-2 flex items-center justify-between text-sm">
                    {showLabel && (
                        <span className="text-slate-400">{label || statusText}</span>
                    )}
                    {showPercentage && (
                        <span className="font-semibold text-white">{Math.round(clampedValue)}%</span>
                    )}
                </div>
            )}

            <div className={`relative w-full overflow-hidden rounded-full bg-slate-800 ${sizeClasses}`}>
                <div
                    className={`absolute left-0 top-0 h-full rounded-full transition-all duration-500 ease-out ${statusColor}`}
                    style={{ width: `${clampedValue}%` }}
                />
            </div>

            {status === 'processing' && (
                <div className="mt-2 flex items-center gap-1">
                    <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-purple-500" style={{ animationDelay: '0ms' }} />
                    <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-purple-500" style={{ animationDelay: '150ms' }} />
                    <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-purple-500" style={{ animationDelay: '300ms' }} />
                </div>
            )}
        </div>
    );
};

export default ProgressBar;
