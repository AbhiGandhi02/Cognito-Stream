/**
 * Singleton Supabase client. Reads the project URL and anon key from Vite
 * env vars. The anon key is intentionally public — it only grants access
 * permitted by Row-Level Security policies on the database.
 */

import { createClient } from '@supabase/supabase-js';

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;

if (!supabaseUrl || !supabaseAnonKey) {
    // Fail loud in dev so missing env vars surface immediately.
    throw new Error(
        'Missing VITE_SUPABASE_URL or VITE_SUPABASE_ANON_KEY in client/.env. ' +
        'Find them in Supabase Dashboard → Project Settings → API.'
    );
}

export const supabase = createClient(supabaseUrl, supabaseAnonKey, {
    auth: {
        // Persist session in localStorage and refresh token automatically.
        autoRefreshToken: true,
        persistSession: true,
        detectSessionInUrl: true,
    },
});
