-- Report helpers run only through the permission-checked archive entry points.
revoke all on function public.account_report_archive_kitchen_sections(date,date),
  public.account_report_archive_exception_sections(date,date),
  public.account_report_archive_stock_in_draft_sections(date,date)
  from public, anon, authenticated;

revoke all on function public.generate_account_report_archive(text,date,date),
  public.refresh_due_account_report_archives() from public, anon;
grant execute on function public.generate_account_report_archive(text,date,date),
  public.refresh_due_account_report_archives() to authenticated;

do $$
declare r record; definition text; guarded text;
begin
  for r in select p.oid from pg_proc p join pg_namespace n on n.oid=p.pronamespace
    where n.nspname='public' and p.proname in ('generate_account_report_archive','refresh_due_account_report_archives')
  loop
    definition := pg_get_functiondef(r.oid);
    guarded := regexp_replace(definition,
      'if auth.uid\(\) is not null and public.current_user_role\(\) not in \(''manager'', ''admin''\) then\s+raise exception ''Manager or admin permission is required.'';\s+end if;',
      'if auth.uid() is not null then perform public.require_permission(''bar.reports.view''); end if;', 'g');
    if guarded=definition then raise exception 'Expected report permission guard was not found'; end if;
    execute guarded;
  end loop;
end $$;

drop policy if exists "account report archives manager read" on public.account_report_archives;
create policy "account report archives permission read" on public.account_report_archives
  for select to authenticated using (public.has_permission('bar.reports.view'));
