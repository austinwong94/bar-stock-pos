import { isSupabaseConfigured, supabase } from './supabase';

const adminSessionKey = 'lovely_paradise_admin_access';
const adminPasswordHash = '90727dcc85c0513b949e872edf5434fe14e7a8a17f64fdb3271d721e73d74911';
const fallbackAdminMs = 2 * 60 * 60 * 1000;

async function sha256(value: string) {
  const bytes = new TextEncoder().encode(value);
  const hashBuffer = await crypto.subtle.digest('SHA-256', bytes);
  return Array.from(new Uint8Array(hashBuffer))
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('');
}

function saveAdminAccess(expiresAt?: string | null) {
  sessionStorage.setItem(
    adminSessionKey,
    JSON.stringify({ expiresAt: expiresAt ?? new Date(Date.now() + fallbackAdminMs).toISOString() }),
  );
}

export function hasAdminAccess() {
  const raw = sessionStorage.getItem(adminSessionKey);
  if (!raw) return false;
  if (raw === 'ok') {
    clearAdminAccess();
    return false;
  }
  try {
    const parsed = JSON.parse(raw) as { expiresAt?: string };
    if (parsed.expiresAt && new Date(parsed.expiresAt).getTime() > Date.now()) return true;
  } catch {
    // Fall through and clear malformed access state.
  }
  clearAdminAccess();
  return false;
}

export function clearAdminAccess() {
  sessionStorage.removeItem(adminSessionKey);
  Object.keys(sessionStorage)
    .filter((key) => key.startsWith('lovely_paradise_report_edit:'))
    .forEach((key) => sessionStorage.removeItem(key));
}

export async function unlockAdminAccess(password: string): Promise<{ ok: true } | { ok: false; error: string }> {
  const trimmed = password.trim();
  if (!trimmed) return { ok: false, error: 'Enter admin password.' };

  if (!isSupabaseConfigured) {
    if (await sha256(trimmed) !== adminPasswordHash) {
      return { ok: false, error: 'Wrong admin password.' };
    }
    saveAdminAccess();
    return { ok: true };
  }

  const { data, error } = await supabase.rpc('verify_admin_access', { p_admin_password: trimmed });
  if (error) {
    const message = error.message.toLowerCase();
    return {
      ok: false,
      error: message.includes('function') || message.includes('column')
        ? 'Ask the administrator to apply the latest database migrations, then try again.'
        : error.message,
    };
  }

  saveAdminAccess(data?.admin_access_expires_at ?? null);
  window.dispatchEvent(new Event('access-refresh'));
  return { ok: true };
}
