create extension if not exists pgcrypto;

alter table public.profiles
  add column if not exists app_access_granted boolean not null default false,
  add column if not exists app_access_granted_at timestamptz;

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.profiles (id, full_name, role, app_access_granted, app_access_granted_at)
  values (
    new.id,
    coalesce(new.raw_user_meta_data->>'full_name', nullif(split_part(coalesce(new.email, ''), '@', 1), ''), 'Lovely Paradise Staff'),
    case
      when new.raw_user_meta_data->>'role' in ('cashier', 'manager', 'admin') then new.raw_user_meta_data->>'role'
      else 'cashier'
    end,
    false,
    null
  )
  on conflict (id) do update
    set full_name = coalesce(public.profiles.full_name, excluded.full_name);
  return new;
end;
$$;


drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
after insert on auth.users
for each row execute function public.handle_new_user();

create or replace function public.current_user_role()
returns text
language sql
stable
security definer
set search_path = public
as $$
  select coalesce((
    select case when app_access_granted then role else 'locked' end
    from public.profiles
    where id = auth.uid()
  ), 'locked')
$$;

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


insert into storage.buckets (id, name, public)
values ('payment-receipts', 'payment-receipts', false)
on conflict (id) do update set public = false;

-- Keep cloud data behind the verified app access role, not just anonymous Auth.
drop policy if exists "categories read authenticated" on public.categories;
create policy "categories read authenticated" on public.categories
for select to authenticated
using (public.current_user_role() in ('cashier', 'manager', 'admin'));

drop policy if exists "products read authenticated" on public.products;
create policy "products read authenticated" on public.products
for select to authenticated
using (public.current_user_role() in ('cashier', 'manager', 'admin'));

drop policy if exists "inventory read authenticated" on public.inventory_balances;
create policy "inventory read authenticated" on public.inventory_balances
for select to authenticated
using (public.current_user_role() in ('cashier', 'manager', 'admin'));

drop policy if exists "settings read authenticated" on public.app_settings;
create policy "settings read authenticated" on public.app_settings
for select to authenticated
using (public.current_user_role() in ('cashier', 'manager', 'admin'));

drop policy if exists "payment receipt upload authenticated" on storage.objects;
create policy "payment receipt upload authenticated" on storage.objects
for insert to authenticated
with check (bucket_id = 'payment-receipts' and public.current_user_role() in ('cashier', 'manager', 'admin'));

drop policy if exists "payment receipt read manager" on storage.objects;
create policy "payment receipt read manager" on storage.objects
for select to authenticated
using (bucket_id = 'payment-receipts' and public.current_user_role() in ('manager', 'admin'));

drop policy if exists "payment receipt delete own upload" on storage.objects;
create policy "payment receipt delete own upload" on storage.objects
for delete to authenticated
using (bucket_id = 'payment-receipts' and owner = auth.uid());

revoke execute on function public.verify_app_access(text) from public, anon;
grant execute on function public.verify_app_access(text) to authenticated;
grant execute on function public.current_user_role() to authenticated;
