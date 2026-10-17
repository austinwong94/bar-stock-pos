-- One reviewed save across a week, with the same per-day permissions and locks.
create function public.save_booking_sheet_range(p_days jsonb,p_request_id uuid)
returns jsonb language plpgsql security definer set search_path=public as $$
declare day jsonb; result jsonb:='[]'; prior public.operation_requests%rowtype; fingerprint text; first_date date; last_date date;
begin
 if p_request_id is null or jsonb_typeof(p_days) is distinct from 'array' or jsonb_array_length(p_days) not between 1 and 7 then raise exception 'Choose 1-7 booking days.';end if;
 if exists(select 1 from jsonb_array_elements(p_days) x where jsonb_typeof(x) is distinct from 'object' or nullif(x->>'p_date','') is null) then raise exception 'Every sheet needs a service date.';end if;
 if exists(select 1 from jsonb_array_elements(p_days) x group by x->>'p_date' having count(*)>1) then raise exception 'A date appears twice in this save.';end if;
 select min((x->>'p_date')::date),max((x->>'p_date')::date) into first_date,last_date from jsonb_array_elements(p_days) x;
 if first_date is null or last_date-first_date>6 then raise exception 'Save one seven-day period at a time.';end if;
 for day in select * from jsonb_array_elements(p_days) loop perform public.check_sheet_date((day->>'p_date')::date);end loop;
 perform pg_advisory_xact_lock(73081,1);
 fingerprint:=md5(p_days::text);
 select * into prior from public.operation_requests where actor_id=auth.uid() and operation='booking_sheet_range' and request_id=p_request_id;
 if found then
  if prior.payload_hash<>fingerprint then raise exception 'This week save reference has different details.';end if;
  return (select after_json->'days' from public.audit_logs where actor_id=auth.uid() and entity_id=p_request_id and action='booking_sheet_range' limit 1);
 end if;
 for day in select * from jsonb_array_elements(p_days) order by value->>'p_date' loop
  result:=result||jsonb_build_array(jsonb_build_object('date',day->>'p_date','rows',public.save_booking_spreadsheet((day->>'p_date')::date,day->'p_rows',day->'p_resources',gen_random_uuid())));
 end loop;
 insert into public.audit_logs(actor_id,action,entity_type,entity_id,after_json) values(auth.uid(),'booking_sheet_range','booking_sheet',p_request_id,jsonb_build_object('days',result));
 insert into public.operation_requests(actor_id,operation,request_id,payload_hash,result_id) values(auth.uid(),'booking_sheet_range',p_request_id,fingerprint,p_request_id);
 return result;
end $$;
revoke all on function public.save_booking_sheet_range(jsonb,uuid) from public,anon;
grant execute on function public.save_booking_sheet_range(jsonb,uuid) to authenticated;
