/**
 * ErrorBanner — inline error box with the cause as a headline.
 * Error state is a plain string across the pages; ApiError formats it as
 * "<reason>: <detail>" (and call sites prefix "Rename failed: …"), so the
 * text before the first ": " is the headline and the rest the detail.
 */

import { AlertCircle } from 'lucide-react';

interface ErrorBannerProps {
    message: string;
    className?: string;
}

export function ErrorBanner({ message, className = '' }: ErrorBannerProps) {
    const split = message.indexOf(': ');
    const title = split > 0 ? message.slice(0, split) : null;
    const detail = split > 0 ? message.slice(split + 2) : message;

    return (
        <div
            role="alert"
            className={`flex gap-3 rounded-xl border border-danger/20 bg-danger/10 px-4 py-3 text-sm text-danger ${className}`}
        >
            <AlertCircle className="w-4 h-4 mt-0.5 shrink-0" />
            <div className="space-y-0.5">
                {title && <p className="font-medium">{title}</p>}
                <p className={title ? 'text-danger/80' : undefined}>{detail}</p>
            </div>
        </div>
    );
}
