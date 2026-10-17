-- Native kitchen lists; no WhatsApp quantities or opening balances are imported.
alter table public.ingredient_items
  add column kitchen_key text,
  add column kitchen_label text,
  add column kitchen_group text,
  add column kitchen_unit text,
  add column kitchen_factor numeric check(kitchen_factor>0 and kitchen_factor<=1e9),
  add column kitchen_scopes text[],
  add column kitchen_order integer;
create unique index ingredient_kitchen_key on public.ingredient_items(kitchen_key) where kitchen_key is not null;
alter table public.ingredient_movements add column display_unit text,add column display_factor numeric;
create function public.stamp_kitchen_movement_unit() returns trigger language plpgsql security definer set search_path=public as $$
begin
  select kitchen_unit,kitchen_factor into new.display_unit,new.display_factor from public.ingredient_items where id=new.ingredient_id;
  return new;
end $$;
revoke all on function public.stamp_kitchen_movement_unit() from public,anon,authenticated;
create trigger kitchen_movement_unit before insert on public.ingredient_movements for each row execute function public.stamp_kitchen_movement_unit();

do $$declare d jsonb;i public.ingredient_items%rowtype;n integer:=0;matches integer;v_base text;v_factor numeric;begin
  for d in select value from jsonb_array_elements($catalogue$[{"key":"timun","name":"Timun","aliases":["Timun","Cucumber"],"unit":"biji","orderUnit":"biji","group":"Bahan Mentah","scopes":["guest","staff"]},{"key":"jagung","name":"Jagung","aliases":["Jagung","Corn"],"unit":"biji","orderUnit":"biji","group":"Bahan Mentah","scopes":["guest","staff"]},{"key":"tomato","name":"Tomato","aliases":["Tomato","Tomato","Tomatoes"],"unit":"biji","orderUnit":"biji","group":"Bahan Mentah","scopes":["guest","staff"]},{"key":"carrot","name":"Carrot","aliases":["Carrot","Lobak","Carrot"],"unit":"biji","orderUnit":"biji","group":"Bahan Mentah","scopes":["guest","staff"]},{"key":"cili-besar","name":"Cili Besar","aliases":["Cili Besar","Large Chilli"],"unit":"kg","orderUnit":"kg","group":"Bahan Mentah","scopes":["guest","staff"]},{"key":"cili-merah","name":"Cili Merah","aliases":["Cili Merah","Red Chilli"],"unit":"biji","orderUnit":"biji","group":"Bahan Mentah","scopes":["guest","staff"]},{"key":"nenas","name":"Nenas","aliases":["Nenas","Pineapple"],"unit":"pack","orderUnit":"pack","group":"Bahan Mentah","scopes":["guest","staff"]},{"key":"bawang-besar","name":"Bawang Besar","aliases":["Bawang Besar","Onion","Onions"],"unit":"bag","orderUnit":"bag","group":"Bahan Mentah","scopes":["guest","staff"]},{"key":"bawang-putih","name":"Bawang Putih","aliases":["Bawang Putih","Garlic"],"unit":"biji","orderUnit":"bag","group":"Bahan Mentah","scopes":["guest","staff"]},{"key":"bawang-bombay","name":"Bawang Bombay","aliases":["Bawang Bombay","Bombay Onion"],"unit":"biji","orderUnit":"bag","group":"Bahan Mentah","scopes":["guest","staff"]},{"key":"bawang-holland","name":"Bawang Holland","aliases":["Bawang Holland","Holland Onion"],"unit":"biji","orderUnit":"bag","group":"Bahan Mentah","scopes":["guest","staff"]},{"key":"kentang","name":"Kentang","aliases":["Kentang","Potato"],"unit":"bag","orderUnit":"bag","group":"Bahan Mentah","scopes":["guest","staff"]},{"key":"labu-kuning","name":"Labu Kuning","aliases":["Labu Kuning","Pumpkin"],"unit":"biji","orderUnit":"biji","group":"Bahan Mentah","scopes":["staff"]},{"key":"kubis","name":"Kubis","aliases":["Kubis","Cabbage"],"unit":"biji","orderUnit":"biji","group":"Bahan Mentah","scopes":["staff"]},{"key":"beras","name":"Beras","aliases":["Beras","Rice"],"unit":"pack","orderUnit":"pack","group":"Bahan Kering","scopes":["guest","staff"]},{"key":"telur","name":"Telur","aliases":["Telur","Egg","Eggs"],"unit":"biji","orderUnit":"biji","group":"Bahan Kering","scopes":["guest","staff"]},{"key":"gula","name":"Gula","aliases":["Gula","Sugar"],"unit":"pack","orderUnit":"pack","group":"Bahan Kering","scopes":["guest","staff"]},{"key":"minyak-masak","name":"Minyak Masak","aliases":["Minyak Masak","Cooking Oil"],"unit":"gelen","orderUnit":"gelen","group":"Bahan Kering","scopes":["guest","staff"]},{"key":"tepung-gandum","name":"Tepung Gandum","aliases":["Tepung Gandum","Wheat Flour"],"unit":"pack","orderUnit":"pack","group":"Bahan Kering","scopes":["guest","staff"]},{"key":"tepung-jagung","name":"Tepung Jagung","aliases":["Tepung Jagung","Corn Flour"],"unit":"pack","orderUnit":"pack","group":"Bahan Kering","scopes":["guest","staff"]},{"key":"garam","name":"Garam","aliases":["Garam","Salt"],"unit":"pack","orderUnit":"pack","group":"Bahan Kering","scopes":["guest","staff"]},{"key":"ajinomoto","name":"Ajinomoto","aliases":["Ajinomoto","Ajinamoto"],"unit":"pack","orderUnit":"pack","group":"Bahan Kering","scopes":["guest","staff"]},{"key":"sos-cili","name":"Sos Cili","aliases":["Sos Cili","Chilli Sauce"],"unit":"gelen","orderUnit":"gelen","group":"Bahan Kering","scopes":["guest","staff"]},{"key":"sos-tomato","name":"Sos Tomato","aliases":["Sos Tomato","Tomato Sauce"],"unit":"gelen","orderUnit":"gelen","group":"Bahan Kering","scopes":["guest","staff"]},{"key":"sos-tiram","name":"Sos Tiram","aliases":["Sos Tiram","Oyster Sauce"],"unit":"gelen","orderUnit":"gelen","group":"Bahan Kering","scopes":["guest","staff"]},{"key":"cuka","name":"Cuka","aliases":["Cuka","Vinegar"],"unit":"gelen","orderUnit":"gelen","group":"Bahan Kering","scopes":["guest","staff"]},{"key":"black-pepper","name":"Black Pepper","aliases":["Black Pepper","Black Pepper"],"unit":"pack","orderUnit":"pack","group":"Bahan Kering","scopes":["guest","staff"]},{"key":"mushroom","name":"Mushroom","aliases":["Mushroom","Mushroom"],"unit":"tin","orderUnit":"tin","group":"Bahan Kering","scopes":["guest","staff"]},{"key":"laici-tin","name":"Laici Tin","aliases":["Laici Tin","Laici","Canned Lychee"],"unit":"tin","orderUnit":"tin","group":"Bahan Kering","scopes":["guest","staff"]},{"key":"syrup-laici","name":"Syrup Laici","aliases":["Syrup Laici","Lychee Syrup"],"unit":"botol","orderUnit":"botol","group":"Bahan Kering","scopes":["guest","staff"]},{"key":"keropok-ikan","name":"Keropok Ikan","aliases":["Keropok Ikan","Fish Crackers"],"unit":"pack","orderUnit":"pack","group":"Bahan Kering","scopes":["guest","staff"]},{"key":"serbuk-kari","name":"Serbuk Kari","aliases":["Serbuk Kari","Curry Powder"],"unit":"pack","orderUnit":"pack","group":"Bahan Kering","scopes":["guest","staff"]},{"key":"maggi-kari","name":"Maggi Kari","aliases":["Maggi Kari","Meggi Kari"],"unit":"pack","orderUnit":"pack","group":"Bahan Kering","scopes":["staff"]},{"key":"mihun","name":"Mihun","aliases":["Mihun","Bihun"],"unit":"pack","orderUnit":"pack","group":"Bahan Kering","scopes":["staff"]},{"key":"kopiko","name":"Kopiko","aliases":["Kopiko","Kopiko"],"unit":"pack","orderUnit":"pack","group":"Bahan Kering","scopes":["staff"]},{"key":"susu-cair","name":"Susu Cair","aliases":["Susu Cair","Evaporated Milk"],"unit":"tin","orderUnit":"tin","group":"Bahan Kering","scopes":["staff"]},{"key":"sayap","name":"Sayap","aliases":["Sayap","Chicken Wings","Wings"],"unit":"pack","orderUnit":"pack","group":"Frozen","scopes":["guest","staff"]},{"key":"udang","name":"Udang","aliases":["Udang","Prawn","Prawns"],"unit":"pack","orderUnit":"pack","group":"Frozen","scopes":["guest","staff"]},{"key":"sotong","name":"Sotong","aliases":["Sotong","Squid"],"unit":"pack","orderUnit":"pack","group":"Frozen","scopes":["guest","staff"]},{"key":"ikan","name":"Ikan","aliases":["Ikan","Fish"],"unit":"pack","orderUnit":"pack","group":"Frozen","scopes":["guest","staff"]},{"key":"ketam","name":"Ketam","aliases":["Ketam","Crab","Crabs"],"unit":"ekor","orderUnit":"kg","group":"Frozen","scopes":["guest","staff"]},{"key":"ais","name":"Ais","aliases":["Ais","Ice"],"unit":"pack","orderUnit":"pack","group":"Frozen","scopes":["guest","staff"]},{"key":"ayam-bulat","name":"Ayam Bulat","aliases":["Ayam Bulat","Whole Chicken","Ayam"],"unit":"ekor","orderUnit":"ekor","group":"Frozen","scopes":["staff"]},{"key":"plastik-sampah","name":"Plastik Sampah","aliases":["Plastik Sampah","Plstik Sampah","Garbage Bags"],"unit":"pack","orderUnit":"pack","group":"Keperluan Dapur","scopes":["guest","staff"]},{"key":"baking-paper-pink","name":"Baking Paper Pink","aliases":["Baking Paper Pink","Pink Baking Paper"],"unit":"pack","orderUnit":"pack","group":"Keperluan Dapur","scopes":["guest","staff"]},{"key":"cooking-gas","name":"Cooking Gas","aliases":["Cooking Gas","Gas Memasak","LPG"],"unit":"kg","orderUnit":"kg","group":"Keperluan Dapur","scopes":["guest","staff"]},{"key":"snorkelling-mineral-water","name":"Snorkelling Mineral Water","aliases":["Snorkelling Mineral Water","Snorkeling Mineral Water"],"unit":"botol","orderUnit":"carton","group":"Snorkelling","scopes":["water"]}]$catalogue$::jsonb) loop
    select count(*) into matches from public.ingredient_items where lower(name) in(select lower(value) from jsonb_array_elements_text(d->'aliases'));
    if matches>1 then continue;end if;
    select * into i from public.ingredient_items where lower(name) in(select lower(value) from jsonb_array_elements_text(d->'aliases'));
    v_base:=case when d->>'unit'='kg' then 'g' else 'unit' end;
    v_factor:=case when v_base='g' then 1000 else 1 end;
    if i.id is null then
      insert into public.ingredient_items(name,category,base_unit,default_pack_size,pack_label,cost_per_base_unit,active)
        values(d->>'name',case when d->>'group'='Frozen' then 'Seafood' else 'Food' end,v_base,1,d->>'unit',null,true) returning * into i;
    elsif i.base_unit<>v_base or (v_base='unit' and d->>'unit' not in ('biji','ekor')) then v_factor:=null;
    end if;
    update public.ingredient_items set kitchen_key=d->>'key',kitchen_label=d->>'name',kitchen_group=d->>'group',kitchen_unit=d->>'unit',
      kitchen_factor=v_factor,kitchen_scopes=array(select jsonb_array_elements_text(d->'scopes')),kitchen_order=n where id=i.id;
    -- Keep ordering units distinct from the units counted by the kitchen.
    if to_regclass('public.catalogue_items') is not null then
      select count(*) into matches from public.catalogue_items where kind='ingredient' and lower(name) in(select lower(value) from jsonb_array_elements_text(d->'aliases'));
      if matches=1 then
        update public.catalogue_items set name=d->>'name',category=d->>'group',unit=d->>'orderUnit' where kind='ingredient' and lower(name) in(select lower(value) from jsonb_array_elements_text(d->'aliases'));
      elsif matches=0 then insert into public.catalogue_items(kind,name,category,unit,active) values('ingredient',d->>'name',d->>'group',d->>'orderUnit',true);end if;
    end if;
    n:=n+1;
  end loop;
end $$;

create or replace function public.read_kitchen_stock() returns jsonb language plpgsql stable security definer set search_path=public as $$
begin
  if not(public.has_permission('kitchen.production.manage') or public.has_permission('purchasing.receive')) then raise exception 'Kitchen access required.' using errcode='42501';end if;
  return jsonb_build_object('items',(select coalesce(jsonb_agg((to_jsonb(i)-'cost_per_base_unit')||jsonb_build_object(
    'balance_version',b.updated_at,'ingredient_balances',jsonb_build_object('quantity_on_hand',coalesce(b.quantity_on_hand,0)),
    'last_count_at',(select max(m.created_at) from public.ingredient_movements m where m.ingredient_id=i.id and m.movement_type='count'))
    order by i.kitchen_order nulls last,i.name),'[]') from public.ingredient_items i left join public.ingredient_balances b on b.ingredient_id=i.id where i.category in('Food','Seafood','Condiment')),
    'movements',(select coalesce(jsonb_agg(to_jsonb(m) order by m.created_at desc),'[]') from(
      select im.*,jsonb_build_object('name',i.name,'base_unit',i.base_unit) as ingredient_items from public.ingredient_movements im join public.ingredient_items i on i.id=im.ingredient_id where i.category in('Food','Seafood','Condiment') order by im.created_at desc limit 200)m));
end $$;

create function public.save_kitchen_unit(p_id uuid,p_unit text,p_factor numeric,p_expected_updated_at timestamptz,p_carton_size integer default null) returns jsonb
language plpgsql security definer set search_path=public as $$
declare i public.ingredient_items%rowtype;before_row jsonb;
begin
  perform public.require_permission('kitchen.manage');
  select * into i from public.ingredient_items where id=p_id and kitchen_key is not null for update;
  if not found then raise exception 'Kitchen item unavailable.';end if;
  if i.updated_at is distinct from p_expected_updated_at then raise exception 'Item changed. Reopen unit setup.' using errcode='40001';end if;
  before_row:=to_jsonb(i);
  if p_unit is null or p_unit not in('biji','ekor','pack','bag','gelen','tin','botol','kg','g','ml','L','pcs') or p_factor is null or p_factor<=0 or p_factor>1e9 or p_factor::text in('NaN','Infinity','-Infinity') or (i.base_unit='unit' and p_factor<>trunc(p_factor)) then raise exception 'Check the unit conversion.';end if;
  if (p_unit='kg' and (i.base_unit<>'g' or p_factor<>1000)) or (p_unit='g' and (i.base_unit<>'g' or p_factor<>1)) or (p_unit='L' and (i.base_unit<>'ml' or p_factor<>1000)) or (p_unit='ml' and (i.base_unit<>'ml' or p_factor<>1)) then raise exception 'Weight and volume units must use their exact conversion.';end if;
  if p_unit in('biji','ekor','pcs') and (i.base_unit<>'unit' or p_factor<>1) then raise exception 'Pieces need a piece-based stock unit; do not estimate pieces from weight.';end if;
  if i.kitchen_key='snorkelling-mineral-water' and (p_unit<>'botol' or p_factor<>1) then raise exception 'Water stock stays in individual bottles. Set bottles per carton separately.';end if;
  if p_carton_size is not null and (i.kitchen_key<>'snorkelling-mineral-water' or p_carton_size not between 1 and 10000) then raise exception 'Enter bottles per water carton.';end if;
  update public.ingredient_items set kitchen_unit=p_unit,kitchen_factor=p_factor,updated_at=clock_timestamp(),
    default_pack_size=coalesce(p_carton_size,default_pack_size),pack_label=case when p_carton_size is null then pack_label else 'Carton' end where id=p_id returning * into i;
  insert into public.audit_logs(actor_id,action,entity_type,entity_id,before_json,after_json) values(auth.uid(),'kitchen_unit_setup','ingredient_item',p_id,before_row,to_jsonb(i));
  return to_jsonb(i)-'cost_per_base_unit';
end $$;

create table public.kitchen_arrivals(id uuid primary key default gen_random_uuid(),date date not null,supplier text not null,reference text not null default '',lines jsonb not null,created_by uuid not null references auth.users(id),created_by_name text not null,created_at timestamptz not null default now());
create table public.kitchen_water_usage(id uuid primary key default gen_random_uuid(),business_date date unique not null,bottles integer not null check(bottles>=0),closed boolean not null default false,notes text not null default '',revision integer not null default 1,created_by uuid not null references auth.users(id),created_by_name text not null,updated_at timestamptz not null default clock_timestamp(),check(not closed or bottles=0));
alter table public.kitchen_arrivals enable row level security;
alter table public.kitchen_water_usage enable row level security;
revoke all on public.kitchen_arrivals,public.kitchen_water_usage from anon,authenticated;
grant select on public.kitchen_arrivals,public.kitchen_water_usage to authenticated;
create policy kitchen_arrivals_read on public.kitchen_arrivals for select to authenticated using(public.has_permission('purchasing.receive') or public.has_permission('purchasing.cost.view'));
create policy kitchen_water_read on public.kitchen_water_usage for select to authenticated using(public.has_permission('kitchen.production.manage') or public.has_permission('purchasing.cost.view'));

create function public.read_kitchen_arrivals(p_from date,p_to date) returns jsonb language plpgsql stable security definer set search_path=public as $$
begin
  perform public.require_permission('purchasing.receive');
  if p_from is null or p_to is null or p_to<p_from or p_to-p_from>370 then raise exception 'Select a valid date range.';end if;
  return(select coalesce(jsonb_agg(to_jsonb(a) order by created_at desc),'[]') from public.kitchen_arrivals a where date between p_from and p_to);
end $$;
create function public.record_kitchen_arrival(p_record jsonb,p_operation_id uuid) returns jsonb language plpgsql security definer set search_path=public as $$
declare op public.operation_requests%rowtype;i public.ingredient_items%rowtype;l jsonb;r public.kitchen_arrivals%rowtype;
  h text:=md5(p_record::text);d date:=(p_record->>'date')::date;qty numeric;entered numeric;balance numeric;lines jsonb:='[]';staff text;
begin
  perform public.require_permission('purchasing.receive');perform pg_advisory_xact_lock(73081,1);
  if p_operation_id is null then raise exception 'Submission reference required.';end if;
  select * into op from public.operation_requests where actor_id=auth.uid() and operation='kitchen_arrival' and request_id=p_operation_id;
  if found then if op.payload_hash<>h then raise exception 'This delivery already has different details.';end if;return(select to_jsonb(a) from public.kitchen_arrivals a where id=op.result_id);end if;
  if d is null or d>(now() at time zone 'Asia/Kuala_Lumpur')::date or coalesce(length(trim(p_record->>'supplier')),0) not between 1 and 160 or length(coalesce(p_record->>'reference',''))>120 or jsonb_typeof(p_record->'lines') is distinct from 'array' or jsonb_array_length(p_record->'lines') not between 1 and 200 then raise exception 'Check date, supplier and delivered items.';end if;
  if (select count(distinct value->>'ingredient_id') from jsonb_array_elements(p_record->'lines'))<>jsonb_array_length(p_record->'lines') then raise exception 'An item appears twice.';end if;
  select nullif(trim(full_name),'') into staff from public.profiles where id=auth.uid();if staff is null then raise exception 'Your profile needs a staff name.';end if;
  r.id:=gen_random_uuid();
  for l in select value from jsonb_array_elements(p_record->'lines') order by value->>'ingredient_id' loop
    select * into i from public.ingredient_items where id=(l->>'ingredient_id')::uuid and active and category in('Food','Seafood','Condiment') for update;
    if not found or i.base_unit is distinct from l->>'unit' or i.updated_at is distinct from (l->>'expected_version')::timestamptz then raise exception 'Item changed. Refresh this delivery.' using errcode='40001';end if;
    qty:=(l->>'quantity')::numeric;entered:=(l->>'entered_quantity')::numeric;
    if qty is null or entered is null or qty<=0 or qty>1e9 or qty<>round(qty,2) or qty::text in('NaN','Infinity','-Infinity') or (i.base_unit='unit' and qty<>trunc(qty)) or qty<>entered*coalesce(case when i.kitchen_key is not null then i.kitchen_factor else case when i.base_unit='g' then 1000 else 1 end end,0) then raise exception 'Check delivered quantities and unit setup.';end if;
    insert into public.ingredient_balances(ingredient_id,quantity_on_hand) values(i.id,0) on conflict(ingredient_id) do nothing;
    select quantity_on_hand into balance from public.ingredient_balances where ingredient_id=i.id for update;
    update public.ingredient_balances set quantity_on_hand=balance+qty,updated_at=clock_timestamp() where ingredient_id=i.id;
    insert into public.ingredient_movements(ingredient_id,movement_type,quantity_change,quantity_before,quantity_after,unit_input,input_quantity,reference_type,reference_id,reason,notes,entered_by,created_by)
      values(i.id,'stock_in',qty,balance,balance+qty,'base',qty,'kitchen_arrival',r.id,'Kitchen Delivery',d::text||' | '||trim(p_record->>'supplier')||' | '||coalesce(p_record->>'reference',''),staff,auth.uid());
    lines:=lines||jsonb_build_array(jsonb_build_object('ingredient_id',i.id,'name',coalesce(i.kitchen_label,i.name),'quantity',qty,'entered_quantity',entered,'display_unit',coalesce(i.kitchen_unit,case when i.base_unit='g' then 'kg' when i.base_unit='unit' then 'pcs' else i.base_unit end),'unit',i.base_unit));
  end loop;
  insert into public.kitchen_arrivals(id,date,supplier,reference,lines,created_by,created_by_name) values(r.id,d,trim(p_record->>'supplier'),coalesce(p_record->>'reference',''),lines,auth.uid(),staff) returning * into r;
  insert into public.operation_requests(actor_id,operation,request_id,payload_hash,result_id) values(auth.uid(),'kitchen_arrival',p_operation_id,h,r.id);
  insert into public.audit_logs(actor_id,action,entity_type,entity_id,after_json) values(auth.uid(),'kitchen_arrival','kitchen_arrival',r.id,to_jsonb(r));
  return to_jsonb(r);
end $$;
create function public.read_kitchen_water_usage(p_from date,p_to date) returns jsonb language plpgsql stable security definer set search_path=public as $$
begin
  if not(public.has_permission('kitchen.production.manage') or public.has_permission('purchasing.cost.view')) then raise exception 'Access denied.' using errcode='42501';end if;
  if p_from is null or p_to is null or p_to<p_from or p_to-p_from>370 then raise exception 'Select a valid date range.';end if;
  return(select coalesce(jsonb_agg(to_jsonb(w) order by business_date desc),'[]') from public.kitchen_water_usage w where business_date between p_from and p_to);
end $$;
create function public.save_kitchen_water_usage(p_record jsonb,p_expected_updated_at timestamptz,p_operation_id uuid) returns jsonb language plpgsql security definer set search_path=public as $$
declare op public.operation_requests%rowtype;old public.kitchen_water_usage%rowtype;r public.kitchen_water_usage%rowtype;i public.ingredient_items%rowtype;
  h text:=md5(p_record::text||coalesce(p_expected_updated_at::text,''));d date:=(p_record->>'business_date')::date;n numeric:=(p_record->>'bottles')::numeric;c boolean:=(p_record->>'closed')::boolean;delta numeric;balance numeric;staff text;v_id uuid;
begin
  perform public.require_permission('kitchen.production.manage');perform pg_advisory_xact_lock(73081,1);
  if p_operation_id is null then raise exception 'Submission reference required.';end if;
  select * into op from public.operation_requests where actor_id=auth.uid() and operation='kitchen_water_usage' and request_id=p_operation_id;
  if found then if op.payload_hash<>h then raise exception 'This day already has different details.';end if;return(select to_jsonb(w) from public.kitchen_water_usage w where id=op.result_id);end if;
  if d is null or d>(now() at time zone 'Asia/Kuala_Lumpur')::date or n is null or n<0 or n>100000 or n<>trunc(n) or n::text in('NaN','Infinity','-Infinity') or c is null or (c and n<>0) or length(coalesce(p_record->>'notes',''))>2000 then raise exception 'Check the date and bottles used.';end if;
  select * into old from public.kitchen_water_usage where business_date=d for update;
  if old.updated_at is distinct from p_expected_updated_at then raise exception 'This day changed. Reload it.' using errcode='40001';end if;
  if old.id is not null then perform public.require_permission('kitchen.manage');if nullif(trim(p_record->>'notes'),'') is null then raise exception 'Enter a correction reason.';end if;end if;
  select * into i from public.ingredient_items where kitchen_key='snorkelling-mineral-water' and base_unit='unit' and active for update;
  if not found then raise exception 'Set up water stock in bottles first.';end if;
  insert into public.ingredient_balances(ingredient_id,quantity_on_hand) values(i.id,0) on conflict(ingredient_id) do nothing;
  select quantity_on_hand into balance from public.ingredient_balances where ingredient_id=i.id for update;
  delta:=coalesce(old.bottles,0)-n;if balance+delta<0 then raise exception 'Not enough water stock. Record the actual arrival first.';end if;
  select nullif(trim(full_name),'') into staff from public.profiles where id=auth.uid();if staff is null then raise exception 'Your profile needs a staff name.';end if;
  v_id:=coalesce(old.id,gen_random_uuid());
  if delta<>0 then
    update public.ingredient_balances set quantity_on_hand=balance+delta,updated_at=clock_timestamp() where ingredient_id=i.id;
    insert into public.ingredient_movements(ingredient_id,movement_type,quantity_change,quantity_before,quantity_after,unit_input,input_quantity,reference_type,reference_id,reason,notes,entered_by,created_by)
      values(i.id,'kitchen_production',delta,balance,balance+delta,'base',abs(delta),'kitchen_water_usage',v_id,'Snorkelling Mineral Water',d::text||' | '||coalesce(p_record->>'notes',''),staff,auth.uid());
  end if;
  insert into public.kitchen_water_usage(id,business_date,bottles,closed,notes,revision,created_by,created_by_name)
    values(v_id,d,n,c,coalesce(p_record->>'notes',''),coalesce(old.revision,0)+1,auth.uid(),staff)
    on conflict(business_date) do update set bottles=excluded.bottles,closed=excluded.closed,notes=excluded.notes,revision=excluded.revision,created_by=excluded.created_by,created_by_name=excluded.created_by_name,updated_at=clock_timestamp() returning * into r;
  insert into public.operation_requests(actor_id,operation,request_id,payload_hash,result_id) values(auth.uid(),'kitchen_water_usage',p_operation_id,h,r.id);
  insert into public.audit_logs(actor_id,action,entity_type,entity_id,before_json,after_json) values(auth.uid(),'kitchen_water_usage','kitchen_water_usage',r.id,to_jsonb(old),to_jsonb(r));return to_jsonb(r);
end $$;

-- Preserve familiar display units in saved meal records.
do $$declare d text;begin
 d:=pg_get_functiondef('public.save_daily_kitchen_usage(jsonb,timestamptz,uuid)'::regprocedure);
 d:=replace(d,'''unit_cost'',cost)', '''unit_cost'',cost,''display_unit'',i.kitchen_unit,''display_factor'',i.kitchen_factor)');
 d:=replace(d,'gq:=(l->>''guest_quantity'')::numeric;', 'if l ? ''expected_item_version'' and i.updated_at is distinct from (l->>''expected_item_version'')::timestamptz then raise exception ''Item unit changed. Refresh usage.'' using errcode=''40001'';end if; gq:=(l->>''guest_quantity'')::numeric;');
 d:=replace(d,'''name'',i.name','''name'',coalesce(i.kitchen_label,i.name)');
 execute d;
 if to_regprocedure('public.record_kitchen_stock_count(jsonb,text,uuid)') is not null then
   d:=pg_get_functiondef('public.record_kitchen_stock_count(jsonb,text,uuid)'::regprocedure);
   d:=replace(d,'actual_qty:=(item->>''counted_quantity'')::numeric;', 'if item ? ''expected_item_version'' and ingredient.updated_at is distinct from (item->>''expected_item_version'')::timestamptz then raise exception ''Item unit changed. Refresh and recount.'' using errcode=''40001'';end if; actual_qty:=(item->>''counted_quantity'')::numeric;');
   execute d;
 end if;
 if to_regprocedure('public.read_food_stock_history(date,date,text,text,timestamptz,uuid,integer)') is not null then
   d:=pg_get_functiondef('public.read_food_stock_history(date,date,text,text,timestamptz,uuid,integer)'::regprocedure);
   d:=replace(d,'''base_unit'',i.base_unit)', '''base_unit'',i.base_unit,''kitchen_label'',i.kitchen_label)');
   d:=replace(d,'i.name,im.entered_by','i.name,i.kitchen_label,im.entered_by');execute d;
 end if;
 if to_regprocedure('public.record_kitchen_stock_out_checked(jsonb,text,text,uuid)') is not null then
   d:=pg_get_functiondef('public.record_kitchen_stock_out_checked(jsonb,text,text,uuid)'::regprocedure);
   d:=replace(d,'select updated_at into before_version', 'if item ? ''expected_item_version'' and ingredient.updated_at is distinct from (item->>''expected_item_version'')::timestamptz then raise exception ''Item unit changed. Refresh and review.'' using errcode=''40001'';end if; select updated_at into before_version');execute d;
 end if;
end $$;
do $$declare signature text;d text;begin
 foreach signature in array array['public.save_expense_receipt(jsonb,uuid)','public.code_expense_receipt(uuid,text,jsonb,integer,text)'] loop
   d:=pg_get_functiondef(signature::regprocedure);
   d:=replace(d,'''pcs'',''pack'',''bag'',''bottle''','''pcs'',''biji'',''ekor'',''pack'',''bag'',''gelen'',''botol'',''bottle''');execute d;
 end loop;
end $$;
revoke all on function public.save_kitchen_unit(uuid,text,numeric,timestamptz,integer),public.read_kitchen_arrivals(date,date),public.record_kitchen_arrival(jsonb,uuid),public.read_kitchen_water_usage(date,date),public.save_kitchen_water_usage(jsonb,timestamptz,uuid) from public,anon;
grant execute on function public.save_kitchen_unit(uuid,text,numeric,timestamptz,integer),public.read_kitchen_arrivals(date,date),public.record_kitchen_arrival(jsonb,uuid),public.read_kitchen_water_usage(date,date),public.save_kitchen_water_usage(jsonb,timestamptz,uuid) to authenticated;
do $$declare t text;begin foreach t in array array['kitchen_arrivals','kitchen_water_usage'] loop begin execute format('alter publication supabase_realtime add table public.%I',t);exception when duplicate_object or undefined_object then null;end;end loop;end $$;
