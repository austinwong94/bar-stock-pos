import { useCallback, useEffect, useRef, useState } from 'react';
import { Search, ShoppingBasket, RefreshCw, PackageX, Undo2, FilePenLine } from 'lucide-react';
import { buttonClass, iconButtonClass, inputClass, secondaryButtonClass } from '../../components/Form';
import { useAccess } from '../../lib/access';
import { useLanguage } from '../../lib/language';
import { readErrorMessage, todayIso } from '../../lib/opsData';
import { remainingToBuy, type PurchaseQueue } from '../../lib/purchasingProgress';
import type { PurchaseRequest, PurchaseRequestItem } from '../../lib/platformTypes';
import { isDemoMode, supabase } from '../../lib/supabase';
import { useSharedRefresh } from '../../lib/useSharedRefresh';
import { PurchaseBatch } from './PurchaseBatch';
import { purchaseDraftEvent, purchaseDraftList, purchaseDraftPrefix } from '../../lib/purchaseDraft';
import { ReceiptReviewEditor, ReceiptReviewQueue } from './ReceiptReview';
import type { ReceiptReview } from '../../lib/receiptReview';
import { DeliveryIssueInbox } from './DeliveryIssues';
import { requestItemMatches } from '../../lib/kitchenRequestDraft';

export default function ShoppingList() {
  const { text:t } = useLanguage(), { can, profile, reloadBadges } = useAccess();
  const [requests,setRequests] = useState<PurchaseRequest[]>([]), [query,setQuery] = useState(''), [scope,setScope] = useState('all');
  const [loading,setLoading] = useState(true), [error,setError] = useState(''), [selected,setSelected] = useState<{ request: PurchaseRequest | null; key?: string }|null>(null);
  const [saving,setSaving]=useState(false),[notice,setNotice]=useState('');
  const [receiptReview,setReceiptReview]=useState<ReceiptReview|null>(null),[reviewRevision,setReviewRevision]=useState(0);
  const changing=useRef(false);
  const generation=useRef(0);
  const draftPrefix = purchaseDraftPrefix(isDemoMode ? 'preview' : 'cloud', import.meta.env.VITE_SUPABASE_URL ?? 'review', profile?.id ?? '');
  const [drafts, setDrafts] = useState<ReturnType<typeof purchaseDraftList>>([]), [draftError, setDraftError] = useState(false);
  const canDraft = can('purchasing.fulfil') && can('purchasing.cost.view');
  const ownDrafts = drafts.filter(row => row.key.startsWith(draftPrefix));
  useEffect(() => {
    const read = () => {
      if (!profile?.id || !canDraft) { setDrafts([]); return; }
      try { setDrafts(purchaseDraftList(localStorage, draftPrefix, profile.id)); setDraftError(false); }
      catch { setDraftError(true); }
    };
    read(); window.addEventListener('storage', read); window.addEventListener(purchaseDraftEvent, read);
    return () => { window.removeEventListener('storage', read); window.removeEventListener(purchaseDraftEvent, read); };
  }, [profile?.id, canDraft, draftPrefix]);
  const refresh=useCallback(async()=>{
    const ticket=++generation.current;setLoading(true);
    try {
      const all:PurchaseRequest[]=[];
      for(let offset=0;offset<10000;offset+=50){
        const result=await supabase.rpc('read_purchasing_queue',{p_view:'open',p_query:'',p_limit:50,p_offset:offset});
        if(result.error)throw result.error;
        if(ticket!==generation.current)return;
        const page=result.data as PurchaseQueue;
        all.push(...page.requests);
        if(offset+page.requests.length>=page.total)break;
        if(!page.requests.length||offset===9950)throw new Error(t('Buying list is incomplete. Refresh before purchasing.','Senarai belian tidak lengkap. Muat semula sebelum membeli.'));
      }
      setRequests([...new Map(all.map(r=>[r.id,r])).values()]);setError('');
    }catch(e){if(ticket===generation.current)setError(readErrorMessage(e,t('Could not update the buying list.','Senarai belian tidak dapat dikemas kini.')));}
    finally{if(ticket===generation.current)setLoading(false);}
  },[t]);
  useEffect(()=>{void refresh();return()=>{generation.current++;};},[refresh]);
  useSharedRefresh(refresh,{tables:['purchase_requests','purchase_request_items','purchase_receipts']});
  async function changeAvailability(item:PurchaseRequestItem){
    if(changing.current)return;changing.current=true;setSaving(true);setNotice('');
    try{
      const status=item.purchase_status==='unavailable'?'pending':'unavailable';
      const result=await supabase.rpc('set_purchase_item_status_checked',{p_item_id:item.id,p_expected_updated_at:item.updated_at,p_status:status,p_purchased_quantity:null,p_actual_cost:null,p_supplier:null,p_note:null});
      if(result.error)throw result.error;
      setNotice(item.item_name+' · '+(status==='unavailable'?t('Moved to Unavailable','Dipindahkan ke Tiada'):t('Returned to Buying List','Kembali ke Senarai Belian')));
      await refresh();void reloadBadges();
    }catch(e){setError(readErrorMessage(e,t('Could not change availability. Refresh and try again.','Status tidak dapat diubah. Muat semula dan cuba lagi.')));}
    finally{changing.current=false;setSaving(false);}
  }
  const pending=requests.filter(r=>r.status!=='cancelled').map(r=>({...r,purchase_request_items:r.purchase_request_items?.filter(i=>i.purchase_status!=='unavailable'&&remainingToBuy(i)>0)??[]})).filter(r=>r.purchase_request_items.length);
  const unavailable=requests.filter(r=>r.status!=='cancelled').map(r=>({...r,purchase_request_items:r.purchase_request_items?.filter(i=>i.purchase_status==='unavailable')??[]})).filter(r=>r.purchase_request_items.length);
  const visible=(scope==='unavailable'?unavailable:pending).filter(r=>scope!=='due'||r.needed_for_date<=todayIso()).map(r=>{
    const q=query.trim().toLowerCase(),whole=[r.request_no,r.purpose,r.notes,r.needed_for_date].join(' ').toLowerCase().includes(q);
    return {...r,purchase_request_items:r.purchase_request_items.filter(i=>whole||requestItemMatches(i,q)||[i.supplier,i.note].join(' ').toLowerCase().includes(q))};
  }).filter(r=>r.purchase_request_items.length);
  return <section className="shopping-list" aria-label={t('Buying List','Senarai Belian')}>
    <div className="supply-toolbar"><h2>{t('To Buy','Untuk Beli')} <span className="text-muted text-xs font-normal">{pending.reduce((n,r)=>n+r.purchase_request_items.length,0)} {t('items','item')}</span></h2><button className={iconButtonClass} aria-label={t('Refresh Buying List','Muat Semula Senarai Belian')} title={t('Refresh Buying List','Muat Semula Senarai Belian')} disabled={loading} onClick={()=>void refresh()}><RefreshCw size={16}/></button></div>
    {can('purchasing.cost.view')?<ReceiptReviewQueue requestsOnly revision={reviewRevision} onOpen={setReceiptReview}/>:null}
    <DeliveryIssueInbox/>
    {canDraft && ownDrafts.length ? <section className="purchase-device-drafts" aria-label={t('Unfinished Purchases', 'Belian Belum Selesai')}>
      <h3>{t('On This Device', 'Pada Peranti Ini')}</h3>
      {ownDrafts.map(({ key, draft }) => <div key={key}><span><strong>{draft?.request.request_no ?? t('Draft Needs Checking', 'Draf Perlu Disemak')}</strong>
        <small>{draft?.attempted ? t('Confirmation Pending', 'Pengesahan Belum Pasti') : t('Draft · Not Submitted', 'Draf · Belum Dihantar')}{draft?.supplier ? ' · ' + draft.supplier : ''}</small>
        {draft ? <small>{draft.purchaseDate} · {Object.values(draft.entries).filter(e => e.quantity.trim() || e.cost.trim()).length} {t('items', 'item')}</small> : null}
      </span><button type="button" className={secondaryButtonClass} onClick={() => setSelected({ request: null, key })}>{draft?.attempted ? <RefreshCw size={16}/> : <FilePenLine size={16}/>}<span>{draft?.attempted ? t('Check Confirmation', 'Semak Pengesahan') : t('Resume', 'Sambung')}</span></button></div>)}
    </section> : null}
    {canDraft && draftError ? <p role="alert" className="my-2 text-sm text-danger">{t('Device drafts could not be loaded. Check browser storage before starting another purchase.', 'Draf peranti tidak dapat dimuatkan. Semak storan pelayar sebelum memulakan belian lain.')}</p> : null}
    <div className="shopping-filter"><div className="supply-segments">{[['all',t('All Needed','Semua')],['due',t('Due Today','Hari Ini')],['unavailable',t('Unavailable','Tiada')+' ('+unavailable.reduce((n,r)=>n+r.purchase_request_items.length,0)+')']].map(([key,label])=><button key={key} aria-pressed={scope===key} onClick={()=>setScope(key)}>{label}</button>)}</div><label className="relative min-w-0"><Search size={16} className="absolute left-3 top-3.5 text-muted"/><input className={inputClass+' !pl-9'} aria-label={t('Search Buying List','Cari Senarai Belian')} placeholder={t('Item, Supplier or Request','Item, Pembekal atau Pesanan')} value={query} onChange={e=>setQuery(e.target.value)}/></label></div>
    {loading?<p role="status" className="my-3 text-sm text-muted">{t('Updating Buying List...','Mengemas Kini Senarai Belian...')}</p>:null}
    {error?<p role="alert" className="my-3 text-sm text-danger">{error}</p>:null}
    {notice?<p role="status" className="my-2 text-xs text-palm">{notice}</p>:null}
    {visible.map(request=><section key={request.id} className="shopping-request">
      <header><div><strong>{request.request_no}</strong><small>{t('Needed','Diperlukan')} {request.needed_for_date}{request.purpose?' · '+request.purpose:''}</small></div>{canDraft&&scope!=='unavailable'?<button className={buttonClass} disabled={loading||saving||!!error||draftError} onClick={()=>setSelected({request:pending.find(r=>r.id===request.id)!})}><ShoppingBasket size={16}/>{ownDrafts.some(d=>d.key===draftPrefix+request.id)?t('Resume Purchase','Sambung Belian'):t('Record Purchase','Rekod Belian')}</button>:null}</header>
      <ul>{request.purchase_request_items.map(item=><li key={item.id}>
        <div><strong>{item.item_name}</strong>{item.note?<small>{item.note}</small>:null}{item.supplier?<small>{item.supplier}</small>:null}</div>
        <div className="shopping-quantity">
          <strong className="tabular">{remainingToBuy(item).toLocaleString('en-MY',{maximumFractionDigits:2})} <span className="font-normal">{item.unit}</span></strong>
          {can('purchasing.fulfil')?(item.purchase_status==='unavailable'||!Number(item.purchased_quantity)?
            <button className={iconButtonClass} disabled={loading||saving||!!error}
              title={scope==='unavailable'?t('Try Buying Again','Cuba Beli Lagi'):t('Mark Unavailable','Tandakan Tiada')}
              aria-label={(scope==='unavailable'?t('Try Buying Again','Cuba Beli Lagi'):t('Mark Unavailable','Tandakan Tiada'))+': '+item.item_name}
              onClick={()=>void changeAvailability(item)}>{scope==='unavailable'?<Undo2 size={16}/>:<PackageX size={16}/>}</button>
            :<span className="w-11 shrink-0" aria-hidden="true"/>):null}
        </div>
      </li>)}</ul>
      {request.notes?<p className="mt-2 text-xs text-muted break-words">{request.notes}</p>:null}
    </section>)}
    {!loading&&!error&&!visible.length?<p className="py-6 text-sm text-muted">{t('Nothing to buy for this selection.','Tiada barang untuk dibeli bagi pilihan ini.')}</p>:null}
    {selected && canDraft ? <PurchaseBatch key={selected.key ?? draftPrefix + selected.request?.id} request={selected.request} storageKey={selected.key} onClose={()=>{setSelected(null);setReviewRevision(n=>n+1);}} onSaved={()=>{void refresh();void reloadBadges();setReviewRevision(n=>n+1);}}/>:null}
    {receiptReview?<ReceiptReviewEditor key={receiptReview.id} initial={receiptReview} onClose={()=>{setReceiptReview(null);setReviewRevision(n=>n+1);}} onSaved={()=>{setReceiptReview(null);setReviewRevision(n=>n+1);setNotice(t('Purchase Confirmed · Awaiting Delivery','Pembelian Disahkan · Menunggu Penghantaran'));void refresh();void reloadBadges();}}/>:null}
  </section>;
}
