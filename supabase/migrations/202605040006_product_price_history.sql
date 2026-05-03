create table if not exists public.product_price_history (
  id uuid primary key default gen_random_uuid(),
  product_id uuid not null references public.products(id),
  product_name text not null,
  old_price_per_unit numeric(12,2),
  new_price_per_unit numeric(12,2),
  old_cost_per_unit numeric(12,2),
  new_cost_per_unit numeric(12,2),
  changed_by uuid references public.profiles(id),
  changed_at timestamptz not null default now()
);

create index if not exists product_price_history_product_changed_idx
on public.product_price_history(product_id, changed_at desc);

create or replace function public.record_product_price_change()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if old.price_per_unit is distinct from new.price_per_unit
     or old.cost_per_unit is distinct from new.cost_per_unit then
    insert into public.product_price_history(
      product_id,
      product_name,
      old_price_per_unit,
      new_price_per_unit,
      old_cost_per_unit,
      new_cost_per_unit,
      changed_by
    )
    values (
      new.id,
      new.name,
      old.price_per_unit,
      new.price_per_unit,
      old.cost_per_unit,
      new.cost_per_unit,
      auth.uid()
    );
  end if;
  return new;
end;
$$;

drop trigger if exists products_record_price_change on public.products;
create trigger products_record_price_change
after update of price_per_unit, cost_per_unit on public.products
for each row execute function public.record_product_price_change();

alter table public.product_price_history enable row level security;

drop policy if exists "product price history admin read" on public.product_price_history;
create policy "product price history admin read"
on public.product_price_history
for select
to authenticated
using (public.current_user_role() = 'admin');

grant select on public.product_price_history to authenticated;
