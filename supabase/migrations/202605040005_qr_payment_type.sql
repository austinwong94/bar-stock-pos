alter table public.sales add column if not exists qr_payment_type text;

alter table public.sales drop constraint if exists sales_qr_payment_type_check;
alter table public.sales
  add constraint sales_qr_payment_type_check
  check (
    qr_payment_type is null
    or qr_payment_type in ('WeChat Pay', 'AliPay', 'TnGo', 'Grab', 'Others')
  );

create or replace function public.complete_sale_with_qr_type(
  p_items jsonb,
  p_payment_method text,
  p_qr_reference text default null,
  p_complimentary_reason text default null,
  p_idempotency_key text default null,
  p_qr_receipt_image_path text default null,
  p_discount_amount numeric default 0,
  p_order_taken_by text default null,
  p_qr_payment_type text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  result jsonb;
  sale_id uuid;
begin
  if p_payment_method = 'qr' and coalesce(p_qr_payment_type, '') not in ('WeChat Pay', 'AliPay', 'TnGo', 'Grab', 'Others') then
    raise exception 'Select a QR Payment type.';
  end if;

  if p_payment_method <> 'qr' then
    p_qr_payment_type := null;
  end if;

  result := public.complete_sale(
    p_items,
    p_payment_method,
    p_qr_reference,
    p_complimentary_reason,
    p_idempotency_key,
    p_qr_receipt_image_path,
    p_discount_amount,
    p_order_taken_by
  );

  sale_id := (result->>'sale_id')::uuid;

  update public.sales
  set qr_payment_type = p_qr_payment_type
  where id = sale_id;

  return result || jsonb_build_object('qr_payment_type', p_qr_payment_type);
end;
$$;

revoke execute on function public.complete_sale_with_qr_type(jsonb, text, text, text, text, text, numeric, text, text) from public, anon;
grant execute on function public.complete_sale_with_qr_type(jsonb, text, text, text, text, text, numeric, text, text) to authenticated;
