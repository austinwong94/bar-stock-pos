-- =====================================================================
-- The generic audit trigger read new.id, which does not exist on tables
-- keyed by something else. tourist_private is keyed by tourist_id, so
-- writing a passport number raised "record has no field id".
-- =====================================================================
create or replace function public.audit_row_change()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_name text;
  v_row jsonb;
  v_entity uuid;
begin
  select full_name into v_name from public.profiles where id = auth.uid();

  v_row := case when tg_op = 'DELETE' then to_jsonb(old) else to_jsonb(new) end;

  -- Take whichever key the table actually uses.
  v_entity := coalesce(
    nullif(v_row->>'id', ''),
    nullif(v_row->>'tourist_id', ''),
    nullif(v_row->>'booking_id', '')
  )::uuid;

  insert into public.audit_logs (
    actor_id, actor_name, action, entity_type, entity_id, before_json, after_json, reason
  )
  values (
    auth.uid(),
    coalesce(v_name, 'system'),
    lower(tg_op),
    tg_table_name,
    v_entity,
    case when tg_op = 'INSERT' then null else to_jsonb(old) end,
    case when tg_op = 'DELETE' then null else to_jsonb(new) end,
    nullif(current_setting('app.change_reason', true), '')
  );

  return case when tg_op = 'DELETE' then old else new end;
end;
$$;

revoke all on function public.audit_row_change() from public, anon, authenticated;
