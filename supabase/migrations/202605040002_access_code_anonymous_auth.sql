create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.profiles (id, full_name, role)
  values (
    new.id,
    coalesce(new.raw_user_meta_data->>'full_name', nullif(split_part(coalesce(new.email, ''), '@', 1), ''), 'Lovely Paradise Staff'),
    case
      when new.raw_user_meta_data->>'role' in ('cashier', 'manager', 'admin') then new.raw_user_meta_data->>'role'
      else 'admin'
    end
  )
  on conflict (id) do nothing;
  return new;
end;
$$;

create or replace function public.current_user_role()
returns text
language sql
stable
security definer
set search_path = public
as $$
  select coalesce((select role from public.profiles where id = auth.uid()), 'admin')
$$;

do $$
begin
  if exists (
    select 1
    from information_schema.columns
    where table_schema = 'auth'
      and table_name = 'users'
      and column_name = 'is_anonymous'
  ) then
    execute $sql$
      update public.profiles p
      set
        role = 'admin',
        full_name = coalesce(nullif(p.full_name, ''), 'Lovely Paradise Staff')
      from auth.users u
      where u.id = p.id
        and coalesce(u.is_anonymous, false) = true
    $sql$;
  end if;
end $$;
