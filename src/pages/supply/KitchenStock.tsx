import { useCallback, useEffect, useRef, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { ArrowDownToLine, ClipboardCheck, History, Search, Utensils } from 'lucide-react';
import { KitchenHeader } from '../../components/KitchenHeader';
import { inputClass, secondaryButtonClass } from '../../components/Form';
import { useLanguage } from '../../lib/language';
import { useAccess } from '../../lib/access';
import { isDemoMode, supabase } from '../../lib/supabase';
import { readErrorMessage } from '../../lib/opsData';
import { useSharedRefresh } from '../../lib/useSharedRefresh';
import { countBalance, countDisplay, countUnit, type CountItem } from '../../lib/stockCount';
import KitchenStockCount from './KitchenStockCount';
import KitchenStockOut from './KitchenStockOut';
import FoodStockHistory from './FoodStockHistory';
import KitchenUsage from './DailyKitchenUsage';
import KitchenArrivals from './KitchenReceiving';
import SnorkellingWater from './SnorkellingWater';
import KitchenUnitSetup from './KitchenUnitSetup';
import FoodItemHistory, { type ItemHistorySelection } from './FoodItemHistory';
import { kitchenOrdered, kitchenName, kitchenUnit, kitchenValue, kitchenMatches } from '../../lib/kitchenCatalogue';
import { usageDate } from '../../lib/dailyUsageDraft';
import { waterKeys } from '../../lib/waterUsageDraft';

const quantity=(n:number,u:string)=>`${countDisplay(Number(n),u)} ${countUnit(u)}`;

export default function KitchenStock() {
  const {text:t}=useLanguage(), {can,profile}=useAccess();
  const [items,setItems]=useState<CountItem[]>([]);
  const [params,setParams]=useSearchParams();
  const requestedDate=params.get('date');
  const resumeDate=usageDate(requestedDate)?requestedDate:undefined;
  const resumeSize=waterKeys.includes(params.get('size')??'')?params.get('size')!:undefined;
  const requested=['stock','out','count','history','usage','arrivals','water'].includes(params.get('view')??'')?params.get('view')!:'usage';
  const fallback=can('kitchen.production.manage')?'usage':can('purchasing.receive')?'arrivals':can('kitchen.stock.count')?'count':'stock';
  const restricted=(!can('kitchen.production.manage')&&['usage','out','water'].includes(requested))
    ||(requested==='arrivals'&&!can('purchasing.receive'))||(requested==='count'&&!can('kitchen.stock.count'));
  const tab=restricted?fallback:requested;
  const setTab=(value:string)=>{setNotice('');setParams({view:value});};
  const [search,setSearch]=useState(''),[unitSetup,setUnitSetup]=useState(false);
  const [trace,setTrace]=useState<ItemHistorySelection|null>(null);
  const [loading,setLoading]=useState(true),[error,setError]=useState(''),[notice,setNotice]=useState('');
  const generation=useRef(0);
  const refresh=useCallback(async()=>{
    const ticket=++generation.current;
    try {
      const result=await supabase.rpc('read_kitchen_stock');
      if(result.error)throw result.error;
      if(ticket===generation.current){setItems(kitchenOrdered(result.data.items));setError('');}
    }catch(e){if(ticket===generation.current)setError(readErrorMessage(e,'Could not load food stock.'));}
    finally{if(ticket===generation.current)setLoading(false);}
  },[]);
  useEffect(()=>{void refresh();return()=>{generation.current++;};},[refresh]);
  useSharedRefresh(refresh,{tables:['ingredient_items','ingredient_balances','ingredient_movements'],intervalMs:15000});
  const visible=items.filter(i=>i.active&&kitchenMatches(i,search));
  const categoryName=(value:string)=>value==='Food'?t('Food','Makanan'):value==='Seafood'?t('Seafood','Makanan Laut'):value==='Condiment'?t('Condiment','Bahan Perasa'):value;
  return <div className="staff-workspace kitchen-stock" data-preview={isDemoMode}>
    <KitchenHeader/>
    <div className="kitchen-actions">
      {can('purchasing.receive')?<button aria-pressed={tab==='arrivals'} onClick={()=>setTab('arrivals')}><ArrowDownToLine size={20}/><span>{t('Items Arrived','Barang Sampai')}</span></button>:null}
      {can('kitchen.production.manage')?<button aria-pressed={tab==='usage'||tab==='out'||tab==='water'} onClick={()=>setTab('usage')}><Utensils size={20}/><span>{t('Record Usage','Rekod Penggunaan')}</span></button>:null}
      {can('kitchen.stock.count')?<button aria-pressed={tab==='count'} onClick={()=>setTab('count')}><ClipboardCheck size={20}/><span>{t('Stock Check','Semak Stok')}</span></button>:null}
    </div>
    <div className="kitchen-secondary"><button aria-pressed={tab==='stock'} onClick={()=>setTab('stock')}>{t('Balances','Baki')}</button><button aria-pressed={tab==='history'} onClick={()=>setTab('history')}>{t('History','Sejarah')}</button>{can('kitchen.manage')?<button className="ml-auto" onClick={()=>setUnitSetup(true)}>{t('Unit Setup','Tetapan Unit')}</button>:null}</div>
    {notice?<p role="status" className="my-3 text-sm text-accent">{notice}</p>:null}
    {error?<p role="alert" className="my-3 text-sm text-danger">{error}<button className="ml-2 underline" onClick={()=>void refresh()}>{t('Retry','Cuba Lagi')}</button></p>:null}
    {!loading?<>
      {tab==='arrivals'&&can('purchasing.receive')?<KitchenArrivals key={params.get('resume')??''} onSaved={refresh}/>:null}
      {['usage','water','out'].includes(tab)?<nav aria-label={t('Usage Type','Jenis Penggunaan')} className="supply-segments kitchen-usage-nav">
        <button aria-pressed={tab==='usage'} onClick={()=>setTab('usage')}>{t('Guest & Staff Meals','Hidangan Tetamu & Staf')}</button>
        <button aria-pressed={tab==='water'} onClick={()=>setTab('water')}>{t('Snorkelling Water','Air Snorkelling')}</button>
        <button aria-pressed={tab==='out'} onClick={()=>setTab('out')}>{t('Waste / Other','Sisa / Lain')}</button>
      </nav>:null}
      {can('kitchen.production.manage')?<>
      <div className="kitchen-pane" hidden={tab!=='water'}><SnorkellingWater key={`${profile?.id}:${resumeSize??''}:${resumeDate??''}`} resumeDate={resumeDate} resumeSize={resumeSize} items={items} loadError={error} onSaved={refresh} active={tab==='water'}/></div>
      <div className="kitchen-pane" hidden={tab!=='usage'}><KitchenUsage key={`${profile?.id}:${resumeDate??''}`} resumeDate={resumeDate} items={items} loadError={error} onSaved={refresh} active={tab==='usage'}/></div>
      <div className="kitchen-pane" hidden={tab!=='out'}><KitchenStockOut key={profile?.id} active={tab==='out'} items={items} loadError={error} onEdit={()=>setTab('out')} onSaved={async()=>{setNotice(t('Waste / Other Confirmed','Sisa / Lain Disahkan'));await refresh();}}/></div>
      </>:null}
      {can('kitchen.stock.count')?<div hidden={tab!=='count'}><KitchenStockCount key={profile?.id} items={items} loadError={error} onEdit={()=>setTab('count')} onSaved={refresh} active={tab==='count'} onHistory={()=>setParams({view:'history',type:'count'})}/></div>:null}
    </>:null}
    {loading?<p className="py-4">{t('Loading...','Memuatkan...')}</p>:tab==='history'?<FoodStockHistory key={profile?.id} initialKind={params.get('type')==='count'?'count':'all'}/>:tab==='stock'?<>
      <label className="relative mb-3 block"><Search className="absolute left-3 top-3.5 h-4 w-4 text-muted"/><input aria-label={t('Find Food Stock','Cari Stok Makanan')} className={inputClass+' pl-9'} value={search} onChange={e=>setSearch(e.target.value)} placeholder={t('Find Food Item','Cari Item Makanan')}/></label>
      <ul className="divide-y divide-line border-y border-line">{visible.map(i=><li key={i.id} className="grid grid-cols-[minmax(0,1fr)_44px] items-center gap-3 py-2.5"><div className="min-w-0"><p className="break-words text-sm font-semibold">{kitchenName(i)}</p><p className="text-xs text-muted">{t('Balance','Baki')}: {kitchenValue(countBalance(i),i)} {kitchenUnit(i)} · {i.kitchen_group??categoryName(i.category)}</p></div><button type="button" className={secondaryButtonClass+' !w-11 !h-11 !p-0'} aria-label={t('Item History: ','Sejarah Item: ')+kitchenName(i)} title={t('Item History','Sejarah Item')} onClick={()=>setTrace({itemId:i.id,name:kitchenName(i)})}><History size={17}/></button></li>)}</ul>
      {!visible.length?<p className="py-6 text-center text-sm text-muted">{t('No Matching Food Items','Tiada Item Makanan Sepadan')}</p>:null}
    </>:null}
    {unitSetup?<KitchenUnitSetup key={profile?.id} items={items} loadError={error} onClose={()=>setUnitSetup(false)} onSaved={refresh}/>:null}
    {tab==='stock'&&trace?<FoodItemHistory selection={trace} onClose={()=>setTrace(null)}/>:null}
  </div>;
}
