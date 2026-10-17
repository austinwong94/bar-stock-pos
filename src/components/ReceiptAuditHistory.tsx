import { useLanguage } from '../lib/language';
import { receiptChanges, receiptFieldLabels } from '../lib/receiptHistory';
import { reviewTime, type ReceiptEvent } from '../lib/receiptReview';
import { categoryLabels, purposeLabels } from '../lib/supplyWorkflow';

const actions: Record<string, [string, string]> = { created: ['Created', 'Dicipta'], edited: ['Edited', 'Diubah'], scan_started: ['Scan Started', 'Imbasan Bermula'], scan_completed: ['Scan Completed', 'Imbasan Selesai'], scan_failed: ['Scan Failed', 'Imbasan Gagal'], scan_reset: ['Scan Reset', 'Imbasan Ditetap Semula'], removed: ['Removed', 'Dibuang'], confirmed: ['Confirmed', 'Disahkan'] };

export function ReceiptAuditHistory({ events, itemNames={} }: { events: ReceiptEvent[];itemNames?:Record<string,string> }) {
  const { text: t, language } = useLanguage();
  function value(field: string, text: string) {
    if (!text) return t('Not Entered', 'Belum Diisi');
    if (field === 'purpose' && purposeLabels[text]) return t(...purposeLabels[text]);
    if (field === 'category') return t(text, categoryLabels[text] ?? text);
    if (['receipt', 'items'].includes(field)) return text === 'attached' ? t('Attached', 'Dilampirkan') : t('Replaced', 'Diganti');
    if (['total_cost', 'subtotal', 'tax', 'discount', 'amount','cost'].includes(field) && /^\d+(\.\d{1,2})?$/.test(text)) return `RM ${Number(text).toFixed(2)}`;
    return text;
  }
  return <ol className="receipt-review-history">{[...events].reverse().map(e => {
    const changes = receiptChanges(e), after = (e.after_json ?? {}) as { reason?: string; error?: string; review_note?: string; extraction?: { warnings?: string[]; unreadable?: {location: string; reason: string}[]; items?: unknown[] } };
    return <li key={e.id}><strong>{t(...(actions[e.action] ?? (e.action==='request_linked'?['Linked to Buying List','Disambung ke Senarai Belian']:e.action==='buying_list_refreshed'?['Buying List Refreshed','Senarai Belian Dimuat Semula']:[e.action, e.action])))}</strong><span>{e.actor_name} · {reviewTime(e.created_at, language)}</span>
      {after.reason || after.error || (e.action === 'confirmed' && after.review_note) ? <p>{after.reason || after.error || after.review_note}</p> : null}
      {e.action === 'scan_completed' && after.extraction ? <p>{after.extraction.items?.length ?? 0} {t('Items Read', 'Item Dibaca')} · {(after.extraction.warnings?.length ?? 0) + (after.extraction.unreadable?.length ?? 0)} {t('Details Flagged', 'Butiran Ditandakan')}</p> : null}
      {changes.length ? <dl className="receipt-audit-changes">{changes.map((c, i) => <div key={i}><dt>{c.item ? `${itemNames[c.item]??c.item} · ` : ''}{t(...receiptFieldLabels[c.field])}</dt><dd><span className="receipt-audit-before"><small>{t('Before', 'Sebelum')}</small>{value(c.field, c.before)}</span><span className="receipt-audit-after"><small>{t('After', 'Selepas')}</small>{value(c.field, c.after)}</span></dd></div>)}</dl> : null}
    </li>;
  })}</ol>;
}
