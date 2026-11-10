create table if not exists public.product_save_requests (
  request_id uuid primary key,
  actor_id uuid not null references public.profiles(id),
  product_id uuid not null references public.products(id),
  intent jsonb not null,
  result jsonb not null,
  created_at timestamptz not null default now()
);
alter table public.product_save_requests enable row level security;
revoke all on public.product_save_requests from public, anon, authenticated;
grant all on public.product_save_requests to service_role;

do $$ begin
  if to_regprocedure('public.save_product_checked_before_recovery(uuid,jsonb,timestamp with time zone)') is null then
    alter function public.save_product_checked(uuid,jsonb,timestamptz) rename to save_product_checked_before_recovery;
  end if;
end $$;
revoke all on function public.save_product_checked_before_recovery(uuid,jsonb,timestamptz) from public, anon, authenticated;

create or replace function public.save_product_checked(
  p_product_id uuid,
  p_payload jsonb,
  p_source_updated_at timestamptz default null,
  p_request_id uuid default null,
  p_expected_actor_id uuid default null
)
returns public.products language plpgsql security definer
set search_path = pg_catalog, public, pg_temp
as $$
declare
  prior public.product_save_requests%rowtype;
  intent jsonb;
  saved public.products%rowtype;
begin
  if auth.uid() is null or not public.has_permission('bar.products.manage') then
    raise exception using errcode='42501', message='Product management access required.';
  end if;
  -- Keep already-open older clients compatible. Updated clients always supply a request ID.
  if p_request_id is null then
    return public.save_product_checked_before_recovery(p_product_id,p_payload,p_source_updated_at);
  end if;
  if p_expected_actor_id is distinct from auth.uid() then
    raise exception using errcode='42501', message='The signed-in account changed. Reopen Bar Admin in the original account.';
  end if;
  perform pg_advisory_xact_lock(hashtextextended('product-save:'||p_request_id::text,0));
  intent := jsonb_build_array(p_product_id,p_payload,p_source_updated_at);
  select * into prior from public.product_save_requests where request_id=p_request_id;
  if found then
    if prior.actor_id is distinct from auth.uid() or prior.intent is distinct from intent then
      raise exception using errcode='LP001', message='This product save belongs to different details or another account. Check the original save.';
    end if;
    -- Return the original confirmation, even if this product has since been edited.
    return jsonb_populate_record(null::public.products,prior.result);
  end if;
  saved := public.save_product_checked_before_recovery(p_product_id,p_payload,p_source_updated_at);
  insert into public.product_save_requests(request_id,actor_id,product_id,intent,result)
  values(p_request_id,auth.uid(),saved.id,intent,to_jsonb(saved));
  return saved;
end;
$$;
revoke all on function public.save_product_checked(uuid,jsonb,timestamptz,uuid,uuid) from public, anon;
grant execute on function public.save_product_checked(uuid,jsonb,timestamptz,uuid,uuid) to authenticated;
notify pgrst, 'reload schema';
