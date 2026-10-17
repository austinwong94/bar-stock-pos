-- Expiry is access control, not deletion. Business dates use Malaysia time.
create schema if not exists private_guest;
revoke all on schema private_guest from public, anon, authenticated;

create table public.guest_privacy_rules (
 user_id uuid primary key references public.profiles(id),
 mode text not null check (mode in ('contacts','names_contacts','history')),
 hide_after_days int not null check (hide_after_days between 1 and 365),
 version int not null default 1,
 updated_by uuid not null references public.profiles(id),
 updated_at timestamptz not null default now()
);
alter table public.guest_privacy_rules enable row level security;
revoke all on public.guest_privacy_rules from public,anon,authenticated;

create function public.guest_history_allowed() returns boolean language sql stable security definer set search_path=public as $$
 select exists(select 1 from profiles p join access_roles r on r.code=p.access_role_code
 left join guest_privacy_rules g on g.user_id=p.id
 where p.id=auth.uid() and p.status='active' and not p.is_anonymous
 and p.agency_id is null and p.access_role_code<>'external_planner'
 and (r.is_master or g.mode='history'))
$$;
create function public.guest_privacy(p_date date) returns jsonb language sql stable security definer set search_path=public as $$
 select jsonb_build_object(
 'contacts_hidden', not public.guest_history_allowed() and (p_date is null or (now() at time zone 'Asia/Kuala_Lumpur')::date>=p_date+coalesce(g.hide_after_days,1)),
 'names_hidden', not public.guest_history_allowed() and (p_date is null or (now() at time zone 'Asia/Kuala_Lumpur')::date>=p_date+coalesce(g.hide_after_days,1)) and g.mode is distinct from 'contacts')
 from (select auth.uid() id) u left join guest_privacy_rules g on g.user_id=u.id
$$;

-- Agency-linked accounts cannot obtain accounts, commissions, or access administration
-- through an accidental per-person grant. Existing external-planner date restrictions remain.
do $$ declare d text; begin
 d:=pg_get_functiondef('public.user_has_permission(uuid,text)'::regprocedure);
 if position('select case' in d)=0 then raise exception 'Permission function changed; review privacy migration.';end if;
 d:=replace(d,'select case',$guard$select case
 when exists(select 1 from public.profiles where id=p_user_id and agency_id is not null)
 and (p_code='guests.finance.manage' or p_code like 'platform.%' or p_code like 'bar.%') then false
 $guard$);
 execute d;
end $$;

create function public.admin_guest_privacy() returns jsonb language plpgsql security definer set search_path=public as $$
begin
 perform require_permission('platform.roles.manage');
 return coalesce((select jsonb_agg(jsonb_build_object('user_id',p.id,'name',coalesce(p.full_name,'Unnamed'),
 'role',r.name,'agency',a.name,'restricted',p.agency_id is not null or p.access_role_code='external_planner' or p.is_anonymous,
 'master',r.is_master,'mode',case when r.is_master and p.agency_id is null then 'history'
 when (p.agency_id is not null or p.access_role_code='external_planner') and g.mode='history' then 'names_contacts'
 else coalesce(g.mode,'names_contacts') end,'hide_after_days',coalesce(g.hide_after_days,1),
 'version',coalesce(g.version,0),'updated_at',g.updated_at,'updated_by',editor.full_name,
 'finance_allowed',public.user_has_permission(p.id,'guests.finance.manage')) order by r.is_master desc,p.full_name)
 from profiles p join access_roles r on r.code=p.access_role_code left join agencies a on a.id=p.agency_id
 left join guest_privacy_rules g on g.user_id=p.id left join profiles editor on editor.id=g.updated_by),'[]');
end $$;
create function public.admin_save_guest_privacy(p_user_id uuid,p_mode text,p_days int,p_expected_version int,p_finance boolean default null,p_expected_finance boolean default null)
returns void language plpgsql security definer set search_path=public as $$
declare old_rule jsonb; p profiles%rowtype; v int;
begin
 perform require_permission('platform.roles.manage');
 perform pg_advisory_xact_lock(hashtextextended('guest-privacy:'||p_user_id::text,0));
 select * into p from profiles where id=p_user_id for update;
 if not found then raise exception 'Account not found.';end if;
 if p_mode not in ('contacts','names_contacts','history') or p_mode is null or p_days is null or p_days not between 1 and 365 then raise exception 'Choose a privacy rule and 1-365 days.';end if;
 if exists(select 1 from access_roles where code=p.access_role_code and is_master) then raise exception 'Boss accounts retain history.';end if;
 if p_mode='history' and (p.agency_id is not null or p.access_role_code='external_planner' or p.is_anonymous) then raise exception 'External, agency and shared accounts cannot retain guest history.' using errcode='42501';end if;
 if p_finance is not null then
   if p_finance and (p.agency_id is not null or p.access_role_code='external_planner' or p.is_anonymous) then raise exception 'External, agency and shared accounts cannot access accounts or commission.' using errcode='42501';end if;
   if public.user_has_permission(p_user_id,'guests.finance.manage') is distinct from p_expected_finance then raise exception 'Financial access changed on another device. Reload before saving.' using errcode='40001';end if;
   if p_finance is distinct from p_expected_finance then perform public.admin_set_permission_override(p_user_id,'guests.finance.manage',case when p_finance then 'grant' else 'revoke' end);end if;
 end if;
 select to_jsonb(g),g.version into old_rule,v from guest_privacy_rules g where user_id=p_user_id;
 if coalesce(v,0) is distinct from p_expected_version then raise exception 'Changed on another device. Reload before saving.' using errcode='40001';end if;
 insert into guest_privacy_rules(user_id,mode,hide_after_days,version,updated_by) values(p_user_id,p_mode,p_days,coalesce(v,0)+1,auth.uid())
 on conflict(user_id) do update set mode=excluded.mode,hide_after_days=excluded.hide_after_days,version=excluded.version,updated_by=excluded.updated_by,updated_at=clock_timestamp();
 insert into audit_logs(actor_id,action,entity_type,entity_id,before_json,after_json)
 values(auth.uid(),'guest_privacy_changed','guest_privacy_rules',p_user_id,old_rule,
 jsonb_build_object('mode',p_mode,'hide_after_days',p_days,'version',coalesce(v,0)+1));
end $$;

-- Only guest objects pass through this recursive filter; employee contacts are separate.
create function private_guest.redact(p_value jsonb,p_date date) returns jsonb language plpgsql stable security definer set search_path=public as $$
declare rule jsonb:=public.guest_privacy(p_date); result jsonb; k text; v jsonb;
begin
 if not (rule->>'contacts_hidden')::boolean then return p_value;end if;
 if jsonb_typeof(p_value)='array' then
   select coalesce(jsonb_agg(private_guest.redact(x,p_date)),'[]') into result from jsonb_array_elements(p_value) x; return result;
 elsif jsonb_typeof(p_value)<>'object' then return p_value;end if;
 result:='{}';
 for k,v in select * from jsonb_each(p_value) loop
   if k in ('lead_phone','lead_email','phone','email','passport_no','date_of_birth','tourist_private','notes','note','ops_notes','special_requests','external_ref','assistance_note','seat_note','medical_notes','dietary_notes','remarks','reference','void_reason') then v:='null';
   elsif (rule->>'names_hidden')::boolean and k in ('lead_name','full_name') then v:=to_jsonb('Private guest'::text);
   else v:=private_guest.redact(v,p_date);end if;
   result:=result||jsonb_build_object(k,v);
 end loop;
 return result||rule;
end $$;

-- Retain existing authorization/transaction logic in non-exposed, non-executable helpers.
do $$ declare name text; d text; begin
 foreach name in array array['read_daily_booking_sheet','read_pickup_board','read_guest_meal_needs','read_booking_accounts','operations_summary'] loop
 d:=pg_get_functiondef(format('public.%I(date)',name)::regprocedure);
 execute replace(d,format('FUNCTION public.%I(',name),format('FUNCTION private_guest.%I(',name));
 end loop;
 foreach name in array array['read_booking_change_log','booking_history'] loop
 d:=pg_get_functiondef(format('public.%I(uuid)',name)::regprocedure);
 execute replace(d,format('FUNCTION public.%I(',name),format('FUNCTION private_guest.%I(',name));
 end loop;
 d:=pg_get_functiondef('public.boat_assignment_message(date)'::regprocedure);
 execute replace(d,'FUNCTION public.boat_assignment_message(','FUNCTION private_guest.boat_assignment_message(');
end $$;

create or replace function public.read_daily_booking_sheet(p_date date) returns jsonb language plpgsql security definer set search_path=public as $$
declare data jsonb;begin
 data:=private_guest.read_daily_booking_sheet(p_date);
 return jsonb_set(data,'{bookings}',private_guest.redact(data->'bookings',p_date))||public.guest_privacy(p_date);
end $$;
create or replace function public.read_pickup_board(p_date date) returns jsonb language plpgsql security definer set search_path=public as $$
declare data jsonb;begin
 data:=private_guest.read_pickup_board(p_date);
 return jsonb_set(data,'{bookings}',private_guest.redact(data->'bookings',p_date));
end $$;
create or replace function public.read_guest_meal_needs(p_date date) returns jsonb language sql stable security definer set search_path=public as $$
 select private_guest.redact(private_guest.read_guest_meal_needs(p_date),p_date)
$$;
create or replace function public.read_booking_accounts(p_date date) returns jsonb language sql security definer set search_path=public as $$
 select private_guest.redact(private_guest.read_booking_accounts(p_date),p_date)
$$;
create or replace function public.operations_summary(p_service_date date) returns jsonb language plpgsql stable security definer set search_path=public as $$
declare data jsonb;begin
 data:=private_guest.operations_summary(p_service_date);
 if (public.guest_privacy(p_service_date)->>'contacts_hidden')::boolean then data:=data||jsonb_build_object('incidents','[]'::jsonb);end if;
 return data;
end $$;
create or replace function public.read_booking_change_log(p_booking_id uuid) returns jsonb language plpgsql security definer set search_path=public as $$
declare data jsonb; d date;begin
 data:=private_guest.read_booking_change_log(p_booking_id);
 select service_date into d from bookings where id=p_booking_id;
 if (public.guest_privacy(d)->>'contacts_hidden')::boolean then
   select coalesce(jsonb_agg(x||jsonb_build_object('details',null)),'[]') into data from jsonb_array_elements(data) x;
 end if; return data;
end $$;
create or replace function public.booking_history(p_booking_id uuid)
returns table(id uuid,action text,entity_type text,actor_name text,reason text,created_at timestamptz,summary text)
language sql stable security definer set search_path=public as $$
 select h.id,h.action,h.entity_type,h.actor_name,
 case when (public.guest_privacy(b.service_date)->>'contacts_hidden')::boolean then null else h.reason end,h.created_at,
 case when (public.guest_privacy(b.service_date)->>'contacts_hidden')::boolean then 'Private details hidden' else h.summary end
 from private_guest.booking_history(p_booking_id) h join bookings b on b.id=p_booking_id
$$;
create or replace function public.boat_assignment_message(p_service_date date) returns text language plpgsql security definer set search_path=public as $$
begin
 if (public.guest_privacy(p_service_date)->>'contacts_hidden')::boolean then raise exception 'Guest details for this date are private.' using errcode='42501';end if;
 return private_guest.boat_assignment_message(p_service_date);
end $$;

create function public.read_guest_bookings(p_date date default null) returns jsonb language sql stable security definer set search_path=public as $$
 select coalesce(jsonb_agg(private_guest.redact(to_jsonb(b)||jsonb_build_object(
 'agencies',(select jsonb_build_object('id',a.id,'name',a.name,'source_type',a.source_type) from agencies a where a.id=b.agency_id),
 'tourists',coalesce((select jsonb_agg(to_jsonb(t)||jsonb_build_object('tourist_private',case when has_permission('guests.contact.view') then (select to_jsonb(v) from tourist_private v where v.tourist_id=t.id) else null end) order by t.sort_order) from tourists t where t.booking_id=b.id),'[]')),b.service_date)),'[]')
 from (select * from bookings where (p_date is null or service_date=p_date) and can_view_booking(id) and not is_external_planner() order by service_date desc,created_at desc limit 500) b
$$;

-- A controlled manifest read keeps the passenger counts without exposing expired raw rows.
create function public.read_staff_manifest(p_date date,p_arrived_only boolean default false) returns jsonb language sql stable security definer set search_path=public as $$
 select coalesce(jsonb_agg(private_guest.redact(to_jsonb(m),p_date) order by m.boat_code,m.booking_ref,m.full_name),'[]')
 from public.trip_manifest m where m.service_date=p_date and (not p_arrived_only or m.boarding_status='arrived')
 and public.can_see_assignment(m.assignment_id) and public.can_view_booking(m.booking_id) and not public.is_external_planner()
$$;

-- Direct REST reads and joins cannot bypass the redacted read functions.
create policy guest_expiry on public.bookings as restrictive for select to authenticated
 using (not (public.guest_privacy(service_date)->>'contacts_hidden')::boolean);
create function public.guest_booking_open(p_booking_id uuid) returns boolean language sql stable security definer set search_path=public as $$
 select exists(select 1 from bookings where id=p_booking_id and not (public.guest_privacy(service_date)->>'contacts_hidden')::boolean)
$$;
create policy guest_expiry on public.tourists as restrictive for select to authenticated using (public.guest_booking_open(booking_id));
create policy guest_expiry on public.tourist_private as restrictive for select to authenticated
 using (exists(select 1 from public.tourists t where t.id=tourist_id and public.guest_booking_open(t.booking_id)));
create policy guest_history_privacy on public.audit_logs as restrictive for select to authenticated using (public.guest_history_allowed());
create policy guest_expiry on public.attendance_log as restrictive for select to authenticated using (not (public.guest_privacy(service_date)->>'contacts_hidden')::boolean);
create policy guest_expiry on public.outbound_messages as restrictive for select to authenticated using (public.guest_history_allowed() or (service_date is not null and not (public.guest_privacy(service_date)->>'contacts_hidden')::boolean));
create policy guest_expiry on public.operations_events as restrictive for select to authenticated using (not (public.guest_privacy(service_date)->>'contacts_hidden')::boolean);
create function private_guest.guard_message() returns trigger language plpgsql security definer set search_path=public as $$
begin
 if auth.uid() is not null and (public.guest_privacy(old.service_date)->>'contacts_hidden')::boolean then raise exception 'Historical message details are private.' using errcode='42501';end if;
 return new;
end $$;
create trigger guest_message_privacy before update on public.outbound_messages for each row execute function private_guest.guard_message();
create function private_guest.guard_account_notes() returns trigger language plpgsql security definer set search_path=public as $$
declare d date;begin
 select service_date into d from bookings where id=old.booking_id;
 if auth.uid() is not null and (public.guest_privacy(d)->>'contacts_hidden')::boolean and new.remarks is distinct from old.remarks
 then raise exception 'Accounting remarks are private for this date. Ask an authorised PIC to edit the total and invoice.' using errcode='42501';end if;
 return new;
end $$;
create trigger guest_account_notes_privacy before update on public.booking_accounts for each row execute function private_guest.guard_account_notes();

-- Masked values must never be written back over the original customer record.
create function private_guest.guard_write() returns trigger language plpgsql security definer set search_path=public as $$
declare d date;begin
 if auth.uid() is null then return new;end if;
 if tg_table_name='bookings' then d:=old.service_date;else select service_date into d from bookings where id=old.booking_id;end if;
 if (public.guest_privacy(d)->>'contacts_hidden')::boolean and
 (to_jsonb(new)-array['updated_at','updated_by','pax_total','pax_adults','pax_children','pax_infants','pax_tour_leaders','pax_tour_guides','pax_elderly','pax_assisted']) is distinct from
 (to_jsonb(old)-array['updated_at','updated_by','pax_total','pax_adults','pax_children','pax_infants','pax_tour_leaders','pax_tour_guides','pax_elderly','pax_assisted'])
 then raise exception 'Guest details for this date are private. Ask an authorised PIC to edit this record.' using errcode='42501';end if;
 return new;
end $$;
create trigger guest_privacy_write before update on public.bookings for each row execute function private_guest.guard_write();
create trigger guest_privacy_write before update on public.tourists for each row execute function private_guest.guard_write();

revoke all on all functions in schema private_guest from public,anon,authenticated;
revoke all on function public.admin_guest_privacy(),public.admin_save_guest_privacy(uuid,text,int,int,boolean,boolean),public.read_guest_bookings(date),public.read_staff_manifest(date,boolean) from public,anon;
grant execute on function public.admin_guest_privacy(),public.admin_save_guest_privacy(uuid,text,int,int,boolean,boolean),public.read_guest_bookings(date),public.read_staff_manifest(date,boolean) to authenticated;
notify pgrst,'reload schema';
