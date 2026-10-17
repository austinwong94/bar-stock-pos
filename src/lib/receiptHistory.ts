import { sameReceiptData, type ReceiptData, type ReceiptEvent, type ReviewLine } from './receiptReview';

export const receiptFieldLabels: Record<string, [string, string]> = {
  purpose: ['Purchase For', 'Pembelian Untuk'], supplier: ['Supplier', 'Pembekal'], address: ['Supplier Address', 'Alamat Pembekal'],
  tax_id: ['Tax / Registration ID', 'ID Cukai / Pendaftaran'], phone: ['Supplier Phone', 'Telefon Pembekal'],
  receipt_no: ['Receipt Number', 'Nombor Resit'], purchase_date: ['Receipt Date', 'Tarikh Resit'], currency: ['Currency', 'Mata Wang'],
  total_cost: ['Receipt Total', 'Jumlah Resit'], subtotal: ['Subtotal', 'Subtotal'], tax: ['Tax', 'Cukai'], discount: ['Discount', 'Diskaun'],
  notes: ['Accounting Note', 'Nota Akaun'], review_note: ['Review Note', 'Nota Semakan'], receipt: ['Receipt Photo', 'Foto Resit'], items: ['Items Photo', 'Foto Barang'],
  name: ['Item Name', 'Nama Item'], category: ['Category', 'Kategori'], quantity: ['Quantity', 'Kuantiti'], unit: ['Unit', 'Unit'], amount: ['Line Total', 'Jumlah Item'],
  line: ['Item', 'Item'], cost: ['Bought Cost', 'Kos Belian'], bought: ['Bought Quantity', 'Kuantiti Dibeli'],
};
export type ReceiptChange = { field: string; item?: string; before: string; after: string };
export function receiptChanges(event: ReceiptEvent): ReceiptChange[] {
  if (!['created', 'edited', 'buying_list_refreshed'].includes(event.action)) return [];
  const before = (event.before_json ?? {}) as Partial<ReceiptData>&{request_labels?:Record<string,string>}, after = (event.after_json ?? {}) as Partial<ReceiptData>&{request_labels?:Record<string,string>};
  const changes: ReceiptChange[] = [];
  for(const id of new Set([...Object.keys(before.request_entries??{}),...Object.keys(after.request_entries??{})])){
    const a=before.request_entries?.[id],b=after.request_entries?.[id];
    for(const field of ['quantity','cost'] as const)if((a?.[field]??'')!==(b?.[field]??''))changes.push({field:field==='quantity'?'bought':'cost',item:before.request_labels?.[id]??after.request_labels?.[id]??id,before:a?.[field]??'',after:b?.[field]??''});
  }
  for (const field of ['purpose','supplier','address','tax_id','phone','receipt_no','purchase_date','currency','total_cost','subtotal','tax','discount','notes','review_note'] as const) {
    if ((before[field] ?? '') !== (after[field] ?? '')) changes.push({ field, before: before[field] ?? '', after: after[field] ?? '' });
  }
  for (const field of ['receipt', 'items'] as const) {
    if (!sameReceiptData(before[field] ?? null, after[field] ?? null)) changes.push({ field, before: before[field] ? 'attached' : '', after: after[field] ? before[field] ? 'replaced' : 'attached' : '' });
  }
  const old = new Map((before.lines ?? []).map(l => [l.id, l])), next = new Map((after.lines ?? []).map(l => [l.id, l]));
  const summary = (l: ReviewLine) => `${l.name || '?'} | ${l.quantity || '?'} ${l.unit || '?'} | RM ${l.amount || '?'} | ${l.category}`;
  for (const id of new Set([...old.keys(), ...next.keys()])) {
    const a = old.get(id), b = next.get(id);
    if (!a || !b) { changes.push({ field: 'line', before: a ? summary(a) : '', after: b ? summary(b) : '' }); continue; }
    for (const field of ['name', 'category', 'quantity', 'unit', 'amount'] as const) if (a[field] !== b[field]) changes.push({ field, item: a.name || b.name, before: a[field], after: b[field] });
  }
  return changes;
}
