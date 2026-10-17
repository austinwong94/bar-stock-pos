create or replace function public.save_kitchen_pax_checked(
  p_business_date date,p_pax_count int,p_entered_by text,p_notes text,p_expected_updated_at timestamptz
) returns public.kitchen_daily_pax language plpgsql security definer set search_path=public as $$
declare v_current public.kitchen_daily_pax%rowtype;
begin
  perform public.require_permission('kitchen.production.manage');
  if p_business_date is null then raise exception 'Choose a date.'; end if;
  perform pg_advisory_xact_lock(hashtextextended('pax-'||p_business_date::text,0));
  select * into v_current from public.kitchen_daily_pax where business_date=p_business_date for update;
  if v_current.updated_at is distinct from p_expected_updated_at then
    raise exception 'The arrival count changed on another device. Reload the count before editing.' using errcode='40001'; end if;
  return public.save_kitchen_pax(p_business_date,p_pax_count,p_entered_by,p_notes);
end $$;
revoke all on function public.save_kitchen_pax(date,int,text,text) from public,anon,authenticated;
revoke all on function public.save_kitchen_pax_checked(date,int,text,text,timestamptz) from public,anon;
grant execute on function public.save_kitchen_pax_checked(date,int,text,text,timestamptz) to authenticated;
