export type ReceiptIdentity = { supplier: string; receipt_no: string; receipt_hash: string };
export type ReceiptMatch = ReceiptIdentity & {
  id: string; source: 'receipt' | 'request' | 'review'; status: 'confirmed' | 'pending';
  purchase_date: string; total_cost: number | null; created_by_name: string; created_at: string;
  receipt_path: string | null; items_path: string | null; match: 'photo' | 'number';
};
const normalized = (value: string | null | undefined) => (value ?? '').trim().toLowerCase();
export function receiptMatchReason(a: ReceiptIdentity, b: ReceiptIdentity): ReceiptMatch['match'] | null {
  if (a.receipt_hash && a.receipt_hash === b.receipt_hash) return 'photo';
  return normalized(a.supplier) && normalized(a.receipt_no)
    && normalized(a.supplier) === normalized(b.supplier) && normalized(a.receipt_no) === normalized(b.receipt_no) ? 'number' : null;
}

// Both purchasing entry points use this same projection in the device-only review.
export function receiptMatches(db: Record<string, any[]>, identity: ReceiptIdentity, excludeReviewId?: string): ReceiptMatch[] {
  const recorded = (db.expense_receipts ?? []).filter(r => r.status === 'confirmed').map(r => ({ ...r, source: 'receipt' as const }));
  const requested = (db.audit_logs ?? []).filter(a => a.action === 'record_purchase_batch' && a.after_json?.evidence).map(a => ({
    ...a.after_json.evidence, id: a.id, source: 'request' as const, status: 'confirmed', supplier: a.after_json.supplier ?? '',
    receipt_no: a.after_json.reference ?? '', created_by_name: a.after_json.confirmed_by_name ?? '', created_at: a.after_json.confirmed_at ?? a.created_at,
  }));
  const pending = (db.receipt_reviews ?? []).filter(r => r.status === 'pending' && r.id !== excludeReviewId).map(r => ({
    ...r.data, id: r.id, source: 'review' as const, status: 'pending', created_by_name: r.created_by_name, created_at: r.created_at,
    receipt_hash: r.data.receipt?.hash ?? '', receipt_path: r.data.receipt?.path ?? null, items_path: r.data.items?.path ?? null,
    total_cost: /^\d{1,8}(\.\d{1,2})?$/.test(r.data.total_cost) ? Number(r.data.total_cost) : null,
  }));
  return [...recorded, ...requested, ...pending].flatMap(r => {
    const match = receiptMatchReason(identity, r);
    return match ? [{ id: r.id, source: r.source, status: r.status, supplier: r.supplier, receipt_no: r.receipt_no, receipt_hash: r.receipt_hash,
      purchase_date: r.purchase_date, total_cost: r.total_cost, created_by_name: r.created_by_name, created_at: r.created_at,
      receipt_path: r.receipt_path, items_path: r.items_path, match } as ReceiptMatch] : [];
  }).sort((a, b) => (a.status === 'confirmed' ? 0 : 1) - (b.status === 'confirmed' ? 0 : 1) || b.created_at.localeCompare(a.created_at)).slice(0, 20);
}
