import { useEffect, useState } from 'react';
import { Field, inputClass } from '../../components/Form';
import { useLanguage } from '../../lib/language';
import { isDemoMode, supabase } from '../../lib/supabase';
import { readErrorMessage } from '../../lib/opsData';
import type { ReceiptAISettings as Settings } from '../../lib/receiptReview';
import { CheckCircle2, Circle, RefreshCw } from 'lucide-react';
import { secondaryButtonClass } from '../../components/Form';

type Readiness = {database_ready:boolean;private_storage_ready:boolean;key_configured:boolean;api_tested:false};

export function ReceiptAISettings(){
  const {text:t}=useLanguage();const [settings,setSettings]=useState<Settings|null>(null),[error,setError]=useState(''),[busy,setBusy]=useState(false);
  const [readiness,setReadiness]=useState<Readiness|null>(null),[checking,setChecking]=useState(false),[checkError,setCheckError]=useState('');
  async function checkSetup(){
    if(isDemoMode||checking)return;
    setChecking(true);setReadiness(null);setCheckError('');
    try{
      const result=await supabase.functions.invoke('scan-receipt-review',{body:{action:'status'}});
      if(result.error||result.data?.error)throw result.error??new Error(result.data.error);
      if(!result.data||['database_ready','private_storage_ready','key_configured'].some(k=>typeof result.data[k]!=='boolean'))throw Error('Invalid setup response');
      setReadiness(result.data);
    }catch{setCheckError(t('Could not verify setup. Check the function deployment, allowed website address and administrator access. No receipt was scanned.','Tetapan tidak dapat disahkan. Semak fungsi, alamat laman dibenarkan dan akses pentadbir. Tiada resit diimbas.'));}
    finally{setChecking(false);}
  }
  useEffect(()=>{void supabase.rpc('read_receipt_ai_settings').then(({data,error}:{data:Settings|null;error:{message:string}|null})=>error?setError(error.message):setSettings(data)).catch(()=>setError('settings_unavailable'));},[]);
  async function save(next:Settings){if(busy||!settings)return;setBusy(true);try{const r=await supabase.rpc('save_receipt_ai_settings',{p_enabled:next.enabled,p_daily_limit:next.daily_limit,p_version:settings.version});if(r.error)throw r.error;setSettings(r.data);setError('');}catch(e){setError(readErrorMessage(e,'Settings were not saved. Reload to check the current setting.'));}finally{setBusy(false);}}
  return <section className="max-w-xl py-3"><h2 className="mb-4 text-base font-semibold">{t('Receipt Scanning','Imbasan Resit')}</h2>
    {settings?<><label className="flex min-h-11 items-center justify-between gap-4 border-y border-line py-3 text-sm font-semibold">{t('Automatic AI Receipt Scan','Imbasan Resit AI Automatik')}<input type="checkbox" role="switch" className="h-5 w-5 accent-accent" disabled={busy} checked={settings.enabled} onChange={e=>void save({...settings,enabled:e.target.checked})}/></label>
      <div className="my-4 grid grid-cols-2 gap-3"><Field label={t('Model','Model')}><input className={inputClass} value="GPT-6 Luna" readOnly/></Field><Field label={t('Daily Scan Limit','Had Imbasan Harian')}><select className={inputClass} disabled={busy} value={settings.daily_limit} onChange={e=>void save({...settings,daily_limit:Number(e.target.value)})}>{[20,50,100,200,500,1000].map(n=><option key={n}>{n}</option>)}</select></Field></div>
    </>:null}
      <section aria-label={t('Scan Setup','Tetapan Imbasan')} className="border-y border-line py-4">
        <h3 className="text-sm font-semibold">{isDemoMode?t('Preview Only - AI Not Connected','Pratonton Sahaja - AI Belum Disambung'):t('Connection Setup','Tetapan Sambungan')}</h3>
        <p role="status" className="mt-2 text-sm text-muted">{isDemoMode?t('This review uses sample data on this device. The switch does not connect OpenAI or make paid scans.','Pratonton ini menggunakan data contoh pada peranti ini. Suis tidak menyambung OpenAI atau membuat imbasan berbayar.'):t('Check the server configuration before scanning. This check does not send receipts to OpenAI and has no OpenAI API charge.','Semak tetapan pelayan sebelum mengimbas. Semakan ini tidak menghantar resit ke OpenAI dan tiada caj API OpenAI.')}</p>
        {!isDemoMode?<button type="button" className={secondaryButtonClass+' mt-3'} disabled={checking} onClick={()=>void checkSetup()}><RefreshCw size={16}/>{checking?t('Checking...','Menyemak...'):t('Check Setup','Semak Tetapan')}</button>:null}
        {readiness?<><ul className="mt-3 grid gap-2 text-sm">{[
          [readiness.database_ready,t('Receipt Database','Pangkalan Data Resit')],
          [readiness.private_storage_ready,t('Private Photo Storage','Storan Foto Peribadi')],
          [readiness.key_configured,t('OpenAI Key Saved on Server','Kunci OpenAI Disimpan pada Pelayan')],
        ].map(([ready,label])=><li key={String(label)} className="flex items-center gap-2">{ready?<CheckCircle2 size={17} className="shrink-0 text-accent"/>:<Circle size={17} className="shrink-0 text-warning"/>}<span className="min-w-0">{label}: {ready?t('Ready','Sedia'):t('Not Ready','Belum Sedia')}</span></li>)}</ul><p className="mt-3 text-xs text-muted">{t('A saved key is not proof of available credits or model access. A successful receipt scan is still needed to verify those.','Kunci disimpan bukan bukti kredit atau akses model tersedia. Imbasan resit berjaya masih diperlukan untuk mengesahkannya.')}</p></>:null}
        {checkError?<p role="alert" className="mt-3 text-sm text-danger">{checkError}</p>:null}
        <ol className="mt-4 list-decimal space-y-2 pl-5 text-sm text-muted">
          <li>{t('Use the existing Supabase project. Deploy the receipt database updates and scan-receipt-review function.','Gunakan projek Supabase sedia ada. Pasang kemas kini pangkalan data resit dan fungsi scan-receipt-review.')}</li>
          <li>{t('Supabase > Edge Functions > Secrets: save OPENAI_API_KEY and set RECEIPT_ALLOWED_ORIGINS to the live website address.','Supabase > Edge Functions > Secrets: simpan OPENAI_API_KEY dan tetapkan RECEIPT_ALLOWED_ORIGINS kepada alamat laman langsung.')}</li>
          <li>{t('Connect the live app, check setup, then enable scanning. Never enter secret keys in the app or chat.','Sambung aplikasi langsung, semak tetapan, kemudian aktifkan imbasan. Jangan masukkan kunci rahsia dalam aplikasi atau sembang.')}</li>
        </ol>
      </section>
      <p className="mt-3 text-xs text-muted">{t('Human confirmation required. Pending receipts and audit history remain when scanning is switched off.','Pengesahan manusia diwajibkan. Resit tertunda dan sejarah audit kekal apabila imbasan dimatikan.')}</p>
    {error?<p role="alert" className="mt-3 text-sm text-danger">{settings?error:t('Receipt settings could not load. Verify the database updates and reload before enabling scanning.','Tetapan resit tidak dapat dimuatkan. Semak kemas kini pangkalan data dan muat semula sebelum mengaktifkan imbasan.')}</p>:null}
  </section>;
}
