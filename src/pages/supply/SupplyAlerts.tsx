import { useEffect, useState } from 'react';
import { ExternalLink, RefreshCw } from 'lucide-react';
import { Modal } from '../../components/Modal';
import { iconButtonClass, secondaryButtonClass } from '../../components/Form';
import { isDemoMode, supabase } from '../../lib/supabase';
import { useLanguage } from '../../lib/language';
import { readErrorMessage } from '../../lib/opsData';

type Alert={id:string;title:string;body:string;created_at:string;delivery_status:string};
export default function SupplyAlerts({onClose}:{onClose:()=>void}){
  const {text:t}=useLanguage(),[rows,setRows]=useState<Alert[]>([]),[error,setError]=useState(''),[busy,setBusy]=useState(false),[verified,setVerified]=useState(false);
  async function refresh(){
    setBusy(true);
    try{const result=await supabase.rpc('read_kitchen_alerts');if(result.error)throw result.error;setRows(result.data.messages);setVerified(result.data.verified);setError('');}
    catch(e){setError(readErrorMessage(e,t('Alert service is not connected yet.','Perkhidmatan makluman belum disambungkan.')));}
    finally{setBusy(false);}
  }
  useEffect(()=>{void refresh();},[]);
  const labels:Record<string,string>={pending:t('Waiting for Sender','Menunggu Penghantar'),sending:t('Sending','Menghantar'),sent:t('Sent','Dihantar'),failed:t('Send Failed','Gagal Dihantar'),uncertain:t('Check Delivery','Semak Penghantaran')};
  return <Modal title={t('Group Alerts','Makluman Kumpulan')} onClose={onClose}>
    <div className="mb-3 flex justify-between items-center gap-2"><strong className="text-sm">{isDemoMode?t('Preview Only · Nothing Sent','Pratonton Sahaja · Tiada Dihantar'):verified?t('Sender Verified','Penghantar Disahkan'):t('Not Connected','Belum Disambungkan')}</strong><button className={iconButtonClass} title={t('Refresh','Muat Semula')} aria-label={t('Refresh Alerts','Muat Semula Makluman')} disabled={busy} onClick={()=>void refresh()}><RefreshCw size={16}/></button></div>
    <ul className="mb-4 list-disc pl-5 text-sm"><li>{t('Request Sent to Purchasing','Permintaan Dihantar ke Pembelian')}</li><li>{t('Delivery Confirmed','Penghantaran Disahkan')}</li><li>{t('Stock Check Confirmed','Semakan Stok Disahkan')}</li></ul>
    {!verified?<p className="mb-3 text-sm text-muted">{t('Automatic group delivery needs a verified server connection. Drafts do not send alerts.','Penghantaran automatik ke kumpulan memerlukan sambungan pelayan disahkan. Draf tidak menghantar makluman.')}</p>:null}
    {error?<p role="alert" className="mb-3 text-sm text-danger">{error}</p>:null}
    <ul className="divide-y divide-line">{rows.map(row=><li key={row.id} className="py-3"><div className="flex items-start justify-between gap-3"><strong className="min-w-0 break-words text-sm">{row.title}</strong><span className="text-xs text-muted">{isDemoMode?t('Preview','Pratonton'):labels[row.delivery_status]??row.delivery_status}</span></div><p className="mt-1 text-xs text-muted">{new Date(row.created_at).toLocaleString('en-GB',{timeZone:'Asia/Kuala_Lumpur'})} MYT</p><p className="my-2 whitespace-pre-wrap break-words text-xs">{row.body}</p><a className={secondaryButtonClass} href={'https://wa.me/?text='+encodeURIComponent(row.body)} target="_blank" rel="noreferrer"><ExternalLink size={16}/>{t('Share on WhatsApp','Kongsi di WhatsApp')}</a></li>)}</ul>
    {!busy&&!error&&!rows.length?<p className="text-sm text-muted">{t('No confirmed submissions yet.','Belum ada penghantaran disahkan.')}</p>:null}
  </Modal>;
}
