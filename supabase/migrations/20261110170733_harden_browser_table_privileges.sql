-- Table-wide administration is not protected by row policies or needed by the app.
do $hardening$
declare
  relation record;
begin
  for relation in
    select n.nspname, c.relname
    from pg_catalog.pg_class c
    join pg_catalog.pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public' and c.relkind in ('r', 'p')
    order by c.oid
  loop
    execute pg_catalog.format(
      'revoke truncate, references, trigger on table %I.%I from public, anon, authenticated',
      relation.nspname, relation.relname
    );
    if pg_catalog.current_setting('server_version_num')::integer >= 170000 then
      execute pg_catalog.format(
        'revoke maintain on table %I.%I from public, anon, authenticated',
        relation.nspname, relation.relname
      );
    end if;
  end loop;

  execute 'alter default privileges in schema public revoke truncate, references, trigger on tables from public, anon, authenticated';
  if pg_catalog.current_setting('server_version_num')::integer >= 170000 then
    execute 'alter default privileges in schema public revoke maintain on tables from public, anon, authenticated';
  end if;
end;
$hardening$;

-- Both helpers use built-ins only; retain their bodies and invoker security.
alter function public.touch_updated_at() set search_path = pg_catalog, pg_temp;
alter function public.distance_km(numeric, numeric, numeric, numeric) set search_path = pg_catalog, pg_temp;
