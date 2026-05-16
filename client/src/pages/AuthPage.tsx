/**
 * AuthPage — minimal Google-only sign-in page.
 * Both /login and /signup render this; with Google OAuth the distinction
 * disappears — the same flow handles new users and returning users.
 */

import { useEffect, useState } from 'react';
import { Link, useNavigate, useLocation } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import { AlertCircle, Loader2 } from 'lucide-react';

interface AuthPageProps {
    mode: 'login' | 'signup';
}

export function AuthPage({ mode }: AuthPageProps) {
    const navigate = useNavigate();
    const location = useLocation();
    const { signInWithGoogle, session, loading: authLoading } = useAuth();

    const [submitting, setSubmitting] = useState(false);
    const [error, setError] = useState<string>();

    // Already signed in? Go where they were headed; default to landing page.
    useEffect(() => {
        if (!authLoading && session) {
            const redirectTo = (location.state as { from?: string } | null)?.from || '/';
            navigate(redirectTo, { replace: true });
        }
    }, [authLoading, session, navigate, location.state]);

    const handleGoogle = async () => {
        setError(undefined);
        setSubmitting(true);
        try {
            await signInWithGoogle();
            // signInWithOAuth redirects the browser to Google — code below this
            // line typically doesn't run because the page is unloading.
        } catch (err) {
            setError(err instanceof Error ? err.message : 'Sign-in failed');
            setSubmitting(false);
        }
    };

    const isLogin = mode === 'login';

    return (
        <div className="min-h-screen bg-navy-950 text-slate-100 flex items-center justify-center px-6">
            <div className="w-full max-w-sm">
                <Link to="/" className="flex items-center justify-center gap-2 mb-10 group">
                    <img
                        src="/image.png"
                        alt="Cognito Stream"
                        className="w-7 h-7 rounded-md object-cover"
                    />
                    <span className="text-sm font-medium text-slate-200 tracking-tight">
                        Cognito Stream
                    </span>
                </Link>

                <div className="space-y-1.5 mb-8 text-center">
                    <h1 className="text-2xl font-semibold tracking-tight text-slate-100">
                        {isLogin ? 'Sign in to continue' : 'Get started'}
                    </h1>
                    <p className="text-sm text-slate-500">
                        {isLogin
                            ? 'Pick up where you left off.'
                            : 'Sign in with your Google account — no password to remember.'}
                    </p>
                </div>

                <button
                    onClick={handleGoogle}
                    disabled={submitting}
                    className="w-full flex items-center justify-center gap-3 rounded-lg bg-white text-slate-900 font-medium text-sm py-3 border border-white/15 hover:bg-slate-50 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                >
                    {submitting ? (
                        <>
                            <Loader2 className="w-4 h-4 animate-spin" />
                            Redirecting to Google…
                        </>
                    ) : (
                        <>
                            <GoogleG />
                            Continue with Google
                        </>
                    )}
                </button>

                {error && (
                    <div className="mt-4 rounded-lg border border-danger/30 bg-danger/10 px-3 py-2 text-xs text-danger flex items-start gap-2">
                        <AlertCircle className="w-3.5 h-3.5 mt-0.5 shrink-0" />
                        <span>{error}</span>
                    </div>
                )}

                <p className="mt-8 text-center text-[11px] text-slate-600 leading-relaxed">
                    By continuing, you agree to the terms of service and acknowledge that your
                    Google email will be used to associate generated videos with your account.
                </p>
            </div>
        </div>
    );
}

/** Google "G" multi-color logo, drawn inline so we don't need a brand asset. */
function GoogleG() {
    return (
        <svg width="18" height="18" viewBox="0 0 18 18" aria-hidden="true">
            <path
                fill="#4285F4"
                d="M17.64 9.2c0-.64-.06-1.25-.16-1.84H9v3.48h4.84a4.14 4.14 0 0 1-1.8 2.71v2.26h2.92c1.71-1.57 2.69-3.89 2.69-6.61z"
            />
            <path
                fill="#34A853"
                d="M9 18c2.43 0 4.47-.81 5.96-2.18l-2.92-2.26c-.8.54-1.83.86-3.04.86-2.34 0-4.32-1.58-5.03-3.7H.96v2.32A8.99 8.99 0 0 0 9 18z"
            />
            <path
                fill="#FBBC05"
                d="M3.97 10.71A5.4 5.4 0 0 1 3.68 9c0-.6.1-1.18.29-1.71V4.97H.96A8.98 8.98 0 0 0 0 9c0 1.45.35 2.83.96 4.03l3.01-2.32z"
            />
            <path
                fill="#EA4335"
                d="M9 3.58c1.32 0 2.5.45 3.44 1.35l2.58-2.58A8.99 8.99 0 0 0 .96 4.97L3.97 7.3C4.68 5.18 6.66 3.58 9 3.58z"
            />
        </svg>
    );
}
