-- Reuse the existing outbox. No network calls run inside stock transactions.
begin;
insert into public.notification_rules(code,name,department_code,enabled,sort_order)
values ('kitchen.arrival_confirmed','Delivery confirmed','kitchen',true,5),
       ('kitchen.count_confirmed','Stock check confirmed','kitchen',true,6)
on conflict(code) do nothing;

create table public.kitchen_alert_deliveries(
  message_id uuid primary key references public.outbound_messages(id) on delete cascade,
  status text not null default 'pending' check(status in('pending','sending','sent','failed','uncertain')),
  attempts integer not null default 0,
  claim_id uuid, claimed_at timestamptz,
  provider_message_id text, provider text, sent_at timestamptz, last_error text,
  available_at timestamptz not null default now()
);
alter table public.kitchen_alert_deliveries enable row level security;
revoke all on public.kitchen_alert_deliveries from public,anon,authenticated;
grant all on public.kitchen_alert_deliveries to service_role;

create function public.enqueue_kitchen_alert_delivery() returns trigger
language plpgsql security definer set search_path=public as $$
begin
  if new.rule_code in('kitchen.request_submitted','kitchen.arrival_confirmed','kitchen.count_confirmed') then
    insert into public.kitchen_alert_deliveries(message_id) values(new.id) on conflict do nothing;
  end if;
  return new;
end $$;
create trigger kitchen_alert_outbox after insert on public.outbound_messages
for each row execute function public.enqueue_kitchen_alert_delivery();

create function public.queue_kitchen_submission_alert() returns trigger
language plpgsql security definer set search_path=public as $$
declare code text; title text; who text; n integer; d date; body text;
begin
  if new.action not in('receive_purchase_batch','kitchen_arrival','kitchen_stock_count') then return new; end if;
  select coalesce(full_name,'Name not recorded') into who from public.profiles where id=new.actor_id;
  if new.action='kitchen_stock_count' then
    code:='kitchen.count_confirmed';title:='Stock check confirmed';
    n:=jsonb_array_length(coalesce(new.after_json->'items','[]'::jsonb));
  else
    code:='kitchen.arrival_confirmed';title:='Delivery confirmed';
    n:=jsonb_array_length(coalesce(new.after_json->'receipts',new.after_json->'lines','[]'::jsonb));
  end if;
  d:=(new.created_at at time zone 'Asia/Kuala_Lumpur')::date;
  body:=title||E'\n'||n||' items'||E'\nRecorded by: '||coalesce(who,'Name not recorded')||
    E'\nRecorded: '||to_char(new.created_at at time zone 'Asia/Kuala_Lumpur','YYYY-MM-DD HH24:MI')||' MYT'||
    E'\nReference: '||new.entity_id::text;
  perform public.queue_outbound_message(code,title,body,d,new.entity_type,new.entity_id);
  return new;
end $$;
create trigger kitchen_submission_alert after insert on public.audit_logs
for each row execute function public.queue_kitchen_submission_alert();

create function public.claim_kitchen_alerts(p_limit integer default 5) returns jsonb
language plpgsql security definer set search_path=public as $$
declare result jsonb;
begin
  if p_limit is null or p_limit not between 1 and 10 then raise exception 'Invalid alert batch size'; end if;
  -- A lost response may already have delivered a message. Do not blindly resend it.
  update public.kitchen_alert_deliveries set status='uncertain',last_error='Sender stopped before delivery could be verified'
  where status='sending' and claimed_at<now()-interval '5 minutes';
  with candidates as(
    select d.message_id from public.kitchen_alert_deliveries d
    join public.outbound_messages m on m.id=d.message_id
    join public.notification_rules r on r.code=m.rule_code and r.enabled
    where m.status='queued' and d.status in('pending','failed') and d.attempts<3 and d.available_at<=now()
    order by m.created_at for update of d skip locked limit p_limit
  ), claimed as(
    update public.kitchen_alert_deliveries d set status='sending',attempts=attempts+1,claim_id=gen_random_uuid(),claimed_at=now()
    from candidates c where d.message_id=c.message_id returning d.*
  )
  select coalesce(jsonb_agg(jsonb_build_object('id',m.id,'claim_id',d.claim_id,'title',m.title,'body',m.body,'rule_code',m.rule_code)),'[]')
  into result from claimed d join public.outbound_messages m on m.id=d.message_id;
  return result;
end $$;

create function public.finish_kitchen_alert(p_id uuid,p_claim_id uuid,p_status text,p_provider_message_id text default null,p_error text default null) returns void
language plpgsql security definer set search_path=public as $$
begin
  if p_status not in('sent','failed','uncertain') then raise exception 'Invalid result'; end if;
  update public.kitchen_alert_deliveries set status=p_status,provider_message_id=p_provider_message_id,provider='telegram',
    sent_at=case when p_status='sent' then now() else null end,last_error=left(p_error,200),available_at=now()+interval '5 minutes'
  where message_id=p_id and claim_id=p_claim_id and status='sending';
  if not found then raise exception 'Alert claim changed'; end if;
  if p_status='sent' then update public.outbound_messages set status='sent',channel='telegram',sent_at=now(),send_note='Telegram bot delivery verified' where id=p_id;end if;
end $$;

create function public.read_kitchen_alerts() returns jsonb
language plpgsql stable security definer set search_path=public as $$
begin
  perform public.require_permission('platform.settings.manage');
  return jsonb_build_object('verified',exists(select 1 from public.kitchen_alert_deliveries where status='sent'),
    'messages',(select coalesce(jsonb_agg(to_jsonb(q)),'[]') from(
      select m.id,m.title,m.body,m.created_at,d.status delivery_status
      from public.kitchen_alert_deliveries d join public.outbound_messages m on m.id=d.message_id
      order by m.created_at desc limit 30
    ) q));
end $$;
revoke all on function public.enqueue_kitchen_alert_delivery(),public.queue_kitchen_submission_alert(),public.claim_kitchen_alerts(integer),public.finish_kitchen_alert(uuid,uuid,text,text,text),public.read_kitchen_alerts() from public,anon,authenticated;
grant execute on function public.claim_kitchen_alerts(integer),public.finish_kitchen_alert(uuid,uuid,text,text,text) to service_role;
grant execute on function public.read_kitchen_alerts() to authenticated;
commit;
