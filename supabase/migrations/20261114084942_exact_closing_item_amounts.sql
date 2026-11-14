-- Correct new closing breakdowns before their existing audit/cache writes; never rewrite saved reports.
begin;
select pg_advisory_xact_lock(77312,1);
create schema if not exists private;
create or replace function private.bar_exact_item_sections(p_date date) returns jsonb
language plpgsql stable security invoker set search_path=pg_catalog,public,pg_temp as $$
declare result jsonb;begin
 if exists(
   select 1 from public.sales s left join lateral (
     select count(*) n,sum(si.line_total) gross,
       bool_or(si.quantity<=0 or si.line_total<0 or si.line_total::text in ('NaN','Infinity','-Infinity')) invalid
     from public.sale_items si where si.sale_id=s.id
   ) lines on true
   where s.business_date=p_date and s.status='completed' and
     (lines.n=0 or lines.invalid or s.total_amount is null or s.total_amount<0
      or s.total_amount::text in ('NaN','Infinity','-Infinity')
      or coalesce(s.discount_amount,0)<0 or coalesce(s.discount_amount,0)::text in ('NaN','Infinity','-Infinity')
      or s.total_amount+coalesce(s.discount_amount,0) is distinct from lines.gross)
 ) then raise exception 'Sale totals and item amounts do not match. Reload the source records before closing.' using errcode='22023';end if;
 with source as (
   select si.id,si.sale_id,coalesce(p.name,si.custom_item_name,'Custom Order') product_name,
     coalesce(c.name,'Others') category_name,si.quantity,s.payment_method,
     si.line_total*100 gross,coalesce(s.discount_amount,0)*100 discount,
     sum(si.line_total*100) over(partition by s.id) subtotal
   from public.sale_items si join public.sales s on s.id=si.sale_id
   left join public.products p on p.id=si.product_id left join public.categories c on c.id=p.category_id
   where s.business_date=p_date and s.status='completed'
 ), quotas as (
   select *,case when subtotal=0 then 0 else floor(discount*gross/subtotal) end base,
     case when subtotal=0 then 0 else mod(discount*gross,subtotal) end remainder from source
 ), ranked as (
   select *,row_number() over(partition by sale_id order by remainder desc,id) rank,
     discount-sum(base) over(partition by sale_id) remaining from quotas
 ), allocated as (
   select *,base+case when rank<=remaining then 1 else 0 end allocated_discount from ranked
 ), grouped as (
   select labels.kind,labels.name,sum(quantity) quantity,
     coalesce(sum((gross-allocated_discount)/100) filter(where payment_method='cash'),0)::numeric(12,2) cash,
     coalesce(sum((gross-allocated_discount)/100) filter(where payment_method='qr'),0)::numeric(12,2) qr,
     coalesce(sum((gross-allocated_discount)/100) filter(where payment_method='complimentary'),0)::numeric(12,2) foc_cost,
     sum(allocated_discount/100)::numeric(12,2) discount,
     coalesce(sum((gross-allocated_discount)/100) filter(where payment_method in ('cash','qr')),0)::numeric(12,2) paid_sales
   from allocated cross join lateral (values('product',product_name),('category',category_name)) labels(kind,name)
   group by labels.kind,labels.name
 ) select jsonb_build_object(
   'sales_by_product',coalesce(jsonb_agg(to_jsonb(g)-'kind' order by name) filter(where kind='product'),'[]'::jsonb),
   'sales_by_category',coalesce(jsonb_agg(to_jsonb(g)-'kind' order by name) filter(where kind='category'),'[]'::jsonb)
 ) into result from grouped g;
 return result;
end $$;
revoke all on function private.bar_exact_item_sections(date) from public,anon,authenticated;
do $$declare definition text;anchor text:='  insert into public.daily_reports(';begin
 definition:=pg_get_functiondef('public.close_daily_report_internal(date,numeric,text)'::regprocedure);
 if position('-- Exact cent sections for this new closing.' in definition)=0 then
   if position(anchor in definition)=0 or position(anchor in substring(definition from position(anchor in definition)+length(anchor)))>0 then
     raise exception 'Closing authority changed. Review this upgrade before applying.';
   end if;
   execute replace(definition,anchor,E'  -- Exact cent sections for this new closing.\n  report := report || private.bar_exact_item_sections(p_business_date);\n\n'||anchor);
 end if;
end $$;
alter function public.close_daily_report_internal(date,numeric,text) set search_path=pg_catalog,public,pg_temp;
revoke all on function public.close_daily_report_internal(date,numeric,text) from public,anon,authenticated;
notify pgrst,'reload schema';
commit;
