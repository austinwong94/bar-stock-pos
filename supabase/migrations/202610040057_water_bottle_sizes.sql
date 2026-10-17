-- Keep historical unspecified bottles separate; never assign an assumed size or opening balance.
insert into public.ingredient_items(name,category,base_unit,default_pack_size,pack_label,active,kitchen_key,kitchen_label,kitchen_group,kitchen_unit,kitchen_factor,kitchen_scopes,kitchen_order)
select 'Mineral Water '||size,'Food','unit',1,'Bottle',true,key,'Mineral Water '||size,'Snorkelling','botol',1,array['water'],n
from(values('500 ml','snorkelling-mineral-water-500ml',47),('230 ml','snorkelling-mineral-water-230ml',48)) v(size,key,n)
where not exists(select 1 from public.ingredient_items where kitchen_key=v.key);
insert into public.catalogue_items(kind,name,category,unit,active)
select 'ingredient',i.name,'Snorkelling','carton',true from public.ingredient_items i
where kitchen_key in ('snorkelling-mineral-water-500ml','snorkelling-mineral-water-230ml') and not exists(select 1 from public.catalogue_items c where c.name=i.name);
update public.ingredient_items set kitchen_label='Mineral Water (Size Unspecified)' where kitchen_key='snorkelling-mineral-water';
alter table public.kitchen_water_usage add column water_key text not null default 'snorkelling-mineral-water'
  check(water_key in ('snorkelling-mineral-water','snorkelling-mineral-water-500ml','snorkelling-mineral-water-230ml'));
alter table public.kitchen_water_usage drop constraint kitchen_water_usage_business_date_key;
alter table public.kitchen_water_usage add unique(business_date,water_key);
do $$declare d text;begin
  d:=pg_get_functiondef('public.save_kitchen_water_usage(jsonb,timestamptz,uuid)'::regprocedure);
  d:=replace(d,'staff text;v_id uuid;','staff text;v_id uuid;water text:=coalesce(p_record->>''water_key'',''snorkelling-mineral-water'');');
  d:=replace(d,'where business_date=d for update','where business_date=d and water_key=water for update');
  d:=replace(d,'where kitchen_key=''snorkelling-mineral-water''','where kitchen_key=water and water in (''snorkelling-mineral-water'',''snorkelling-mineral-water-500ml'',''snorkelling-mineral-water-230ml'')');
  d:=replace(d,'kitchen_water_usage(id,business_date,bottles','kitchen_water_usage(id,water_key,business_date,bottles');
  d:=replace(d,'values(v_id,d,n,c,','values(v_id,water,d,n,c,');
  d:=replace(d,'on conflict(business_date)','on conflict(business_date,water_key)');
  execute d;
  d:=pg_get_functiondef('public.save_kitchen_unit(uuid,text,numeric,timestamptz,integer)'::regprocedure);
  d:=replace(d,'i.kitchen_key=''snorkelling-mineral-water''','i.kitchen_key like ''snorkelling-mineral-water%''');
  d:=replace(d,'i.kitchen_key<>''snorkelling-mineral-water''','i.kitchen_key not like ''snorkelling-mineral-water%''');
  execute d;
end $$;
