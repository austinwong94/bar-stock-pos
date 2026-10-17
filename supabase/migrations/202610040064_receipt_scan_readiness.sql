-- Read-only setup check. Never creates a scan claim or exposes credentials.
create function public.read_receipt_scan_readiness() returns jsonb
language plpgsql stable security definer set search_path=public as $$
begin
  perform public.require_permission('platform.settings.manage');
  return jsonb_build_object(
    'database_ready', to_regprocedure('public.begin_receipt_review_scan(uuid)') is not null
      and to_regprocedure('public.finish_receipt_review_scan(uuid,uuid,jsonb,jsonb,text)') is not null
      and to_regprocedure('public.confirm_receipt_review(uuid,integer,boolean)') is not null,
    'private_storage_ready', exists(select 1 from storage.buckets where id='purchase-evidence' and not public)
  );
end;
$$;
revoke all on function public.read_receipt_scan_readiness() from public, anon;
grant execute on function public.read_receipt_scan_readiness() to authenticated;
