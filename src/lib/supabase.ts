import { createClient } from '@supabase/supabase-js';
import type { Database } from './types';
import { createDemoClient } from './demoClient';

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL as string | undefined;
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined;

// Offline showcase build. Never set in a build that carries real credentials.
export const isDemoMode = import.meta.env.VITE_DEMO_MODE === 'true';

const hasRealCredentials = Boolean(supabaseUrl && supabaseAnonKey) && !isDemoMode;
export const hasSupabaseCredentials = hasRealCredentials || isDemoMode;

if (!hasSupabaseCredentials) {
  // Vite still renders the app; pages show a clearer setup message.
  console.warn('Missing VITE_SUPABASE_URL or VITE_SUPABASE_ANON_KEY.');
}

// `supabase` has to be created synchronously, so the demo client is a static
// import and rides along in a production bundle (a few KB of fake sample
// rows, never reached because the flag is false). The demo *UI* is code split
// out of the main chunk in App.tsx.
export const supabase = (
  import.meta.env.VITE_DEMO_MODE === 'true'
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
