import { useState } from 'react';
import { Bell } from 'lucide-react';
import { KitchenHeader } from '../../components/KitchenHeader';
import { secondaryButtonClass } from '../../components/Form';
import { useAccess } from '../../lib/access';
import { useLanguage } from '../../lib/language';
import CostMonitor from './CostMonitor';
import SupplyAlerts from './SupplyAlerts';

export default function FinanceWorkspace(){
  const {can,profile}=useAccess(),{text:t}=useLanguage(),[alerts,setAlerts]=useState(false);
  return <div className="supply-workspace"><KitchenHeader/><CostMonitor key={profile?.id} actions={can('platform.settings.manage')?<button className={secondaryButtonClass} onClick={()=>setAlerts(true)}><Bell size={16}/>{t('Group Alerts','Makluman Kumpulan')}</button>:null}/>{alerts?<SupplyAlerts onClose={()=>setAlerts(false)}/>:null}</div>;
}
