import { useCallback, useEffect, useRef, useState } from 'react';
import { AlertTriangle, Eye, RefreshCw } from 'lucide-react';
import { supabase } from '../lib/supabase';
import { useLanguage } from '../lib/language';
import { useSharedRefresh } from '../lib/useSharedRefresh';
import { readErrorMessage } from '../lib/opsData';
import { reviewTime } from '../lib/receiptReview';
import type { ReceiptMatch } from '../lib/receiptDuplicates';
import { Modal } from './Modal';
import { iconButtonClass, secondaryButtonClass } from './Form';
import { PurchaseEvidenceViewer } from './PurchasePhotoField';

export function useReceiptDuplicateCheck(supplier: string, number: string, hash: string, excludeReviewId?: string, enabled = true) {
  const key = JSON.stringify([supplier.trim(), number.trim(), hash, excludeReviewId ?? null]);
  const needed = enabled && !!(hash || (supplier.trim() && number.trim()));
  const [result, setResult] = useState<{key: string; matches: ReceiptMatch[]; error: string} | null>(null);
  const sequence = useRef(0);
  const refresh = useCallback(async () => {
    if (!needed) return;
    const ticket = ++sequence.current;
    try {
      const [p_supplier, p_receipt_no, p_receipt_hash, p_exclude_review_id] = JSON.parse(key);
      const r = await supabase.rpc('check_purchase_receipt_duplicates', { p_supplier, p_receipt_no, p_receipt_hash, p_exclude_review_id });
      if (r.error) throw r.error;
      if (!Array.isArray(r.data)) throw Error('Receipt check returned no result.');
      if (ticket === sequence.current) setResult({ key, matches: r.data, error: '' });
    } catch (e) {
      if (ticket === sequence.current) setResult({ key, matches: [], error: readErrorMessage(e, 'Receipt check unavailable.') });
    }
  }, [key, needed]);
  useEffect(() => { const timer = setTimeout(() => void refresh(), 350); return () => { clearTimeout(timer); sequence.current++; }; }, [refresh]);
  useSharedRefresh(refresh, { enabled: needed, tables: ['expense_receipts', 'purchase_evidence', 'receipt_reviews'], intervalMs: 15000 });
  const checked = !needed || result?.key === key;
  const matches = needed && result?.key === key ? result.matches : [];
  const error = needed && result?.key === key ? result.error : '';
  return { matches, error, checking: !checked, blocked: !checked || !!error || matches.some(r => r.status === 'confirmed'), refresh };
}

export function ReceiptDuplicateCheck({ check }: { check: ReturnType<typeof useReceiptDuplicateCheck> }) {
  const { text: t, language } = useLanguage();
  const [selected, setSelected] = useState<ReceiptMatch | null>(null);
  if (!check.checking && !check.error && !check.matches.length) return null;
  return <section className="receipt-duplicate-check" aria-label={t('Receipt Check', 'Semakan Resit')}>
    {check.checking ? <p role="status">{t('Checking for an Existing Receipt...', 'Menyemak Resit Sedia Ada...')}</p> : check.error ? <div role="alert"><p>{t('Cannot check existing receipts yet. Your entry is kept; retry before confirming.', 'Resit sedia ada belum dapat disemak. Catatan dikekalkan; cuba lagi sebelum mengesahkan.')}</p><button type="button" className={secondaryButtonClass} onClick={() => void check.refresh()}><RefreshCw size={16}/>{t('Retry Check', 'Cuba Semak Lagi')}</button></div> : <>
      <h3><AlertTriangle size={16}/>{check.matches.some(r => r.status === 'confirmed') ? t('Receipt Already Recorded', 'Resit Sudah Direkod') : t('Matching Pending Receipt', 'Resit Tertunda Sepadan')}</h3>
      <p>{check.matches.some(r => r.status === 'confirmed') ? t('Do not enter this purchase twice. Check the existing record below.', 'Jangan rekod pembelian ini dua kali. Semak rekod sedia ada di bawah.') : t('Check with the purchaser below before confirming. Neither entry has been counted as spending yet.', 'Semak dengan pembeli di bawah sebelum mengesahkan. Kedua-dua catatan belum dikira sebagai perbelanjaan.')}</p>
      <ul>{check.matches.map(r => <li key={r.source + r.id}><div><strong>{r.supplier || t('Supplier Not Entered', 'Pembekal Belum Diisi')}</strong><span>{r.receipt_no || t('No Receipt Number', 'Tiada Nombor Resit')}{r.purchase_date ? ` · ${r.purchase_date}` : ''}{r.total_cost !== null ? ` · RM ${Number(r.total_cost).toFixed(2)}` : ''}</span><span>{r.created_by_name} · {r.status === 'pending' ? t('Pending Review', 'Menunggu Semakan') : t('Confirmed', 'Disahkan')}</span><small>{r.match === 'photo' ? t('Same Receipt Photo', 'Foto Resit Sama') : t('Same Supplier & Receipt Number', 'Pembekal & Nombor Resit Sama')}</small></div><button type="button" className={iconButtonClass} title={t('View Existing Receipt', 'Lihat Resit Sedia Ada')} aria-label={t('View Existing Receipt', 'Lihat Resit Sedia Ada')} onClick={() => setSelected(r)}><Eye size={16}/></button></li>)}</ul>
    </>}
    {selected ? <Modal title={t('Existing Receipt', 'Resit Sedia Ada')} onClose={() => setSelected(null)} footer={<button className={secondaryButtonClass} onClick={() => setSelected(null)}>{t('Back to Entry', 'Kembali ke Catatan')}</button>}>
      <div className="receipt-existing-summary"><strong>{selected.supplier}</strong><span>{selected.receipt_no || t('No Receipt Number', 'Tiada Nombor Resit')} · {selected.purchase_date}</span>{selected.total_cost !== null ? <strong>RM {Number(selected.total_cost).toFixed(2)}</strong> : null}<span>{selected.created_by_name}</span><span>{reviewTime(selected.created_at, language)}</span><span>{selected.source === 'request' ? t('Recorded from To Buy', 'Direkod dari Untuk Dibeli') : selected.status === 'pending' ? t('Pending Review', 'Menunggu Semakan') : t('Confirmed Receipt', 'Resit Disahkan')}</span></div>
      {selected.receipt_path && selected.items_path ? <PurchaseEvidenceViewer receipt={selected.receipt_path} items={selected.items_path}/> : <p className="text-sm text-muted">{t('Both photos have not been attached yet.', 'Kedua-dua foto belum dilampirkan.')}</p>}
    </Modal> : null}
  </section>;
}
