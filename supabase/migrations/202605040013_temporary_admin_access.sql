create extension if not exists pgcrypto;

alter table public.profiles
  add column if not exists admin_access_expires_at timestamptz;

-- Older access-code-only anonymous sessions may have been promoted to admin.
-- Keep those sessions usable as manager, but require the Admin password again
-- for product/settings/report edits.
update public.profiles
set role = 'manager',
    admin_access_expires_at = null,
    updated_at = now()
where role = 'admin'
  and app_access_granted = true
  and coalesce(full_name, 'Lovely Paradise Staff') = 'Lovely Paradise Staff';

create or replace function public.current_user_role()
returns text
language sql
stable
security definer
set search_path = public
as $$
  select coalesce((
    select case
      when not app_access_granted then 'locked'
      when role = 'admin' and coalesce(admin_access_expires_at, 'infinity'::timestamptz) > now() then 'admin'
      when role = 'admin' then 'manager'
      else role
    end
    from public.profiles
    where id = auth.uid()
  ), 'locked')
$$;

create or replace function public.verify_admin_access(p_admin_password text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  expected_hash constant text := '90727dcc85c0513b949e872edf5434fe14e7a8a17f64fdb3271d721e73d74911';
  profile_row public.profiles%rowtype;
begin
  if auth.uid() is null then
    raise exception 'Cloud session is not ready. Enter the website access code first.';
  end if;

  if encode(digest(coalesce(p_admin_password, ''), 'sha256'), 'hex') <> expected_hash then
    raise exception 'Wrong admin password.';
  end if;

  insert into public.profiles (id, full_name, role, app_access_granted, app_access_granted_at, admin_access_expires_at)
  values (auth.uid(), 'Lovely Paradise Staff', 'admin', true, now(), now() + interval '2 hours')
  on conflict (id) do update
    set role = 'admin',
        app_access_granted = true,
        app_access_granted_at = coalesce(public.profiles.app_access_granted_at, now()),
        admin_access_expires_at = now() + interval '2 hours',
        updated_at = now()
  returning * into profile_row;

  insert into public.audit_logs(actor_id, action, entity_type, entity_id, after_json)
  values (auth.uid(), 'verify_admin_access', 'profile', auth.uid(), jsonb_build_object('role', 'admin', 'expires_at', profile_row.admin_access_expires_at));

  return to_jsonb(profile_row);
end;
$$;

drop policy if exists "profiles admin update" on public.profiles;
create policy "profiles admin update" on public.profiles
for update to authenticated
using (public.current_user_role() = 'admin')
with check (public.current_user_role() = 'admin');

drop policy if exists "categories admin write" on public.categories;
create policy "categories admin write" on public.categories
for all to authenticated
using (public.current_user_role() = 'admin')
with check (public.current_user_role() = 'admin');

drop policy if exists "products admin write" on public.products;
create policy "products admin write" on public.products
for all to authenticated
using (public.current_user_role() = 'admin')
with check (public.current_user_role() = 'admin');

drop policy if exists "settings admin write" on public.app_settings;
create policy "settings admin write" on public.app_settings
for all to authenticated
using (public.current_user_role() = 'admin')
with check (public.current_user_role() = 'admin');

revoke execute on function public.verify_admin_access(text) from public, anon;
grant execute on function public.verify_admin_access(text) to authenticated;
grant execute on function public.current_user_role() to authenticated;
