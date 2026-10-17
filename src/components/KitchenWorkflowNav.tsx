import { NavLink } from 'react-router-dom';
import { BarChart3, ClipboardList, PackageMinus, ShoppingBasket } from 'lucide-react';
import { useAccess } from '../lib/access';
import { useLanguage } from '../lib/language';

export function KitchenWorkflowNav() {
  const {can}=useAccess(); const {text:t}=useLanguage();
  return <nav aria-label="Kitchen Sections" className="kitchen-workflow-nav">
    {[
      {to:'/kitchen/stock',label:t('Kitchen Stock','Stok Dapur'),short:t('Stock','Stok'),icon:PackageMinus,show:can('kitchen.production.manage')||can('purchasing.receive')||can('kitchen.stock.count')},
      {to:'/kitchen',label:t('Purchase Requests','Permintaan Belian'),short:t('Requests','Pesanan'),icon:ClipboardList,show:can('kitchen.request.view')||can('kitchen.request.create')},
      {to:'/kitchen/purchases',label:t('Purchases','Pembelian'),short:t('To Buy','Belian'),icon:ShoppingBasket,show:can('purchasing.view')||can('purchasing.fulfil')},
      {to:'/kitchen/finance',label:t('Finance','Kewangan'),short:t('Finance','Kewangan'),icon:BarChart3,show:can('purchasing.cost.view')},
    ].filter(item=>item.show).map(item=><NavLink key={item.to} to={item.to} end aria-label={item.label} className={({isActive})=>isActive?'current':''}><item.icon className="hidden h-4 w-4 shrink-0 sm:block" /><span className="sm:hidden">{item.short}</span><span className="hidden sm:inline">{item.label}</span></NavLink>)}
  </nav>;
}
