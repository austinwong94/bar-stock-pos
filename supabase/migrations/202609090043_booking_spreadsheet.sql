-- One save for a familiar booking sheet: all rows succeed together or none do.
create function public.save_booking_spreadsheet(p_date date,p_rows jsonb,p_resources jsonb,p_request_id uuid)
returns jsonb language plpgsql security definer set search_path=public as $$
#variable_conflict use_variable
<<sheet_save>>
declare prior public.operation_requests%rowtype; fingerprint text; row_data jsonb; resource jsonb; changes jsonb;
 result jsonb:='[]'; booking_id uuid; assignment_id uuid; run_id uuid; current_version timestamptz;
 boat_row public.boat_assignments%rowtype; van_row public.pickup_groups%rowtype; account_row public.booking_accounts%rowtype;
 finance jsonb; payment jsonb; party public.referral_parties%rowtype; party_id uuid; account_before jsonb; n integer:=0; message text; state text;
begin
 perform public.check_sheet_date(p_date);
 perform pg_advisory_xact_lock(73081,1);
 if p_request_id is null or jsonb_typeof(p_rows) is distinct from 'array' or jsonb_array_length(p_rows) not between 1 and 200
 or jsonb_typeof(p_resources) is distinct from 'object' then raise exception 'Choose 1-200 changed booking rows.'; end if;
 fingerprint:=md5(jsonb_build_array(p_date,p_rows,p_resources)::text);
 select * into prior from public.operation_requests where actor_id=auth.uid() and operation='booking_spreadsheet' and request_id=p_request_id;
 if found then
  if prior.payload_hash<>fingerprint then raise exception 'This sheet save reference has different details.';end if;
  return (select after_json->'rows' from public.audit_logs where entity_id=p_request_id and actor_id=auth.uid() and action='booking_spreadsheet' limit 1);
 end if;
 if exists(select 1 from jsonb_array_elements(p_rows) x group by x->>'key' having count(*)>1)
 or exists(select 1 from jsonb_array_elements(p_rows) x where nullif(x->>'id','') is not null group by x->>'id' having count(*)>1) then raise exception 'A booking appears twice in this save.';end if;
 if exists(select 1 from jsonb_array_elements(coalesce(p_resources->'boats','[]')) x group by x->>'boat_id' having count(*)>1)
 or exists(select 1 from jsonb_array_elements(coalesce(p_resources->'vans','[]')) x group by x->>'vehicle_id' having count(*)>1) then raise exception 'A boat or van has conflicting entries.';end if;
 for resource in select * from jsonb_array_elements(coalesce(p_resources->'boats','[]')) loop
  select * into boat_row from public.boat_assignments where service_date=p_date and boat_id=(resource->>'boat_id')::uuid and status<>'cancelled';
  if found then
   if boat_row.updated_at is distinct from nullif(resource->>'expected','')::timestamptz then raise exception 'Boat crew changed. Refresh the sheet before saving.' using errcode='40001';end if;
   assignment_id:=boat_row.id;
  else
   if resource->>'expected' is not null then raise exception 'Boat plan changed.' using errcode='40001';end if;
   assignment_id:=public.save_sheet_resource(p_date,'boat',null,(resource->>'boat_id')::uuid,null,null,gen_random_uuid());
  end if;
  if resource?'captain' or resource?'crew' then
   select * into boat_row from public.boat_assignments where id=assignment_id;
   perform public.save_sheet_boat(p_date,assignment_id,boat_row.updated_at,
    case when resource?'captain' then nullif(resource->>'captain','')::uuid else boat_row.captain_employee_id end,
    case when resource?'crew' then array(select jsonb_array_elements_text(resource->'crew'))::uuid[] else boat_row.crew_employee_ids end,gen_random_uuid());
  end if;
 end loop;
 for resource in select * from jsonb_array_elements(coalesce(p_resources->'vans','[]')) loop
  select * into van_row from public.pickup_groups where service_date=p_date and vehicle_id=(resource->>'vehicle_id')::uuid and status<>'cancelled';
  if found and van_row.updated_at is distinct from nullif(resource->>'expected','')::timestamptz then raise exception 'Van assignment changed. Refresh the sheet.' using errcode='40001';end if;
  if not found and resource->>'expected' is not null then raise exception 'Van assignment changed.' using errcode='40001';end if;
  perform public.save_sheet_resource(p_date,'van',van_row.id,(resource->>'vehicle_id')::uuid,
   case when resource?'driver' then nullif(resource->>'driver','')::uuid else van_row.driver_employee_id end,van_row.updated_at,gen_random_uuid());
 end loop;
 for row_data in select * from jsonb_array_elements(p_rows) loop
  n:=n+1;
  begin
   booking_id:=nullif(row_data->>'id','')::uuid; changes:=coalesce(row_data->'booking','{}');
   if booking_id is not null then
    select updated_at into current_version from public.bookings where id=booking_id and service_date=p_date;
    if not found or current_version is distinct from nullif(row_data->>'expected','')::timestamptz then raise exception 'Booking changed on another device. Refresh before saving.' using errcode='40001';end if;
   end if;
   if changes<>'{}' or booking_id is null then
    booking_id:=public.save_daily_booking(p_date,booking_id,nullif(row_data->>'expected','')::timestamptz,changes,gen_random_uuid());
   end if;
   changes:=coalesce(row_data->'assignment','{}');
   if changes?'boat_id' then
    assignment_id:=null;
    if nullif(changes->>'boat_id','') is not null then
     select id into assignment_id from public.boat_assignments where service_date=p_date and boat_id=(changes->>'boat_id')::uuid and status='planned';
     if not found then raise exception 'Choose a planned boat.';end if;
    end if;
    changes:=(changes-'boat_id')||jsonb_build_object('assignment_id',assignment_id);
   end if;
   if changes?'vehicle_id' then
    run_id:=null;
    if nullif(changes->>'vehicle_id','') is not null then
     select id into run_id from public.pickup_groups where service_date=p_date and vehicle_id=(changes->>'vehicle_id')::uuid and status='planned';
     if not found then raise exception 'Choose a planned van.';end if;
    end if;
    changes:=(changes-'vehicle_id')||jsonb_build_object('pickup_group_id',run_id);
   end if;
   if changes<>'{}' then
    select updated_at into current_version from public.bookings where id=booking_id;
    perform public.save_departure_assignment(p_date,booking_id,current_version,changes,gen_random_uuid());
   end if;
   finance:=coalesce(row_data->'finance','{}');
   if finance<>'{}' then
    perform public.require_permission('guests.finance.manage');
    select * into account_row from public.booking_accounts where booking_accounts.booking_id=sheet_save.booking_id;
    account_before:=to_jsonb(account_row);
    if account_row.updated_at is distinct from nullif(row_data->>'account_expected','')::timestamptz then raise exception 'The account changed. Refresh before saving.' using errcode='40001';end if;
    if finance?'amount_due' and nullif(finance->>'amount_due','') is not null and
      ((finance->>'amount_due')::numeric::text in ('NaN','Infinity','-Infinity') or (finance->>'amount_due')::numeric<0 or round((finance->>'amount_due')::numeric,2)<>(finance->>'amount_due')::numeric) then raise exception 'Enter a valid RM total with at most two decimals.';end if;
    insert into public.booking_accounts(booking_id) values(booking_id) on conflict do nothing;
    update public.booking_accounts a set amount_due=case when finance?'amount_due' then nullif(finance->>'amount_due','')::numeric else a.amount_due end,
     invoice_number=coalesce(finance->>'invoice_number',a.invoice_number),remarks=coalesce(finance->>'remarks',a.remarks),updated_at=clock_timestamp(),updated_by=auth.uid() where a.booking_id=sheet_save.booking_id;
    if finance?'referrer_name' then
     select * into party from public.referral_parties where lower(name)=lower(trim(finance->>'referrer_name')) and active and not is_default;
     if not found then
      party_id:=public.save_referral_party(null,null,trim(finance->>'referrer_name'),null,null,gen_random_uuid());
      select * into party from public.referral_parties where id=party_id;
     end if;
     finance:=(finance-'referrer_name')||jsonb_build_object('referrer_id',party.id);
    end if;
    if finance?'referrer_id' then
     if coalesce(account_row.commission_paid,0)>0 then raise exception 'Reconcile paid commission before changing the referrer.';end if;
     select * into party from public.referral_parties where id=nullif(finance->>'referrer_id','')::uuid and active and not is_default;
     if nullif(finance->>'referrer_id','') is not null and not found then raise exception 'Choose an active referrer.';end if;
     update public.booking_accounts a set referrer_id=party.id,commission_method=null,commission_rate=null,commission_base=null,commission_pax=0 where a.booking_id=sheet_save.booking_id;
     if party.id is not null then
      if party.method is null then select method,rate into party.method,party.rate from public.referral_parties where is_default;end if;
      select * into account_row from public.booking_accounts where booking_accounts.booking_id=sheet_save.booking_id;
      -- Per-person eligibility must be set by accounts, not inferred from seats.
      if party.method in ('percent','fixed') and account_row.amount_due is not null then
       perform public.save_booking_finance('commission',booking_id,account_row.updated_at,jsonb_build_object('referrer_id',party.id,'use_party_terms',true,'base',account_row.amount_due,'pax',0),gen_random_uuid());
      end if;
     end if;
    end if;
    for payment in select * from jsonb_array_elements(coalesce(finance->'payments','[]')) loop
     select updated_at into current_version from public.booking_accounts a where a.booking_id=sheet_save.booking_id;
     perform public.save_booking_finance('payment',booking_id,current_version,payment||jsonb_build_object('kind','receipt'),gen_random_uuid());
    end loop;
    insert into public.audit_logs(actor_id,action,entity_type,entity_id,before_json,after_json) values(auth.uid(),'booking_finance_sheet','booking_account',booking_id,account_before,finance);
   end if;
   result:=result||jsonb_build_array(jsonb_build_object('key',row_data->>'key','id',booking_id));
  exception when others then get stacked diagnostics message=message_text,state=returned_sqlstate;raise exception 'Row %: %',coalesce(row_data->>'number',n::text),message using errcode=state;
  end;
 end loop;
 insert into public.audit_logs(actor_id,action,entity_type,entity_id,after_json) values(auth.uid(),'booking_spreadsheet','booking_sheet',p_request_id,jsonb_build_object('date',p_date,'rows',result));
 insert into public.operation_requests(actor_id,operation,request_id,payload_hash,result_id) values(auth.uid(),'booking_spreadsheet',p_request_id,fingerprint,p_request_id);
 return result;
end $$;
revoke all on function public.save_booking_spreadsheet(date,jsonb,jsonb,uuid) from public,anon;
grant execute on function public.save_booking_spreadsheet(date,jsonb,jsonb,uuid) to authenticated;
