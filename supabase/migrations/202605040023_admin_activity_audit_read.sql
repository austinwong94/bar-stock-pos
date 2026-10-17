-- Let the Admin activity screen read audit logs while RLS still keeps them admin-only.
grant select on public.audit_logs to authenticated;

drop policy if exists "audit admin read" on public.audit_logs;
create policy "audit admin read" on public.audit_logs
for select to authenticated
using (public.current_user_role() = 'admin');

do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    begin
      alter publication supabase_realtime add table public.audit_logs;
    exception
      when duplicate_object then null;
      when undefined_table then null;
    end;
  end if;
end $$;
