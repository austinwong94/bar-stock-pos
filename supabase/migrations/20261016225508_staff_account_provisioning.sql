-- Auth creation stays server-only; the caller's identity governs activation.
create function public.admin_activate_created_user(p_user_id uuid, p_operation_id uuid)
returns public.profiles
language plpgsql volatile security definer set search_path = public, pg_temp
as $$
declare
  metadata jsonb;
  target public.profiles%rowtype;
begin
  perform public.require_permission('platform.users.manage');
  perform pg_advisory_xact_lock(hashtextextended('lovely-paradise-owner-access', 0));
  select raw_app_meta_data into metadata from auth.users where id = p_user_id;
  if metadata->>'staff_provision_actor' is distinct from auth.uid()::text
    or metadata->>'staff_provision_operation' is distinct from p_operation_id::text
    or p_user_id is distinct from p_operation_id then
    raise exception 'Account creation request does not belong to this administrator.' using errcode = '42501';
  end if;
  select * into target from public.profiles where id = p_user_id for update;
  if not found then raise exception 'Saved account profile is not available.'; end if;
  -- Replays never reset a later role or reactivate a suspended account.
  if target.status = 'suspended' then
    raise exception 'This account is suspended. Use its access settings.' using errcode = '42501';
  end if;
  if target.status = 'active' then return target; end if;
  if target.status <> 'pending' or target.is_anonymous
    or nullif(metadata->>'staff_provision_role', '') is null
    or metadata->>'staff_provision_role' = 'pending' then
    raise exception 'Account cannot be activated.' using errcode = '42501';
  end if;
  return public.admin_update_user(p_user_id,
    p_full_name => metadata->>'staff_provision_name',
    p_access_role_code => metadata->>'staff_provision_role', p_status => 'active');
end;
$$;
revoke all on function public.admin_activate_created_user(uuid, uuid) from public, anon;
grant execute on function public.admin_activate_created_user(uuid, uuid) to authenticated;

-- Serialize owner removal so two concurrent edits cannot remove the last owner.
alter function public.admin_update_user(uuid,text,text,text,uuid,text,boolean)
  rename to admin_update_user_before_account_setup;
revoke all on function public.admin_update_user_before_account_setup(uuid,text,text,text,uuid,text,boolean)
  from public, anon, authenticated;
create function public.admin_update_user(
  p_user_id uuid, p_full_name text default null, p_access_role_code text default null,
  p_status text default null, p_agency_id uuid default null, p_phone text default null,
  p_clear_agency boolean default false
) returns public.profiles
language plpgsql volatile security definer set search_path = public, pg_temp as $$
begin
  perform public.require_permission('platform.users.manage');
  perform pg_advisory_xact_lock(hashtextextended('lovely-paradise-owner-access', 0));
  perform public.require_permission('platform.users.manage');
  if exists(select 1 from public.profiles p join public.access_roles r on r.code=p.access_role_code
    where p.id=p_user_id and p.status='active' and r.is_master)
    and (coalesce(p_status,'active') <> 'active' or (p_access_role_code is not null
      and not exists(select 1 from public.access_roles where code=p_access_role_code and is_master)))
    and (select count(*) from public.profiles p join public.access_roles r on r.code=p.access_role_code
      where p.status='active' and r.is_master and not p.is_anonymous) <= 1 then
    raise exception 'Keep at least one active owner. Create another owner before removing this access.' using errcode='42501';
  end if;
  return public.admin_update_user_before_account_setup(p_user_id,p_full_name,p_access_role_code,
    p_status,p_agency_id,p_phone,p_clear_agency);
end;
$$;
revoke all on function public.admin_update_user(uuid,text,text,text,uuid,text,boolean) from public,anon;
grant execute on function public.admin_update_user(uuid,text,text,text,uuid,text,boolean) to authenticated;
