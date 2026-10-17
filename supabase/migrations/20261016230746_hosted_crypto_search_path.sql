-- Hosted Supabase installs pgcrypto under extensions; local fixtures use public.
-- Keep the two legacy PIN verifiers compatible without moving the extension.
do $$
declare crypto_schema text; signature regprocedure;
begin
  select n.nspname into strict crypto_schema from pg_extension e
    join pg_namespace n on n.oid=e.extnamespace where e.extname='pgcrypto';
  foreach signature in array array[
    'public.verify_app_access(text)'::regprocedure,
    'public.verify_admin_access(text)'::regprocedure
  ] loop
    execute format('alter function %s set search_path = public, %I, pg_temp',signature,crypto_schema);
  end loop;
end;
$$;
