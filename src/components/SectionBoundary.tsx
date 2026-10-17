import { Component, Suspense, type ReactNode } from 'react';
import { AlertTriangle, RefreshCw } from 'lucide-react';
import { useLanguage } from '../lib/language';
import { secondaryButtonClass } from './Form';

class Boundary extends Component<{children:ReactNode},{failed:boolean}> {
  state={failed:false};
  static getDerivedStateFromError(){return {failed:true};}
  render(){return this.state.failed?<SectionFailure/>:this.props.children;}
}
function SectionFailure(){
  const {text:t}=useLanguage();
  return <section role="alert" className="py-5">
    <h1 className="flex items-center gap-2 text-base font-bold"><AlertTriangle size={18} className="shrink-0 text-warning"/>{t('This Section Could Not Load','Bahagian Ini Tidak Dapat Dimuatkan')}</h1>
    <p className="mt-2 max-w-xl text-sm text-muted">{t('Check your connection. You can open another section or reload when ready.','Semak sambungan anda. Anda boleh membuka bahagian lain atau memuat semula apabila bersedia.')}</p>
    <p className="mt-2 max-w-xl text-xs text-muted">{t('Saved device drafts stay on this device. Check the original record before re-entering an interrupted submission.','Draf peranti tersimpan kekal pada peranti ini. Semak rekod asal sebelum mengisi semula penghantaran terganggu.')}</p>
    <button type="button" className={secondaryButtonClass+' mt-4'} onClick={()=>{
      if(window.confirm(t('Reload this page? Saved drafts remain, but unsaved entries may be lost.','Muat semula halaman ini? Draf tersimpan kekal, tetapi catatan belum disimpan mungkin hilang.')))window.location.reload();
    }}><RefreshCw size={16}/>{t('Reload Page','Muat Semula Halaman')}</button>
  </section>;
}
export function SectionBoundary({children}:{children:ReactNode}) {
  const {text:t}=useLanguage();
  return <Boundary><Suspense fallback={<p role="status" aria-busy="true" className="py-5 text-sm text-muted">{t('Loading Section...','Memuatkan Bahagian...')}</p>}>{children}</Suspense></Boundary>;
}
