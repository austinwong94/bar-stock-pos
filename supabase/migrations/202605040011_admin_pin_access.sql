create extension if not exists pgcrypto;


-- Repair older access-code sessions that were accidentally promoted to admin.
update public.profiles
set role = 'manager', updated_at = now()
where role = 'admin'
  and app_access_granted = true
  and coalesce(full_name, 'Lovely Paradise Staff') = 'Lovely Paradise Staff';

-- Website access unlocks day-to-day bar use only. Product/settings admin access
-- is upgraded separately by verify_admin_access().
create or replace function public.verify_app_access(p_access_code text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  expected_hash constant text := '615ed7fb1504b0c724a296d7a69e6c7b2f9ea2c57c1d8206c5afdf392ebdfd25';
  profile_row public.profiles%rowtype;
begin
  if auth.uid() is null then
    raise exception 'Cloud session is not ready. Try entering the access code again.';
  end if;

  if encode(digest(coalesce(p_access_code, ''), 'sha256'), 'hex') <> expected_hash then
    raise exception 'Wrong access code.';
  end if;

  insert into public.profiles (id, full_name, role, app_access_granted, app_access_granted_at)
  values (auth.uid(), 'Lovely Paradise Staff', 'manager', true, now())
  on conflict (id) do update
    set role = case when public.profiles.role = 'admin' then 'admin' else 'manager' end,
        app_access_granted = true,
        app_access_granted_at = now(),
        updated_at = now()
  returning * into profile_row;

  insert into public.audit_logs(actor_id, action, entity_type, entity_id, after_json)
  values (auth.uid(), 'verify_app_access', 'profile', auth.uid(), jsonb_build_object('app_access_granted', true, 'role', profile_row.role));

  return to_jsonb(profile_row);
end;
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

  insert into public.profiles (id, full_name, role, app_access_granted, app_access_granted_at)
  values (auth.uid(), 'Lovely Paradise Staff', 'admin', true, now())
  on conflict (id) do update
    set role = 'admin',
        app_access_granted = true,
        app_access_granted_at = coalesce(public.profiles.app_access_granted_at, now()),
        updated_at = now()
  returning * into profile_row;

  insert into public.audit_logs(actor_id, action, entity_type, entity_id, after_json)
  values (auth.uid(), 'verify_admin_access', 'profile', auth.uid(), jsonb_build_object('role', 'admin'));

  return to_jsonb(profile_row);
end;
$$;

revoke execute on function public.verify_app_access(text) from public, anon;
revoke execute on function public.verify_admin_access(text) from public, anon;
grant execute on function public.verify_app_access(text) to authenticated;
grant execute on function public.verify_admin_access(text) to authenticated;
