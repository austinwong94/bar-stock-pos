type Env = (name: string) => string | undefined;
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function createStaffAccountHandler(env: Env, send: typeof fetch = fetch) {
  return async (req: Request): Promise<Response> => {
    const origin = req.headers.get('origin') ?? '';
    const allowed = (env('STAFF_ACCOUNT_ALLOWED_ORIGINS') ?? '').split(',').map(v => v.trim()).filter(Boolean);
    const headers: Record<string, string> = {'Content-Type': 'application/json', 'Cache-Control': 'no-store', Vary: 'Origin'};
    if (origin && allowed.includes(origin)) Object.assign(headers, {
      'Access-Control-Allow-Origin': origin,
      'Access-Control-Allow-Headers': 'authorization, apikey, content-type, x-client-info',
      'Access-Control-Allow-Methods': 'POST, OPTIONS',
    });
    const reply = (status: number, body: unknown) => new Response(JSON.stringify(body), {status, headers});
    if (origin && !allowed.includes(origin)) return reply(403, {error: 'Origin not allowed.'});
    if (req.method === 'OPTIONS') return new Response(null, {status: 204, headers});
    if (req.method !== 'POST') return reply(405, {error: 'POST required.'});
    const url = env('SUPABASE_URL'), anon = env('SUPABASE_ANON_KEY'), service = env('SUPABASE_SERVICE_ROLE_KEY');
    if (!url || !anon || !service) return reply(503, {code: 'NOT_STARTED', error: 'Staff account setup is not connected yet.'});
    const authorization = req.headers.get('authorization') ?? '';
    if (!authorization.startsWith('Bearer ')) return reply(401, {error: 'Sign in first.'});
    const userHeaders = {Authorization: authorization, apikey: anon, 'Content-Type': 'application/json'};
    const adminHeaders = {Authorization: `Bearer ${service}`, apikey: service, 'Content-Type': 'application/json'};
    const request = (path: string, init: RequestInit = {}) => send(url + path, {...init, signal: AbortSignal.timeout(15000)});
    try {
      const identity = await request('/auth/v1/user', {headers: userHeaders});
      if (!identity.ok) return reply(401, {error: 'Sign in again.'});
      const actor = await identity.json();
      if (!actor.id || actor.is_anonymous) return reply(403, {error: 'A named administrator account is required.'});
      const permission = await request('/rest/v1/rpc/has_permission', {
        method: 'POST', headers: userHeaders, body: JSON.stringify({p_code: 'platform.users.manage'}),
      });
      if (!permission.ok || await permission.json() !== true) return reply(403, {error: 'User management access is required.'});
      const raw = await req.text();
      if (raw.length > 2000) return reply(400, {error: 'Invalid account details.'});
      const input = JSON.parse(raw);
      const {operation_id: id, username, full_name: name, role_code: role, password} = input;
      if (typeof id !== 'string' || !uuid.test(id) || typeof username !== 'string' ||
          !/^[a-z0-9][a-z0-9._-]{2,39}$/.test(username) || typeof name !== 'string' ||
          !name.trim() || name.length > 120 || typeof role !== 'string' || role.length > 60) {
        return reply(400, {error: 'Enter a name, valid username, role and password of 12-128 characters.'});
      }
      const email = `${username}@staff.lovely-paradise.invalid`;
      const metadata = {staff_provision_operation: id, staff_provision_actor: actor.id, staff_provision_role: role, staff_provision_name: name.trim()};
      // Preflight uses the caller's RLS and master-role guard before touching Auth.
      const roleCheck = await request('/rest/v1/access_roles?select=code,is_master&code=eq.' + encodeURIComponent(role), {headers: userHeaders});
      if (!roleCheck.ok) return reply(403, {error: 'Role could not be verified.'});
      const roles = await roleCheck.json();
      if (!roles.length || role === 'pending') return reply(400, {error: 'Choose an active staff role.'});
      if (roles[0].is_master) {
        const master = await request('/rest/v1/rpc/is_master_admin', {method: 'POST', headers: userHeaders, body: '{}'});
        if (!master.ok || await master.json() !== true) return reply(403, {error: 'Only the owner can create another owner.'});
      }
      let lookup = await request('/auth/v1/admin/users/' + id, {headers: adminHeaders});
      if (lookup.status === 404) {
        if (typeof password !== 'string' || password.length < 12 || password.length > 128) {
          return reply(400, {code: 'NOT_STARTED', error: 'No account was created. Enter a password of 12-128 characters.'});
        }
        const created = await request('/auth/v1/admin/users', {method: 'POST', headers: adminHeaders,
          body: JSON.stringify({id, email, password, email_confirm: true, app_metadata: metadata, user_metadata: {full_name: name.trim()}})});
        if (!created.ok) {
          // Another identical attempt may have won. Never adopt an unrelated username.
          lookup = await request('/auth/v1/admin/users/' + id, {headers: adminHeaders});
          if (!lookup.ok) return reply(409, {code: lookup.status === 404 && created.status === 422 ? 'NOT_STARTED' : 'UNCONFIRMED', error: 'Username already exists or account creation failed. Check the People list before changing the username.'});
        } else lookup = created;
      }
      if (!lookup.ok) return reply(503, {error: 'Could not verify the account. Retry this same request.'});
      const found = await lookup.json();
      const user = found.user ?? found;
      if (user.email !== email || Object.entries(metadata).some(([key, value]) => user.app_metadata?.[key] !== value)) {
        return reply(409, {error: 'This request does not match the saved account. No access was changed.'});
      }
      const activated = await request('/rest/v1/rpc/admin_activate_created_user', {
        method: 'POST', headers: userHeaders, body: JSON.stringify({p_user_id: id, p_operation_id: id}),
      });
      if (!activated.ok) return reply(409, {error: 'Account is saved but access could not be confirmed. Retry this same request; no duplicate account will be created.'});
      const profile = await activated.json();
      return reply(200, {user_id: profile.id, username, status: profile.status});
    } catch {
      // No credentials or provider error bodies enter logs or the response.
      return reply(503, {error: 'The account result is not confirmed. Retry the same request before creating another account.'});
    }
  };
}
