-- Staff time and leave are separate from tourist attendance and payroll.
insert into public.permissions(code,department_code,name,description,sensitive,sort_order) values
 ('staff.self','platform','Own Attendance & Leave','Clock in/out and apply for leave using your named account.',false,200),
 ('staff.team.view','platform','View Staff Attendance','View team attendance and leave dates, not private leave reasons.',true,201),
 ('staff.leave.approve','platform','Approve Staff Leave','Review leave reasons and approve/reject requests. No self-approval.',true,202),
 ('staff.attendance.manage','platform','Correct Staff Attendance','Correct recorded times with a reason and a retained audit history.',true,203);
insert into public.access_role_permissions(role_code,permission_code)
 select code,'staff.self' from public.access_roles where code in
 ('operations_manager','coordinator','bar_staff','captain','guide','accountant','bar_manager','bar_cashier','kitchen_staff','purchaser') on conflict do nothing;

create or replace function public.user_has_permission(p_user_id uuid,p_code text) returns boolean
language sql stable security definer set search_path=public,pg_temp as $$
 select (p_code like 'bar.%' or p_code like 'kitchen.%' or p_code like 'purchasing.%'
   or p_code in ('platform.users.manage','platform.roles.manage','platform.audit.view','platform.settings.manage')
   or (p_code like 'staff.%' and exists(select 1 from public.profiles where id=p_user_id
     and status='active' and not is_anonymous and agency_id is null
     and access_role_code not in ('agent','external_planner','pending'))))
   and (p_code in ('bar.pos.use','bar.stock.view') or not exists(select 1 from public.profiles where id=p_user_id and is_anonymous))
   and public.user_has_permission_before_supply_rollout(p_user_id,p_code)
$$;
revoke all on function public.user_has_permission(uuid,text) from public,anon,authenticated;

create table public.staff_time_entries(
 id uuid primary key default gen_random_uuid(),staff_id uuid not null references auth.users(id),staff_name text not null,
 clock_in timestamptz not null,clock_out timestamptz,version integer not null default 1,correction_count integer not null default 0,
 created_at timestamptz not null default now(),updated_at timestamptz not null default now(),
 check(clock_out is null or clock_out>clock_in)
);
create unique index staff_one_open_shift on public.staff_time_entries(staff_id) where clock_out is null;
create index staff_time_history on public.staff_time_entries(staff_id,clock_in);
create table public.staff_leave_requests(
 id uuid primary key default gen_random_uuid(),staff_id uuid not null references auth.users(id),staff_name text not null,
 start_date date not null,end_date date not null,leave_type text not null check(leave_type in('annual','medical','unpaid','other')),
 portion text not null check(portion in('full','am','pm')),reason text not null default '',
 status text not null default 'pending' check(status in('pending','approved','rejected','withdrawn','cancel_requested','cancelled')),
 version integer not null default 1,submitted_at timestamptz not null default now(),updated_at timestamptz not null default now(),
 decided_by uuid references auth.users(id),decided_by_name text,decided_at timestamptz,decision_note text,
 check(end_date>=start_date and end_date-start_date<=365),check(portion='full' or start_date=end_date)
);
create index staff_leave_dates on public.staff_leave_requests(staff_id,start_date,end_date);
create table public.staff_work_operations(
 actor_id uuid not null references auth.users(id),operation_id uuid not null,payload jsonb not null,result jsonb not null,
 created_at timestamptz not null default now(),primary key(actor_id,operation_id)
);
alter table public.staff_time_entries enable row level security;
alter table public.staff_leave_requests enable row level security;
alter table public.staff_work_operations enable row level security;
revoke all on public.staff_time_entries,public.staff_leave_requests,public.staff_work_operations from public,anon,authenticated;

create function public.read_staff_work(p_from date,p_to date,p_team boolean default false) returns jsonb
language plpgsql stable security definer set search_path=public,pg_temp as $$
declare result jsonb;can_time boolean;can_leave boolean;begin
 if p_team then
   if not(public.has_permission('staff.team.view') or public.has_permission('staff.leave.approve') or public.has_permission('staff.attendance.manage'))then
     raise exception 'Staff team access required.' using errcode='42501';end if;
 else perform public.require_permission('staff.self');end if;
 if p_from is null or p_to is null or p_to<p_from or p_to-p_from>92 then raise exception 'Choose a period up to three months.';end if;
 can_time:=not p_team or public.has_permission('staff.team.view') or public.has_permission('staff.attendance.manage');
 can_leave:=not p_team or public.has_permission('staff.leave.approve');
 if (select count(*) from public.staff_time_entries where can_time and (p_team or staff_id=auth.uid()) and
   ((clock_in at time zone 'Asia/Kuala_Lumpur')::date between p_from and p_to or clock_out is null))>10000
   or (select count(*) from public.staff_leave_requests where (p_team or staff_id=auth.uid()) and
     (start_date<=p_to and end_date>=p_from or (status in('pending','cancel_requested') or updated_at>=now()-interval '1 day' or not p_team and end_date>=(now() at time zone 'Asia/Kuala_Lumpur')::date and status='approved')))>10000 then
   raise exception 'Too many staff records. Choose a shorter period.';end if;
 select jsonb_build_object('server_time',now(),'team',p_team,
   'attendance',coalesce((select jsonb_agg(to_jsonb(t) order by clock_in desc,id) from public.staff_time_entries t
     where can_time and (p_team or staff_id=auth.uid()) and ((clock_in at time zone 'Asia/Kuala_Lumpur')::date between p_from and p_to or clock_out is null)),'[]'::jsonb),
   'leaves',coalesce((select jsonb_agg(to_jsonb(l)||case when can_leave or l.staff_id=auth.uid() then '{}'::jsonb else jsonb_build_object('reason',null,'decision_note',null) end order by submitted_at desc,id)
     from public.staff_leave_requests l where (p_team or staff_id=auth.uid()) and (start_date<=p_to and end_date>=p_from or (status in('pending','cancel_requested') or updated_at>=now()-interval '1 day' or not p_team and end_date>=(now() at time zone 'Asia/Kuala_Lumpur')::date and status='approved'))),'[]'::jsonb),
   'people',case when p_team then coalesce((select jsonb_agg(jsonb_build_object('id',p.id,'name',p.full_name) order by p.full_name,p.id)
     from public.profiles p where public.user_has_permission(p.id,'staff.self')),'[]'::jsonb) else '[]'::jsonb end) into result;
 return result;
end $$;

create function public.mutate_staff_work(p_operation_id uuid,p_action text,p_record jsonb) returns jsonb
language plpgsql security definer set search_path=public,pg_temp as $$
declare actor_name text;intent jsonb;prior public.staff_work_operations%rowtype;entry public.staff_time_entries%rowtype;
 leave_row public.staff_leave_requests%rowtype;before_record jsonb;record jsonb;result jsonb;allowed text[];
s date;e date;v_portion text;start_stamp timestamptz;end_stamp timestamptz;stamp timestamptz;today date;
begin
 if p_action in('leave_approve','leave_reject','leave_cancel','leave_keep') then perform public.require_permission('staff.leave.approve');
 elsif p_action='attendance_correct' then perform public.require_permission('staff.attendance.manage');
 else perform public.require_permission('staff.self');end if;
 if p_operation_id is null or p_action is null or p_record is null or jsonb_typeof(p_record)<>'object' then raise exception 'Submission details required.';end if;
 select nullif(trim(full_name),'') into actor_name from public.profiles where id=auth.uid();if actor_name is null then raise exception 'Your staff account needs a name.';end if;
 intent:=jsonb_build_object('action',p_action,'record',p_record);
 perform pg_advisory_xact_lock(73090,1);
 stamp:=clock_timestamp();today:=(stamp at time zone 'Asia/Kuala_Lumpur')::date;
 -- Access may have changed while this request waited for another staff submission.
 if p_action in('leave_approve','leave_reject','leave_cancel','leave_keep') then perform public.require_permission('staff.leave.approve');
 elsif p_action='attendance_correct' then perform public.require_permission('staff.attendance.manage');
 else perform public.require_permission('staff.self');end if;
 select * into prior from public.staff_work_operations where actor_id=auth.uid() and operation_id=p_operation_id;
 if found then if prior.payload<>intent then raise exception 'This submission already has different details.';end if;return prior.result;end if;
 allowed:=case when p_action='clock_in' then array['expected_open'] when p_action in('clock_out','leave_withdraw','leave_cancel_request') then array['id','version']
   when p_action='leave_apply' then array['start_date','end_date','leave_type','portion','reason']
   when p_action in('leave_approve','leave_reject','leave_cancel','leave_keep') then array['id','version','note']
   when p_action='attendance_correct' then array['id','version','clock_in','clock_out','reason'] else null end;
 if allowed is null or exists(select 1 from jsonb_object_keys(p_record) k where not(k=any(allowed))) then raise exception 'Unknown staff action or fields.';end if;
 if p_action in('clock_in','clock_out') then
   select * into entry from public.staff_time_entries where staff_id=auth.uid() and clock_out is null for update;
   if p_action='clock_in' then
     if not(p_record ? 'expected_open') or p_record->'expected_open'<>'null'::jsonb or entry.id is not null then raise exception 'Your attendance changed. Refresh before clocking in.' using errcode='40001';end if;
     if exists(select 1 from public.staff_leave_requests where staff_id=auth.uid() and status in('approved','cancel_requested') and portion='full' and today between start_date and end_date) then
       raise exception 'You have approved leave today. Ask the PIC to resolve it before clocking in.';end if;
     insert into public.staff_time_entries(staff_id,staff_name,clock_in,created_at,updated_at) values(auth.uid(),actor_name,stamp,stamp,stamp) returning * into entry;
   else
     if entry.id is null or (p_record->>'id')::uuid is distinct from entry.id or (p_record->>'version')::integer is distinct from entry.version then
       raise exception 'Your attendance changed. Refresh before clocking out.' using errcode='40001';end if;
     before_record:=to_jsonb(entry);
     if stamp<=entry.clock_in then raise exception 'Clock out must be after clock in.';end if;
     update public.staff_time_entries set clock_out=stamp,version=version+1,updated_at=stamp where id=entry.id returning * into entry;
   end if;
   record:=to_jsonb(entry);
 elsif p_action='attendance_correct' then
   select * into entry from public.staff_time_entries where id=(p_record->>'id')::uuid for update;
   if entry.id is null then raise exception 'Attendance not found.';end if;
   if (p_record->>'version')::integer is distinct from entry.version then raise exception 'Attendance changed. Reopen it.' using errcode='40001';end if;
   if length(trim(coalesce(p_record->>'reason',''))) not between 1 and 500 then raise exception 'Enter a correction reason.';end if;
   start_stamp:=(p_record->>'clock_in')::timestamptz;end_stamp:=(p_record->>'clock_out')::timestamptz;
   if start_stamp is null or not isfinite(start_stamp) or start_stamp>stamp or end_stamp is not null and (not isfinite(end_stamp) or end_stamp<=start_stamp or end_stamp>stamp) then raise exception 'Check the attendance times.';end if;
   if exists(select 1 from public.staff_time_entries where staff_id=entry.staff_id and id<>entry.id and tstzrange(clock_in,clock_out,'[)')&&tstzrange(start_stamp,end_stamp,'[)')) then
     raise exception 'These times overlap another shift.';end if;
   before_record:=to_jsonb(entry);
   update public.staff_time_entries set clock_in=start_stamp,clock_out=end_stamp,version=version+1,correction_count=correction_count+1,updated_at=stamp where id=entry.id returning * into entry;
   record:=to_jsonb(entry);
 elsif p_action='leave_apply' then
   s:=(p_record->>'start_date')::date;e:=(p_record->>'end_date')::date;v_portion:=p_record->>'portion';
   if s is null or e is null or not isfinite(s) or not isfinite(e) or e<s or e-s>365
     or coalesce(p_record->>'leave_type','') not in('annual','medical','unpaid','other') or coalesce(v_portion,'') not in('full','am','pm')
     or v_portion<>'full' and s<>e or length(coalesce(p_record->>'reason',''))>500 then raise exception 'Check leave dates, type and reason.';end if;
   if exists(select 1 from public.staff_leave_requests where staff_id=auth.uid() and status in('pending','approved','cancel_requested') and start_date<=e and end_date>=s and
     (v_portion='full' or staff_leave_requests.portion='full' or staff_leave_requests.portion=v_portion)) then raise exception 'You already have a request for these dates. Check the existing request.';end if;
   insert into public.staff_leave_requests(staff_id,staff_name,start_date,end_date,leave_type,portion,reason,submitted_at,updated_at)
     values(auth.uid(),actor_name,s,e,p_record->>'leave_type',v_portion,trim(coalesce(p_record->>'reason','')),stamp,stamp) returning * into leave_row;
   record:=to_jsonb(leave_row);
 else
   select * into leave_row from public.staff_leave_requests where id=(p_record->>'id')::uuid for update;
   if leave_row.id is null then raise exception 'Leave request not found.';end if;
   if p_action in('leave_withdraw','leave_cancel_request') then
     if leave_row.staff_id<>auth.uid() then raise exception 'This is not your leave request.' using errcode='42501';end if;
   elsif leave_row.staff_id=auth.uid() then raise exception 'Another authorised PIC must decide your leave.' using errcode='42501';end if;
   if (p_record->>'version')::integer is distinct from leave_row.version then raise exception 'Leave request changed. Refresh before deciding.' using errcode='40001';end if;
   if (p_action in('leave_withdraw','leave_approve','leave_reject') and leave_row.status<>'pending')
     or (p_action='leave_cancel_request' and leave_row.status<>'approved')
     or (p_action in('leave_cancel','leave_keep') and leave_row.status<>'cancel_requested') then raise exception 'This action no longer applies. Refresh the request.' using errcode='40001';end if;
   if p_action in('leave_reject','leave_keep') and length(trim(coalesce(p_record->>'note',''))) not between 1 and 500 then raise exception 'Enter a reason for the decision.';end if;
   if length(coalesce(p_record->>'note',''))>500 then raise exception 'Decision note is too long.';end if;
   before_record:=to_jsonb(leave_row);
   update public.staff_leave_requests set status=case p_action when 'leave_withdraw' then 'withdrawn' when 'leave_cancel_request' then 'cancel_requested' when 'leave_approve' then 'approved' when 'leave_reject' then 'rejected' when 'leave_cancel' then 'cancelled' else 'approved' end,
     version=version+1,updated_at=stamp,
     decided_by=case when p_action in('leave_withdraw','leave_cancel_request') then decided_by else auth.uid() end,
     decided_by_name=case when p_action in('leave_withdraw','leave_cancel_request') then decided_by_name else actor_name end,
     decided_at=case when p_action in('leave_withdraw','leave_cancel_request') then decided_at else stamp end,
     decision_note=case when p_action in('leave_withdraw','leave_cancel_request') then decision_note else trim(coalesce(p_record->>'note','')) end
     where id=leave_row.id returning * into leave_row;
   record:=to_jsonb(leave_row);
 end if;
 result:=jsonb_build_object('operation_id',p_operation_id,'action',p_action,'record',record);
 insert into public.staff_work_operations(actor_id,operation_id,payload,result,created_at) values(auth.uid(),p_operation_id,intent,result,stamp);
 insert into public.audit_logs(actor_id,action,entity_type,entity_id,before_json,after_json,created_at) values(auth.uid(),'staff_'||p_action,
   case when p_action in('clock_in','clock_out','attendance_correct') then 'staff_time' else 'staff_leave' end,(record->>'id')::uuid,before_record,
   jsonb_build_object('actor_name',actor_name,'record',record,'submission',p_record,'operation_id',p_operation_id),stamp);
 return result;
end $$;
revoke all on function public.read_staff_work(date,date,boolean),public.mutate_staff_work(uuid,text,jsonb) from public,anon;
grant execute on function public.read_staff_work(date,date,boolean),public.mutate_staff_work(uuid,text,jsonb) to authenticated;

create function public.read_staff_work_history(p_id uuid,p_kind text) returns jsonb
language plpgsql stable security definer set search_path=public,pg_temp as $$
declare staff uuid;entity text;begin
 if p_kind='time' then select staff_id into staff from public.staff_time_entries where id=p_id;entity:='staff_time';
 elsif p_kind='leave' then select staff_id into staff from public.staff_leave_requests where id=p_id;entity:='staff_leave';
 else raise exception 'Unknown staff record type.';end if;
 if staff=auth.uid() then perform public.require_permission('staff.self');
 elsif p_kind='time' then perform public.require_permission('staff.attendance.manage');
 else perform public.require_permission('staff.leave.approve');end if;
 if staff is null then raise exception 'Staff record not found.';end if;
 if (select count(*) from public.audit_logs where entity_type=entity and entity_id=p_id)>10000 then raise exception 'Staff history is too large. Ask the owner.';end if;
 return coalesce((select jsonb_agg(jsonb_build_object('action',action,'created_at',created_at,
   'actor_name',after_json->>'actor_name','before_record',before_json,'after_record',after_json->'record','submission',after_json->'submission') order by created_at,id)
   from public.audit_logs where entity_type=entity and entity_id=p_id),'[]'::jsonb);
end $$;
revoke all on function public.read_staff_work_history(uuid,text) from public,anon;
grant execute on function public.read_staff_work_history(uuid,text) to authenticated;
