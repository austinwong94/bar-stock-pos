-- Open the original receipt after an interrupted payment, without fetching years of history.
create function public.read_purchase_payment_receipt(p_receipt_id uuid) returns jsonb
language plpgsql stable security definer set search_path=public as $$
declare purchase_day date; result jsonb;
begin
  perform public.require_permission('purchasing.view');
  perform public.require_permission('purchasing.cost.view');
  select purchase_date into purchase_day from public.expense_receipts where id=p_receipt_id;
  if not found then select purchase_date into purchase_day from public.purchase_evidence where record_id=p_receipt_id;end if;
  if purchase_day is null then raise exception 'Receipt not found.';end if;
  select r into result from jsonb_array_elements(public.read_expense_receipts(purchase_day,purchase_day)) r where r->>'id'=p_receipt_id::text;
  if result is null then raise exception 'Receipt not found.';end if;
  return result;
end $$;
revoke all on function public.read_purchase_payment_receipt(uuid) from public,anon;
grant execute on function public.read_purchase_payment_receipt(uuid) to authenticated;
