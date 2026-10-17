-- 202605040027 ingredient stock corrections and counts
-- Controlled RPC for admin/manager ingredient stock count, waste/missing, and correction entries.
-- Each change locks the ingredient balance, updates stock, writes ingredient_movements, and writes audit_logs.
create or replace function public.adjust_ingredient_stock(
  p_ingredient_id uuid,
  p_movement_type text,
  p_quantity numeric,
  p_reason text,
  p_notes text default null,
  p_entered_by text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  ingredient_record public.ingredient_items%rowtype;
  before_qty numeric(14,2);
  after_qty numeric(14,2);
  quantity_change numeric(14,2);
  allow_negative boolean := public.setting_bool('allow_negative_stock', false);
begin
  perform public.require_role(array['manager', 'admin']);

  if p_movement_type not in ('count', 'waste', 'adjustment') then
    raise exception 'Ingredient correction type must be count, waste, or adjustment.';
  end if;
  if p_quantity is null then
    raise exception 'Ingredient correction quantity is invalid.';
  end if;
  if nullif(trim(coalesce(p_reason, '')), '') is null then
    raise exception 'Reason is required for ingredient stock correction.';
  end if;

  select * into ingredient_record
  from public.ingredient_items
  where id = p_ingredient_id and active = true
  for update;

  if ingredient_record.id is null then
    raise exception 'Ingredient is inactive or missing.';
  end if;

  insert into public.ingredient_balances(ingredient_id, quantity_on_hand)
  values (p_ingredient_id, 0)
  on conflict (ingredient_id) do nothing;

  select quantity_on_hand into before_qty
  from public.ingredient_balances
  where ingredient_id = p_ingredient_id
  for update;

  if p_movement_type = 'count' then
    if p_quantity < 0 then raise exception 'Actual count must be 0 or more.'; end if;
    after_qty := p_quantity;
    quantity_change := after_qty - before_qty;
  elsif p_movement_type = 'waste' then
    if p_quantity <= 0 then raise exception 'Waste or missing quantity must be more than 0.'; end if;
    quantity_change := -abs(p_quantity);
    after_qty := before_qty + quantity_change;
  else
    if p_quantity = 0 then raise exception 'Correction quantity cannot be 0.'; end if;
    quantity_change := p_quantity;
    after_qty := before_qty + quantity_change;
  end if;

  if not allow_negative and after_qty < 0 then
    raise exception 'Ingredient stock cannot go below 0. Current balance is % %.', before_qty, ingredient_record.base_unit;
  end if;

  update public.ingredient_balances
  set quantity_on_hand = after_qty, updated_at = now()
  where ingredient_id = p_ingredient_id;

  insert into public.ingredient_movements(
    ingredient_id, movement_type, quantity_change, quantity_before, quantity_after,
    unit_input, input_quantity, pack_size_at_time, reference_type, reference_id,
    reason, notes, entered_by, created_by
  ) values (
    p_ingredient_id, p_movement_type, quantity_change, before_qty, after_qty,
    p_movement_type, p_quantity, null, 'ingredient_' || p_movement_type, null,
    trim(p_reason), p_notes, p_entered_by, auth.uid()
  );

  insert into public.audit_logs(actor_id, action, entity_type, entity_id, before_json, after_json)
  values (
    auth.uid(),
    'adjust_ingredient_stock',
    'ingredient',
    p_ingredient_id,
    jsonb_build_object('quantity_on_hand', before_qty),
    jsonb_build_object(
      'movement_type', p_movement_type,
      'quantity_input', p_quantity,
      'quantity_change', quantity_change,
      'quantity_on_hand', after_qty,
      'reason', trim(p_reason),
      'entered_by', p_entered_by
    )
  );

  return jsonb_build_object(
    'ingredient_id', p_ingredient_id,
    'quantity_change', quantity_change,
    'quantity_on_hand', after_qty
  );
end;
$$;

revoke execute on function public.adjust_ingredient_stock(uuid, text, numeric, text, text, text) from public, anon;
grant execute on function public.adjust_ingredient_stock(uuid, text, numeric, text, text, text) to authenticated;
