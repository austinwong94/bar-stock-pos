-- Repair missing reference lists only. Never import stock, costs or quantities.
do $$
declare
  definition record;
  position integer := 0;
  before_ingredients integer;
  before_catalogue integer;
  added_ingredients integer;
  added_catalogue integer;
begin
  perform pg_advisory_xact_lock(hashtextextended('lovely-paradise-kitchen-catalogue', 0));
  select count(*) into before_ingredients from public.ingredient_items;
  select count(*) into before_catalogue from public.catalogue_items;
  for definition in select * from (values
    ('timun','Timun','Bahan Mentah','biji','biji',false),
    ('jagung','Jagung','Bahan Mentah','biji','biji',false),
    ('tomato','Tomato','Bahan Mentah','biji','biji',false),
    ('carrot','Carrot','Bahan Mentah','biji','biji',false),
    ('cili-besar','Cili Besar','Bahan Mentah','kg','kg',false),
    ('cili-merah','Cili Merah','Bahan Mentah','biji','biji',false),
    ('nenas','Nenas','Bahan Mentah','pack','pack',false),
    ('bawang-besar','Bawang Besar','Bahan Mentah','bag','bag',false),
    ('bawang-putih','Bawang Putih','Bahan Mentah','biji','bag',false),
    ('bawang-bombay','Bawang Bombay','Bahan Mentah','biji','bag',false),
    ('bawang-holland','Bawang Holland','Bahan Mentah','biji','bag',false),
    ('kentang','Kentang','Bahan Mentah','bag','bag',false),
    ('labu-kuning','Labu Kuning','Bahan Mentah','biji','biji',true),
    ('kubis','Kubis','Bahan Mentah','biji','biji',true),
    ('beras','Beras','Bahan Kering','pack','pack',false),
    ('telur','Telur','Bahan Kering','biji','biji',false),
    ('gula','Gula','Bahan Kering','pack','pack',false),
    ('minyak-masak','Minyak Masak','Bahan Kering','gelen','gelen',false),
    ('tepung-gandum','Tepung Gandum','Bahan Kering','pack','pack',false),
    ('tepung-jagung','Tepung Jagung','Bahan Kering','pack','pack',false),
    ('garam','Garam','Bahan Kering','pack','pack',false),
    ('ajinomoto','Ajinomoto','Bahan Kering','pack','pack',false),
    ('sos-cili','Sos Cili','Bahan Kering','gelen','gelen',false),
    ('sos-tomato','Sos Tomato','Bahan Kering','gelen','gelen',false),
    ('sos-tiram','Sos Tiram','Bahan Kering','gelen','gelen',false),
    ('cuka','Cuka','Bahan Kering','gelen','gelen',false),
    ('black-pepper','Black Pepper','Bahan Kering','pack','pack',false),
    ('mushroom','Mushroom','Bahan Kering','tin','tin',false),
    ('laici-tin','Laici Tin','Bahan Kering','tin','tin',false),
    ('syrup-laici','Syrup Laici','Bahan Kering','botol','botol',false),
    ('keropok-ikan','Keropok Ikan','Bahan Kering','pack','pack',false),
    ('serbuk-kari','Serbuk Kari','Bahan Kering','pack','pack',false),
    ('maggi-kari','Maggi Kari','Bahan Kering','pack','pack',true),
    ('mihun','Mihun','Bahan Kering','pack','pack',true),
    ('kopiko','Kopiko','Bahan Kering','pack','pack',true),
    ('susu-cair','Susu Cair','Bahan Kering','tin','tin',true),
    ('sayap','Sayap','Frozen','pack','pack',false),
    ('udang','Udang','Frozen','pack','pack',false),
    ('sotong','Sotong','Frozen','pack','pack',false),
    ('ikan','Ikan','Frozen','pack','pack',false),
    ('ketam','Ketam','Frozen','ekor','kg',false),
    ('ais','Ais','Frozen','pack','pack',false),
    ('ayam-bulat','Ayam Bulat','Frozen','ekor','ekor',true),
    ('plastik-sampah','Plastik Sampah','Keperluan Dapur','pack','pack',false),
    ('baking-paper-pink','Baking Paper Pink','Keperluan Dapur','pack','pack',false),
    ('cooking-gas','Cooking Gas','Keperluan Dapur','kg','kg',false),
    ('snorkelling-mineral-water','Snorkelling Mineral Water','Snorkelling','botol','carton',false),
    ('snorkelling-mineral-water-500ml','Mineral Water 500 ml','Snorkelling','botol','carton',false),
    ('snorkelling-mineral-water-230ml','Mineral Water 230 ml','Snorkelling','botol','carton',false)
  ) as definitions(key,name,item_group,entry_unit,order_unit,staff_only)
  loop
    insert into public.ingredient_items(
      name,category,base_unit,default_pack_size,pack_label,cost_per_base_unit,
      active,kitchen_key,kitchen_label,kitchen_group,kitchen_unit,kitchen_factor,
      kitchen_scopes,kitchen_order
    )
    select definition.name,case when definition.item_group='Frozen' then 'Seafood' else 'Food' end,
      case when definition.entry_unit='kg' then 'g' else 'unit' end,
      case when definition.key='cooking-gas' then 1000 else 1 end,
      definition.entry_unit,null,true,definition.key,definition.name,definition.item_group,
      definition.entry_unit,case when definition.entry_unit='kg' then 1000 else 1 end,
      case when definition.item_group='Snorkelling' then array['water']
        when definition.staff_only then array['staff'] else array['guest','staff'] end,position
    where not exists(select 1 from public.ingredient_items i
      where i.kitchen_key=definition.key or lower(i.name)=lower(definition.name))
    on conflict do nothing;
    insert into public.catalogue_items(kind,name,category,unit,default_quantity,times_used)
      values('ingredient',definition.name,definition.item_group,definition.order_unit,null,0)
      on conflict do nothing;
    position := position + 1;
  end loop;
  select count(*)-before_ingredients into added_ingredients from public.ingredient_items;
  select count(*)-before_catalogue into added_catalogue from public.catalogue_items;
  if added_ingredients>0 or added_catalogue>0 then
    insert into public.audit_logs(actor_id,action,entity_type,after_json)
      values(null,'restore_standard_kitchen_catalogue','deployment',
        jsonb_build_object('ingredients_added',added_ingredients,'request_items_added',added_catalogue,
          'source','standard kitchen reference list','stock_quantities_imported',false,
          'prices_imported',false,'default_request_quantities_imported',false));
  end if;
end;
$$;
