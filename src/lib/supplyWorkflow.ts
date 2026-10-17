import { addDays, endOfMonth, format, startOfMonth, startOfWeek } from 'date-fns';

export const purchasePurposes = ['guest_meals', 'staff_meals', 'bar'] as const;
export type PurchasePurpose = typeof purchasePurposes[number];
export const expenseCategories = ['Vegetables', 'Seafood', 'Meat & Eggs', 'Rice & Dry Goods', 'Seasoning & Oil', 'Cooking Gas', 'Bar Drinks', 'Other'] as const;
export type ReceiptLine = { name: string; category: string; quantity: number; unit: string; amount: number; ingredient_id?: string | null };
export type ExpenseReceipt = {
  id: string; purchase_date: string; purpose: PurchasePurpose | 'unclassified'; supplier: string; receipt_no: string;
  total_cost: number; receipt_path: string; items_path: string; receipt_hash: string; items_hash: string;
  lines: ReceiptLine[]; notes: string; created_at: string; created_by: string; created_by_name: string;
  status: 'confirmed' | 'void'; void_reason?: string; legacy?: boolean; coding_version?: number;
  payment_checked?: boolean; paid_amount?: number;
  accounting_details?: {review_id:string;address:string;tax_id:string;phone:string;currency:string;subtotal:string;tax:string;discount:string;review_note:string;extraction:import('./receiptReview').ReceiptExtraction|null;scan_status:string;model:string|null};
};
export type MealTemplate = { id: string; name: string; ingredient_ids: string[]; updated_at: string; created_by?: string };
export type DailyUsageLine = {
  display_unit?: string; display_factor?: number | null; expected_item_version?: string;
  ingredient_id: string; name: string; unit: string; guest_quantity: number; staff_quantity: number;
  unit_cost?: number | null;
};
export type DailyUsage = {
  id: string; business_date: string; guest_meals: number; staff_meals: number; template_ids: string[];
  lines: DailyUsageLine[]; notes: string; updated_at: string; created_by: string; created_by_name: string;
  revision: number;
};
export type SupplyData = { receipts: ExpenseReceipt[]; usage: DailyUsage[] };
export const purposeLabels: Record<string, [string, string]> = {
  guest_meals: ['Guest Meals', 'Makanan Tetamu'], staff_meals: ['Staff Meals', 'Makanan Staf'],
  bar: ['Bar', 'Bar'], unclassified: ['Needs Category', 'Perlu Kategori'],
};
export const categoryLabels: Record<string, string> = {
  Vegetables: 'Sayur', Seafood: 'Makanan Laut', 'Meat & Eggs': 'Daging & Telur', 'Rice & Dry Goods': 'Beras & Barang Kering',
  'Seasoning & Oil': 'Perasa & Minyak', 'Cooking Gas': 'Gas Memasak', 'Bar Drinks': 'Minuman Bar', Other: 'Lain-lain',
};
export function supplyPeriod(date: string, mode: 'day' | 'week' | 'month') {
  const day = new Date(date + 'T12:00:00');
  const start = mode === 'day' ? day : mode === 'week' ? startOfWeek(day, { weekStartsOn: 1 }) : startOfMonth(day);
  const end = mode === 'day' ? day : mode === 'week' ? addDays(start, 6) : endOfMonth(day);
  const previousEnd = addDays(start, -1);
  const previousStart = mode === 'day' ? previousEnd : mode === 'week' ? addDays(start, -7) : startOfMonth(previousEnd);
  return { start: format(start, 'yyyy-MM-dd'), end: format(end, 'yyyy-MM-dd'), previousStart: format(previousStart, 'yyyy-MM-dd'), previousEnd: format(previousEnd, 'yyyy-MM-dd') };
}
export function receiptBreakdown(receipt: Pick<ExpenseReceipt, 'lines' | 'total_cost' | 'accounting_details'>) {
  const allocated = receipt.lines.reduce((n, l) => n + Math.round(l.amount * 100), 0);
  const tax = Math.round(Number(receipt.accounting_details?.tax || 0) * 100), discount = Math.round(Number(receipt.accounting_details?.discount || 0) * 100);
  return { allocated: allocated / 100, difference: (Math.round(receipt.total_cost * 100) - allocated - tax + discount) / 100 };
}
export function expenseSummary(data: SupplyData, start: string, end: string, purpose = 'all', supplier = 'all', category = 'all', query = '') {
  const periodReceipts = data.receipts.filter(r => r.status !== 'void' && r.purchase_date >= start && r.purchase_date <= end && (purpose === 'all' || r.purpose === purpose) && (supplier === 'all' || r.supplier.toLocaleLowerCase() === supplier.toLocaleLowerCase()));
  const matches = (l: ReceiptLine) => (category === 'all' || l.category === category) && l.name.toLocaleLowerCase().includes(query.trim().toLocaleLowerCase());
  const detailed = category !== 'all' || query.trim() !== '';
  const receipts = detailed ? periodReceipts.filter(r=>r.lines.some(matches)) : periodReceipts;
  const total = receipts.reduce((n, r) => n + Math.round((detailed ? r.lines.filter(matches).reduce((a, l) => a + l.amount, 0) : r.total_cost) * 100), 0) / 100;
  const bySupplier: Record<string, { name: string; amount: number; receipts: number }> = {};
  const byItem: Record<string, { name: string; category: string; amount: number; quantity: number; unit: string }> = {};
  for (const receipt of receipts) {
    const key = receipt.supplier.toLocaleLowerCase();
    bySupplier[key] ??= { name: receipt.supplier, amount: 0, receipts: 0 };
    bySupplier[key].amount += Math.round((detailed ? receipt.lines.filter(matches).reduce((a,l) => a+l.amount,0) : receipt.total_cost)*100)/100;
    bySupplier[key].receipts++;
    for (const line of receipt.lines.filter(matches)) {
      const id = `${line.name.trim().toLocaleLowerCase()}|${line.category}|${line.unit}`;
      byItem[id] ??= { name: line.name, category: line.category, amount: 0, quantity: 0, unit: line.unit };
      byItem[id].amount += line.amount; byItem[id].quantity += line.quantity;
    }
  }
  const usage = data.usage.filter(r => r.business_date >= start && r.business_date <= end);
  const meals = { guest_meals: 0, staff_meals: 0, guest_cost: 0, staff_cost: 0, unpriced: 0, guest_unpriced: 0, staff_unpriced: 0 };
  for (const day of usage) {
    meals.guest_meals += day.guest_meals; meals.staff_meals += day.staff_meals;
    for (const line of day.lines) {
      if (line.unit_cost == null) { if (line.guest_quantity + line.staff_quantity > 0) meals.unpriced++; if(line.guest_quantity>0)meals.guest_unpriced++;if(line.staff_quantity>0)meals.staff_unpriced++; }
      else { meals.guest_cost += line.guest_quantity * line.unit_cost; meals.staff_cost += line.staff_quantity * line.unit_cost; }
    }
  }
  return { receipts, total, suppliers: Object.values(bySupplier).sort((a,b)=>b.amount-a.amount), items: Object.values(byItem).sort((a,b)=>b.amount-a.amount), meals,
    unitemised: periodReceipts.filter(r => !r.lines.length).length, mismatched: periodReceipts.filter(r=>r.lines.length && receiptBreakdown(r).difference !== 0).length, usage };
}

// Initial rollout is deliberately limited. Server permission checks mirror this list.
export function rolloutPermission(code: string) {
  return /^(bar\.|kitchen\.|purchasing\.|staff\.)/.test(code) || ['platform.users.manage','platform.roles.manage','platform.audit.view','platform.settings.manage'].includes(code);
}
