/**
 * useMe — fetch the current user's profile (including role) from the
 * server. Refetches whenever the Supabase session changes so role
 * updates surface without a manual refresh.
 */

import { useEffect, useState } from 'react';
import { useAuth } from '../contexts/AuthContext';
import { api } from '../services/api';

export type AppRole = 'USER' | 'ADMIN';

export interface MeProfile {
    id: string;
    email: string;
    role: AppRole;
}

export function useMe() {
    const { session } = useAuth();
    const [me, setMe] = useState<MeProfile | null>(null);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState<string>();

    useEffect(() => {
        if (!session) {
            setMe(null);
            return;
        }
        let cancelled = false;
        setLoading(true);
        setError(undefined);
        api.getMe()
            .then((profile) => {
                if (!cancelled) setMe(profile);
            })
            .catch((err) => {
                if (!cancelled) setError((err as Error).message);
            })
            .finally(() => {
                if (!cancelled) setLoading(false);
            });
        return () => {
            cancelled = true;
        };
    }, [session]);

    return {
        me,
        loading,
        error,
        isAdmin: me?.role === 'ADMIN',
    };
}
