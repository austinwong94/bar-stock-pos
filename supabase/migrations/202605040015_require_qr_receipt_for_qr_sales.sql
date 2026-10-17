do $$
declare
  function_sql text;
begin
  select pg_get_functiondef('public.complete_sale(jsonb, text, text, text, text, text, numeric, text)'::regprocedure)
  into function_sql;

  if position('QR receipt photo is required.' in function_sql) = 0 then
    function_sql := replace(
      function_sql,
      $old$  if p_payment_method = 'qr' and require_qr_ref and nullif(trim(coalesce(p_qr_reference, '')), '') is null then
    raise exception 'QR reference is required.';
  end if;
$old$,
      $new$  if p_payment_method = 'qr' and require_qr_ref and nullif(trim(coalesce(p_qr_reference, '')), '') is null then
    raise exception 'QR reference is required.';
  end if;
  if p_payment_method = 'qr' and nullif(trim(coalesce(p_qr_receipt_image_path, '')), '') is null then
    raise exception 'QR receipt photo is required.';
  end if;
$new$
    );
    execute function_sql;
  end if;
end;
$$;
