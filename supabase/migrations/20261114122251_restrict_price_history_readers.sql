begin;

create index if not exists product_price_history_changed_id_idx
on public.product_price_history(changed_at desc, id desc);

-- Intersect existing read policies; a general Bar read grant is not audit access.
do $migration$
begin
  if not exists (
    select 1 from pg_catalog.pg_policy
    where polrelid = 'public.product_price_history'::regclass
      and polname = 'price_history_authorized_read'
  ) then
    create policy price_history_authorized_read
    on public.product_price_history as restrictive
    for select to authenticated
    using ((
      select public.has_permission('bar.products.manage')
      or public.has_permission('bar.reports.view')
      or public.has_permission('bar.closing.manage')
    ));
  end if;
end;
$migration$;

commit;
