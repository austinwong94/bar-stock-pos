import { Navigate, useSearchParams } from 'react-router-dom';
import { KitchenHeader } from '../../components/KitchenHeader';
import { useLanguage } from '../../lib/language';
import { useAccess } from '../../lib/access';
import type { SettingsMap } from '../../lib/types';
import PurchaseReceipts from './PurchaseReceipts';
import Purchasing from './Purchasing';
import ShoppingList from './ShoppingList';

export default function PurchasingWorkspace({settings}:{settings:SettingsMap}) {
  const {text:t}=useLanguage(),{can}=useAccess(),[params,setParams]=useSearchParams();
  const tabs=[['open',t('To Buy','Untuk Beli')],...(can('purchasing.cost.view')?[['receipts',t('Receipts','Resit')]]:[]),['history',t('History','Sejarah')]];
  const tab=tabs.some(([key])=>key===params.get('view'))?params.get('view')!:tabs[0][0];
  if(params.get('view')==='receiving')return <Navigate to="/kitchen/stock?view=arrivals" replace/>;
  if(params.get('view')==='costs')return <Navigate to="/kitchen/finance" replace/>;
  return <div className="supply-workspace"><KitchenHeader/><nav className="supply-segments mb-4" style={{gridTemplateColumns:`repeat(${tabs.length},minmax(0,1fr))`}} aria-label={t('Purchase Sections','Bahagian Pembelian')}>{tabs.map(([key,label])=><button key={key} aria-pressed={key===tab} onClick={()=>setParams({view:key})}>{label}</button>)}</nav>{tab==='receipts'?<PurchaseReceipts/>:tab==='open'?<ShoppingList/>:<Purchasing key={tab} settings={settings} embedded/>}</div>;
}
