import { createClient } from '@supabase/supabase-js';
import type { Database } from './types';
import { createDemoClient } from './demoClient';

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL as string | undefined;
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined;

// Offline showcase build. Never set in a build that carries real credentials.
export const isDemoMode = import.meta.env.VITE_DEMO_MODE === 'true' ||
  (import.meta.env.DEV && import.meta.env.VITE_DATA_MODE !== 'cloud');
export const shouldUseLocalData = isDemoMode;
export const isLocalPreviewRequested = isDemoMode;

const hasRealCredentials = Boolean(supabaseUrl && supabaseAnonKey) && !isDemoMode;
export const hasSupabaseCredentials = hasRealCredentials || isDemoMode;

if (!hasSupabaseCredentials) {
  // Vite still renders the app; pages show a clearer setup message.
  console.warn('Missing VITE_SUPABASE_URL or VITE_SUPABASE_ANON_KEY.');
}

// The factory stays synchronous. Vite replaces the preview import with a
// fail-closed stub in cloud builds so no sample database is initialised.
export const supabase = (
  isDemoMode
    ? createDemoClient()
    : createClient<Database>(
        supabaseUrl ?? 'https://placeholder.supabase.co',
        supabaseAnonKey ?? 'placeholder-anon-key',
        {
          auth: {
            persistSession: true,
            autoRefreshToken: true,
            detectSessionInUrl: true,
          },
        },
      )
) as any;

// The bar pages fall back to their own local store when this is false, which
// is exactly what the demo build wants.
export let isSupabaseConfigured = hasRealCredentials;

export function setPublicPreviewMode(enabled: boolean) {
  isSupabaseConfigured = hasRealCredentials && !enabled;
}

export function setDataMode(mode: 'local' | 'cloud') {
  // Production writes always use the cloud. Practice data belongs to its own build.
  if (mode === 'cloud' && !isDemoMode) window.location.reload();
}
