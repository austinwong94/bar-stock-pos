do $$
declare
  function_sql text;
begin
  select pg_get_functiondef('public.complete_sale(jsonb, text, text, text, text, text, numeric, text)'::regprocedure)
  into function_sql;

  function_sql := replace(function_sql, '  item_name text;', '  item_label text;');
  function_sql := replace(
    function_sql,
    '    item_name := coalesce(nullif(raw_item->>''name'', ''''), ''Custom Order'');',
    '    item_label := coalesce(nullif(raw_item->>''name'', ''''), ''Custom Order'');'
  );
  function_sql := replace(
    function_sql,
    '        values (item_name, item_quantity, item_custom_price, item_custom_price * item_quantity);',
    '        values (item_label, item_quantity, item_custom_price, item_custom_price * item_quantity);'
  );
  function_sql := replace(
    function_sql,
    '    select product_id, item_name, sum(quantity)::int quantity, round(sum(line_total) / sum(quantity), 2) unit_price, sum(line_total)::numeric(12,2) line_total
    from tmp_stock_sale_items
    group by product_id, item_name',
    '    select t.product_id, t.item_name, sum(t.quantity)::int quantity, round(sum(t.line_total) / sum(t.quantity), 2) unit_price, sum(t.line_total)::numeric(12,2) line_total
    from tmp_stock_sale_items t
    group by t.product_id, t.item_name'
  );

  execute function_sql;
end;
$$;
