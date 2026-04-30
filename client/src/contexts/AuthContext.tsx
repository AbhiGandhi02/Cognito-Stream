/**
 * AuthContext — exposes the current Supabase session, user, and helpers.
 *
 * Wrap the app once in <AuthProvider> and call useAuth() anywhere.
 * The provider listens to onAuthStateChange so sign in/out is reflected
 * across the whole tree without manual reloads.
 */

import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';
import type { Session, User } from '@supabase/supabase-js';
import { supabase } from '../lib/supabase';

interface AuthContextValue {
    /** Loading on first mount while we read the persisted session. */
    loading: boolean;
    session: Session | null;
    user: User | null;

    signInWithGoogle: () => Promise<void>;
    signInWithPassword: (email: string, password: string) => Promise<void>;
    signUp: (email: string, password: string) => Promise<void>;
    signOut: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | undefined>(undefined);

export function AuthProvider({ children }: { children: ReactNode }) {
    const [loading, setLoading] = useState(true);
    const [session, setSession] = useState<Session | null>(null);

    useEffect(() => {
        // 1) Read the persisted session on mount.
        supabase.auth.getSession().then(({ data }) => {
            setSession(data.session ?? null);
            setLoading(false);
        });

        // 2) Subscribe to future changes (sign in / out / token refresh).
        const { data: subscription } = supabase.auth.onAuthStateChange((_event, newSession) => {
            setSession(newSession);
        });

        return () => subscription.subscription.unsubscribe();
    }, []);

    const value: AuthContextValue = {
        loading,
        session,
        user: session?.user ?? null,

        async signInWithGoogle() {
            const { error } = await supabase.auth.signInWithOAuth({
                provider: 'google',
                options: {
                    // Where Supabase sends the user back after the OAuth dance completes.
                    // Must match an entry in Supabase Dashboard → Auth → URL Configuration → Redirect URLs.
                    redirectTo: `${window.location.origin}/dashboard`,
                },
            });
            if (error) throw error;
            // The browser is now redirecting to Google — no further work here.
        },

        async signInWithPassword(email, password) {
            const { error } = await supabase.auth.signInWithPassword({ email, password });
            if (error) throw error;
        },

        async signUp(email, password) {
            const { error } = await supabase.auth.signUp({ email, password });
            if (error) throw error;
        },

        async signOut() {
            const { error } = await supabase.auth.signOut();
            if (error) throw error;
        },
    };

    return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
    const ctx = useContext(AuthContext);
    if (!ctx) throw new Error('useAuth must be used inside <AuthProvider>');
    return ctx;
}
