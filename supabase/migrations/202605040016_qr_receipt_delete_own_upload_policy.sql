drop policy if exists "payment receipt delete own upload" on storage.objects;
create policy "payment receipt delete own upload" on storage.objects
for delete to authenticated
using (bucket_id = 'payment-receipts' and owner = auth.uid());
