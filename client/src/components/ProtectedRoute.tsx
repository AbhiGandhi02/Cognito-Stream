/**
 * ProtectedRoute — guards routes that require authentication.
 * Redirects to /login when there's no session, preserving the
 * intended destination so we can bounce the user back after sign-in.
 */

import { Navigate, useLocation } from 'react-router-dom';
import type { ReactNode } from 'react';
import { useAuth } from '../contexts/AuthContext';

export function ProtectedRoute({ children }: { children: ReactNode }) {
    const { loading, session } = useAuth();
    const location = useLocation();

    // Avoid flashing the login page during initial session restore.
    if (loading) {
        return (
            <div className="min-h-screen bg-navy-950 flex items-center justify-center text-sm text-slate-500">
                Loading…
            </div>
        );
    }

    if (!session) {
        return (
            <Navigate
                to="/login"
                replace
                state={{ from: location.pathname + location.search }}
            />
        );
    }

    return <>{children}</>;
}
