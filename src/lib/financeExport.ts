import { categoryLabels, expenseSummary, purposeLabels, receiptBreakdown, type SupplyData, type ExpenseReceipt, type DailyUsage } from './supplyWorkflow';
import { paymentState, paymentLabels } from './purchasePayments';
import { supplyPeriod } from './supplyWorkflow';
import { addDays, format, parseISO } from 'date-fns';

export type WaterUsage = { business_date: string; bottles: number; closed: boolean };
type Period = ReturnType<typeof supplyPeriod>;
type Translate = (english: string, malay: string) => string;
const number = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value) && value >= 0;
const date = (value: unknown): value is string => typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value) && !Number.isNaN(Date.parse(value)) && new Date(value).toISOString().slice(0, 10) === value;

// A successful HTTP response is not evidence that its financial payload is complete.
export function financeSource(receipts: unknown, usage: unknown, water: unknown): { data: SupplyData; water: WaterUsage[] } {
  const fail = () => { throw new Error('Finance data is incomplete or invalid. Retry before exporting.'); };
  if (!Array.isArray(receipts) || !Array.isArray(usage) || !Array.isArray(water)) return fail();
  const unique = (rows: Record<string, unknown>[], key: string) => {
    const seen = new Set();
    for (const row of rows) { if (!row || !row[key] || seen.has(row[key])) fail(); seen.add(row[key]); }
  };
  unique(receipts, 'id'); unique(usage, 'business_date'); unique(water, 'business_date');
  for (const r of receipts) {
    if (!date(r.purchase_date) || !number(r.total_cost) || !['confirmed', 'void'].includes(r.status) || !['guest_meals', 'staff_meals', 'bar', 'unclassified'].includes(r.purpose) || typeof r.supplier !== 'string' || !Array.isArray(r.lines) || typeof r.payment_checked !== 'boolean' || !number(r.paid_amount) || r.paid_amount > r.total_cost || (!r.payment_checked && r.paid_amount !== 0)) fail();
    for (const l of r.lines) if (!l || typeof l.name !== 'string' || typeof l.category !== 'string' || typeof l.unit !== 'string' || !number(l.quantity) || l.quantity === 0 || !number(l.amount)) fail();
    for (const value of [r.accounting_details?.tax, r.accounting_details?.discount]) if (value != null && value !== '' && (!Number.isFinite(Number(value)) || Number(value) < 0)) fail();
  }
  for (const d of usage) {
    if (!date(d.business_date) || !number(d.guest_meals) || !Number.isInteger(d.guest_meals) || !number(d.staff_meals) || !Number.isInteger(d.staff_meals) || !Array.isArray(d.lines)) fail();
    for (const l of d.lines) if (!l || typeof l.ingredient_id !== 'string' || !l.ingredient_id || typeof l.name !== 'string' || typeof l.unit !== 'string' || !number(l.guest_quantity) || !number(l.staff_quantity) || (l.unit_cost != null && !number(l.unit_cost)) || (l.display_factor != null && (!number(l.display_factor) || l.display_factor === 0)) || ((l.display_factor != null) !== (typeof l.display_unit === 'string' && l.display_unit.length > 0))) fail();
  }
  for (const w of water) if (!date(w.business_date) || !number(w.bottles) || !Number.isInteger(w.bottles) || typeof w.closed !== 'boolean' || (w.closed && w.bottles !== 0)) fail();
  return { data: { receipts: receipts as ExpenseReceipt[], usage: usage as DailyUsage[] }, water: water as WaterUsage[] };
}

export function csvText(rows: (string | number)[][]) {
  return '\ufeff' + rows.map(row => row.map(value => '"' + String(value).replace(/^(\s*)([=+@-])/, "'$1$2").replace(/"/g, '""') + '"').join(',')).join('\r\n');
}

export function financeExport(data: SupplyData, water: WaterUsage[], period: Period, mode: 'day' | 'week' | 'month', generatedAt: string, today: string, t: Translate) {
  financeSource(data.receipts, data.usage, water);
  const now = expenseSummary(data, period.start, period.end), before = expenseSummary(data, period.previousStart, period.previousEnd);
  const money = (n: number) => n.toFixed(2);
  const available = t('Not Available', 'Belum Tersedia');
  const rows: (string | number)[][] = [
    [t('Lovely Paradise - Purchasing & Usage', 'Lovely Paradise - Belian & Penggunaan')],
    [t('Period', 'Tempoh'), period.start, period.end],
    [t('Previous Period', 'Tempoh Sebelumnya'), period.previousStart, period.previousEnd],
    [t('Exported At (UTC)', 'Dieksport Pada (UTC)'), generatedAt],
    [t('Scope', 'Skop'), t('All purchase categories and suppliers; kitchen meals and snorkelling water. Excludes bar sales, inventory counts and pending receipt reviews.', 'Semua kategori belian dan pembekal; hidangan dapur dan air snorkelling. Tidak termasuk jualan bar, kiraan stok dan semakan resit tertangguh.')],
    [t('Period Status', 'Status Tempoh'), period.end >= today ? t('In Progress / Future', 'Sedang Berjalan / Akan Datang') : t('Ended; missing records may remain', 'Tamat; rekod mungkin belum lengkap')],
    [t('Cost Basis', 'Asas Kos'), t('Purchase totals are recorded expenditure. Meal costs are saved ingredient-rate estimates, not audited cost of goods sold.', 'Jumlah belian ialah perbelanjaan direkod. Kos hidangan ialah anggaran kadar bahan tersimpan, bukan kos jualan diaudit.')],
    [], [t('Summary', 'Ringkasan')], [t('Measure', 'Ukuran'), t('This Period', 'Tempoh Ini'), t('Previous Period', 'Tempoh Sebelumnya'), t('Basis', 'Asas')],
  ];
  for (const purpose of ['all', 'guest_meals', 'staff_meals', 'bar', 'unclassified']) {
    rows.push([purpose === 'all' ? t('Purchases (RM)', 'Belian (RM)') : t(...purposeLabels[purpose]) + ' (RM)', money(expenseSummary(data, period.start, period.end, purpose).total), money(expenseSummary(data, period.previousStart, period.previousEnd, purpose).total), t('Confirmed receipts; voids excluded', 'Resit disahkan; batal tidak termasuk')]);
  }
  for (const key of ['guest', 'staff'] as const) {
    const count = `${key}_meals` as const, cost = `${key}_cost` as const, missing = `${key}_unpriced` as const;
    const perMeal = (summary: typeof now) => !summary.usage.length || summary.meals[missing] || !summary.meals[count] ? available : money(summary.meals[cost] / summary.meals[count]);
    rows.push([key === 'guest' ? t('Guest Meals', 'Hidangan Tetamu') : t('Staff Meals', 'Hidangan Staf'), now.usage.length ? now.meals[count] : available, before.usage.length ? before.meals[count] : available, t('Recorded days only', 'Hari direkod sahaja')]);
    rows.push([key === 'guest' ? t('Estimated RM / Guest Meal', 'Anggaran RM / Hidangan Tetamu') : t('Estimated RM / Staff Meal', 'Anggaran RM / Hidangan Staf'), perMeal(now), perMeal(before), t('Missing rates or meal counts: Not Available', 'Kadar atau bilangan hidangan tiada: Belum Tersedia')]);
  }
  const outstanding = (summary: typeof now) => money(summary.receipts.filter(r => r.payment_checked).reduce((n, r) => n + Math.round((r.total_cost - (r.paid_amount ?? 0)) * 100), 0) / 100);
  rows.push([t('Known Unpaid Balance (RM)', 'Baki Belum Bayar Diketahui (RM)'), outstanding(now), outstanding(before), t('Unchecked payments excluded; purchase-date basis', 'Bayaran belum disemak tidak termasuk; berdasarkan tarikh belian')]);
  rows.push([t('Payments to Check', 'Bayaran Perlu Disemak'), now.receipts.filter(r => !r.payment_checked).length, before.receipts.filter(r => !r.payment_checked).length]);
  rows.push([t('Usage Days Recorded', 'Hari Penggunaan Direkod'), now.usage.length, before.usage.length, t('Missing days are not zero usage', 'Hari tanpa rekod bukan penggunaan sifar')]);
  rows.push([], [t('Daily Coverage - Missing Is Not Zero', 'Liputan Harian - Tiada Rekod Bukan Sifar')], [t('Date', 'Tarikh'), t('Kitchen Meals', 'Hidangan Dapur'), t('Snorkelling Water', 'Air Snorkelling')]);
  const recorded = t('Recorded', 'Direkod'), missingDay = t('Not Recorded', 'Belum Direkod'), future = t('Future Date', 'Tarikh Akan Datang');
  for (let d = period.start; d <= period.end; d = format(addDays(parseISO(d), 1), 'yyyy-MM-dd')) {
    const meal = now.usage.find(row => row.business_date === d), bottle = water.find(row => row.business_date === d);
    rows.push([d, meal ? recorded : d > today ? future : missingDay, bottle ? bottle.closed ? t('Closed', 'Cuti') : recorded : d > today ? future : missingDay]);
  }
  rows.push([], [t('Purchase Receipts - Actual RM', 'Resit Belian - RM Sebenar')], [t('Receipt ID', 'ID Resit'), t('Date', 'Tarikh'), t('Supplier', 'Pembekal'), t('Purpose', 'Tujuan'), t('Receipt No', 'No Resit'), t('Receipt Total RM', 'Jumlah Resit RM'), t('Item Total RM', 'Jumlah Item RM'), t('Tax RM', 'Cukai RM'), t('Discount RM', 'Diskaun RM'), t('Difference RM', 'Beza RM'), t('Payment Status', 'Status Bayaran'), t('Paid RM', 'Dibayar RM'), t('Outstanding RM', 'Baki RM'), t('Recorded By', 'Direkod Oleh'), t('Recorded At', 'Direkod Pada'), t('Status', 'Status'), t('Check', 'Semak'), t('Notes', 'Nota'), t('Supplier Address', 'Alamat Pembekal'), t('Supplier Tax ID', 'ID Cukai Pembekal'), t('Receipt Photo Reference', 'Rujukan Foto Resit'), t('Goods Photo Reference', 'Rujukan Foto Barang')]);
  const receipts = data.receipts.filter(r => r.purchase_date >= period.start && r.purchase_date <= period.end).sort((a, b) => a.purchase_date.localeCompare(b.purchase_date) || a.id.localeCompare(b.id));
  for (const r of receipts) {
    const breakdown = receiptBreakdown(r);
    rows.push([r.id, r.purchase_date, r.supplier, t(...purposeLabels[r.purpose]), r.receipt_no, money(r.total_cost), r.lines.length ? money(breakdown.allocated) : available, r.accounting_details?.tax || '', r.accounting_details?.discount || '', r.lines.length ? money(breakdown.difference) : available, t(...paymentLabels[paymentState(r)]), r.payment_checked ? money(r.paid_amount ?? 0) : available, r.payment_checked ? money(r.total_cost - (r.paid_amount ?? 0)) : available, r.created_by_name, r.created_at, r.status === 'void' ? t('Void - Excluded from Totals', 'Batal - Tidak Termasuk Jumlah') : t('Confirmed', 'Disahkan'), !r.lines.length ? t('No Item Breakdown', 'Tiada Pecahan Item') : breakdown.difference ? t('Receipt / Items Mismatch', 'Resit / Item Tidak Sepadan') : '', r.status === 'void' ? r.void_reason ?? '' : r.notes, r.accounting_details?.address ?? '', r.accounting_details?.tax_id ?? '', r.receipt_path, r.items_path]);
  }
  rows.push([], [t('Purchase Items - Receipt Totals Not Repeated', 'Item Belian - Jumlah Resit Tidak Diulang')], [t('Receipt ID', 'ID Resit'), t('Date', 'Tarikh'), t('Supplier', 'Pembekal'), t('Purpose', 'Tujuan'), t('Receipt No', 'No Resit'), t('Item', 'Item'), t('Category', 'Kategori'), t('Quantity', 'Kuantiti'), t('Unit', 'Unit'), t('Item Amount RM', 'Jumlah Item RM'), t('Receipt Status', 'Status Resit')]);
  for (const r of receipts) for (const l of r.lines) rows.push([r.id, r.purchase_date, r.supplier, t(...purposeLabels[r.purpose]), r.receipt_no, l.name, t(l.category, categoryLabels[l.category] ?? l.category), l.quantity, l.unit, money(l.amount), r.status === 'void' ? t('Void', 'Batal') : t('Confirmed', 'Disahkan')]);
  rows.push([], [t('Kitchen Meals - Recorded Days', 'Hidangan Dapur - Hari Direkod')], [t('Date', 'Tarikh'), t('Guest Meals', 'Hidangan Tetamu'), t('Staff Meals', 'Hidangan Staf'), t('Recorded By', 'Direkod Oleh'), t('Updated At', 'Dikemas Kini Pada'), t('Revision', 'Semakan'), t('Notes', 'Nota')]);
  for (const d of now.usage) rows.push([d.business_date, d.guest_meals, d.staff_meals, d.created_by_name, d.updated_at, d.revision, d.notes]);
  rows.push([], [t('Ingredient Usage - Saved Cost Estimates', 'Penggunaan Bahan - Anggaran Kos Tersimpan')], [t('Date', 'Tarikh'), t('Item', 'Item'), t('Base Unit', 'Unit Asas'), t('Guest Quantity', 'Kuantiti Tetamu'), t('Staff Quantity', 'Kuantiti Staf'), t('RM / Base Unit', 'RM / Unit Asas'), t('Estimated Guest Cost RM', 'Anggaran Kos Tetamu RM'), t('Estimated Staff Cost RM', 'Anggaran Kos Staf RM'), t('Check', 'Semak')]);
  for (const d of now.usage) for (const l of d.lines) rows.push([d.business_date, l.name, l.unit, l.guest_quantity, l.staff_quantity, l.unit_cost == null ? available : l.unit_cost, l.unit_cost == null && l.guest_quantity > 0 ? available : money(l.guest_quantity * (l.unit_cost ?? 0)), l.unit_cost == null && l.staff_quantity > 0 ? available : money(l.staff_quantity * (l.unit_cost ?? 0)), l.unit_cost == null && l.guest_quantity + l.staff_quantity > 0 ? t('Missing Cost Rate', 'Kadar Kos Tiada') : '']);
  rows.push([], [t('Snorkelling Water - Recorded Days', 'Air Snorkelling - Hari Direkod')], [t('Date', 'Tarikh'), t('Bottles Used', 'Botol Diguna'), t('Status', 'Status')]);
  for (const w of water.filter(r => r.business_date >= period.start && r.business_date <= period.end)) rows.push([w.business_date, w.bottles, w.closed ? t('Closed', 'Cuti') : t('Recorded', 'Direkod')]);
  const kind = { day: 'Daily', week: 'Weekly', month: 'Monthly' }[mode];
  return { filename: `Lovely-Paradise_Purchasing-Usage_${kind}_${period.start}_to_${period.end}.csv`, csv: csvText(rows) };
}
