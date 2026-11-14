begin;

create or replace function public.reopen_daily_report_checked(
 p_business_date date,p_report_id uuid,p_expected_version text,p_reason text,p_request_id uuid,p_expected_actor_id uuid
) returns jsonb language plpgsql security definer set search_path=pg_catalog,public,pg_temp as $$
declare previous public.bar_report_reopen_requests%rowtype; source public.daily_reports%rowtype; changed public.daily_reports%rowtype;
 intent jsonb:=jsonb_build_array(p_business_date,p_report_id,p_expected_version,p_reason);result jsonb;
begin
 perform public.require_permission('bar.closing.manage');
 if auth.uid() is null or p_expected_actor_id is distinct from auth.uid() then raise exception 'Use the original account.' using errcode='42501';end if;
 if p_request_id is null then raise exception 'A reopening reference is required.' using errcode='22023';end if;
 perform pg_advisory_xact_lock(77312,1);
 -- A queued request must not return private proof after its account loses access.
 perform public.require_permission('bar.closing.manage');
 select * into previous from public.bar_report_reopen_requests where request_id=p_request_id;
 if found then
   if previous.actor_id is distinct from auth.uid() or previous.payload is distinct from intent then raise exception 'Check the original reopening details and account.' using errcode='LP001';end if;
   return previous.result;
 end if;
 if not exists(select 1 from public.profiles where id=auth.uid() and admin_access_expires_at>now()) then
   raise exception 'Unlock report editing from Reports, then check this reopening.' using errcode='42501';
 end if;
 if p_business_date is null or p_report_id is null or nullif(trim(p_expected_version),'') is null or nullif(trim(p_reason),'') is null then raise exception 'Review the report reopening details.' using errcode='22023';end if;
 select * into source from public.daily_reports where business_date=p_business_date for update;
 if not found or source.id is distinct from p_report_id or source.status<>'closed'
   or p_expected_version is distinct from public.read_bar_closing(p_business_date)->>'version' then
   raise exception 'This report changed. Reload and review it from Reports.' using errcode='40001';
 end if;
 perform public.reopen_daily_report(p_business_date,p_reason);
 -- Keep the original closing notes. The reason remains in the existing audit and this request.
 update public.daily_reports set notes=source.notes where id=source.id returning * into changed;
 result:=jsonb_build_object('request_id',p_request_id,'actor_id',auth.uid(),'report',to_jsonb(changed));
 insert into public.bar_report_reopen_requests(request_id,actor_id,report_id,business_date,payload,result)
 values(p_request_id,auth.uid(),source.id,p_business_date,intent,result);
 return result;
end $$;
revoke all on function public.reopen_daily_report_checked(date,uuid,text,text,uuid,uuid) from public,anon;
grant execute on function public.reopen_daily_report_checked(date,uuid,text,text,uuid,uuid) to authenticated;
revoke all on function public.reopen_daily_report(date,text) from public,anon,authenticated;


notify pgrst,'reload schema';
commit;
