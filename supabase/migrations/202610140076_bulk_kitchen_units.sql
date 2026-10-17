-- Batch orchestration delegates every conversion to the existing unit authority.
create table public.kitchen_unit_batches(
 actor_id uuid not null references auth.users(id),operation_id uuid not null,payload jsonb not null,result jsonb not null,
 created_at timestamptz not null default clock_timestamp(),primary key(actor_id,operation_id)
);
alter table public.kitchen_unit_batches enable row level security;
revoke all on public.kitchen_unit_batches from public,anon,authenticated;
create function public.save_kitchen_units(p_operation_id uuid,p_lines jsonb) returns jsonb
language plpgsql security definer set search_path=public,pg_temp as $$
declare prior public.kitchen_unit_batches%rowtype;l jsonb;rows jsonb:='[]'::jsonb;saved jsonb;result jsonb;
begin
 perform public.require_permission('kitchen.manage');
 if p_operation_id is null or p_lines is null or jsonb_typeof(p_lines)<>'array' then raise exception 'Reviewed unit settings required.';end if;
 if jsonb_array_length(p_lines) not between 1 and 200 then raise exception 'Choose 1-200 items.';end if;
 perform pg_advisory_xact_lock(hashtextextended(auth.uid()::text||p_operation_id::text,73091));
 perform public.require_permission('kitchen.manage');
 select * into prior from public.kitchen_unit_batches where actor_id=auth.uid() and operation_id=p_operation_id;
 if found then if prior.payload<>p_lines then raise exception 'This unit save already has different details.';end if;return prior.result;end if;
 for l in select value from jsonb_array_elements(p_lines) loop
  if jsonb_typeof(l)<>'object' or not(l ?& array['id','unit','factor','expected_updated_at','carton_size']) then raise exception 'Incomplete unit setting.';end if;
  if exists(select 1 from jsonb_object_keys(l) k where k not in('id','unit','factor','expected_updated_at','carton_size')) or l->>'expected_updated_at' is null then raise exception 'Invalid unit setting.';end if;
 end loop;
 if (select count(distinct value->>'id') from jsonb_array_elements(p_lines))<>jsonb_array_length(p_lines) then raise exception 'Choose different items.';end if;
 -- Lock in a stable order; a stale item rolls back the whole batch, including audits.
 perform 1 from public.ingredient_items where id in(select (value->>'id')::uuid from jsonb_array_elements(p_lines)) order by id for update;
 perform public.require_permission('kitchen.manage');
 for l in select value from jsonb_array_elements(p_lines) order by value->>'id' loop
  saved:=public.save_kitchen_unit((l->>'id')::uuid,l->>'unit',(l->>'factor')::numeric,(l->>'expected_updated_at')::timestamptz,(l->>'carton_size')::integer);
  rows:=rows||jsonb_build_array(saved);
 end loop;
 result:=jsonb_build_object('operation_id',p_operation_id,'actor_id',auth.uid(),'items',rows);
 insert into public.kitchen_unit_batches(actor_id,operation_id,payload,result) values(auth.uid(),p_operation_id,p_lines,result);
 return result;
end $$;
revoke all on function public.save_kitchen_units(uuid,jsonb) from public,anon;
grant execute on function public.save_kitchen_units(uuid,jsonb) to authenticated;
