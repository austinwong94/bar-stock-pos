insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'product-images',
  'product-images',
  true,
  4194304,
  array['image/jpeg', 'image/png', 'image/webp', 'image/gif']
)
on conflict (id) do update
set public = true,
    file_size_limit = 4194304,
    allowed_mime_types = array['image/jpeg', 'image/png', 'image/webp', 'image/gif'];

drop policy if exists "product image read public" on storage.objects;
create policy "product image read public" on storage.objects
for select to anon, authenticated
using (bucket_id = 'product-images');

drop policy if exists "product image admin upload" on storage.objects;
create policy "product image admin upload" on storage.objects
for insert to authenticated
with check (bucket_id = 'product-images' and public.current_user_role() = 'admin');

drop policy if exists "product image admin update" on storage.objects;
create policy "product image admin update" on storage.objects
for update to authenticated
using (bucket_id = 'product-images' and public.current_user_role() = 'admin')
with check (bucket_id = 'product-images' and public.current_user_role() = 'admin');

drop policy if exists "product image admin delete" on storage.objects;
create policy "product image admin delete" on storage.objects
for delete to authenticated
using (bucket_id = 'product-images' and public.current_user_role() = 'admin');
