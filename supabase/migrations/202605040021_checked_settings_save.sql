-- Save settings atomically and prevent stale screens on another device
-- from overwriting newer cloud settings.
drop trigger if exists app_settings_touch_updated_at on public.app_settings;
create trigger app_settings_touch_updated_at before update on public.app_settings
for each row execute function public.touch_updated_at();

create or replace function public.save_app_settings_checked(
  p_rows jsonb,
  p_versions jsonb default '{}'::jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  row_item jsonb;
  setting_key text;
  setting_value jsonb;
  source_version text;
  source_updated_at timestamptz;
  current_row public.app_settings%rowtype;
  saved_rows jsonb;
begin
  if auth.uid() is null then
    raise exception 'Cloud session is not ready. Enter the website access code again.';
  end if;

  if public.current_user_role() <> 'admin' then
    raise exception 'Admin access required. Unlock Admin again before saving settings.';
  end if;

  if jsonb_typeof(p_rows) <> 'array' then
    raise exception 'Settings payload must be a list.';
  end if;

  for row_item in select value from jsonb_array_elements(p_rows)
  loop
    setting_key := row_item ->> 'key';
    setting_value := row_item -> 'value';

    if setting_key is null or setting_key = '' then
      raise exception 'Setting key is required.';
    end if;

    if setting_value is null then
      raise exception 'Setting value is required for %.', setting_key;
    end if;

    select *
    into current_row
    from public.app_settings
    where key = setting_key
    for update;

    source_version := p_versions ->> setting_key;
    if current_row.key is not null and source_version is not null and source_version <> '' then
      source_updated_at := source_version::timestamptz;
      if current_row.updated_at <> source_updated_at then
        raise exception 'Settings changed on another device. Latest values loaded; review and save again.';
      end if;
    end if;

    insert into public.app_settings(key, value, updated_by, updated_at)
    values (setting_key, setting_value, auth.uid(), now())
    on conflict (key) do update
      set value = excluded.value,
          updated_by = auth.uid(),
          updated_at = now();
  end loop;

  insert into public.audit_logs(actor_id, action, entity_type, after_json)
  values (auth.uid(), 'save_app_settings_checked', 'app_settings', p_rows);

  select coalesce(
    jsonb_agg(jsonb_build_object('key', key, 'value', value, 'updated_at', updated_at) order by key),
    '[]'::jsonb
  )
  into saved_rows
  from public.app_settings
  where key in (select value ->> 'key' from jsonb_array_elements(p_rows));

  return jsonb_build_object('settings', saved_rows);
end;
$$;

revoke execute on function public.save_app_settings_checked(jsonb, jsonb) from public, anon;
grant execute on function public.save_app_settings_checked(jsonb, jsonb) to authenticated;
