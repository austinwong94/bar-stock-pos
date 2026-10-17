import { countBalance, countQuantity, type CountItem } from './stockCount';

export type MealPurpose = 'guest_meals' | 'staff_meals';
export type UsageItem = { ingredient_id: string; name: string; quantity: number; expected_base_unit: string };
export type UsageAttempt = {
  id: string; date: string; purpose: MealPurpose; meal: string; portions: number | null;
  notes: string; items: UsageItem[]; attempted: boolean; createdAt: string;
};

export function usageItems(items: CountItem[], entries: Record<string, string>): UsageItem[] {
  return Object.entries(entries).filter(([,value])=>value.trim()).map(([id,value])=>{
    const item=items.find(i=>i.id===id && i.active);
    const quantity=item ? countQuantity(value,item.base_unit) : null;
    if(!item || quantity===null || quantity<=0 || quantity>countBalance(item)) throw new Error(item?.name ?? 'Unavailable item');
    return {ingredient_id:id,name:item.name,quantity,expected_base_unit:item.base_unit};
  });
}

export function packedCount(packs: string, loose: string, packSize: number, unit: string): number | null {
  if(!packs.trim() && !loose.trim())return null;
  if(packs.trim() && !/^\d+$/.test(packs.trim()))return null;
  const remainder=loose.trim()?countQuantity(loose,unit):0;
  const total=Number(packs||0)*packSize+(remainder??0);
  if(remainder===null || !Number.isFinite(packSize) || packSize<=0 || !Number.isFinite(total) || total>1e9 || (unit==='unit' && !Number.isInteger(total)))return null;
  return Math.round(total*100)/100;
}

export function readUsageAttempt(storage: Pick<Storage,'getItem'>, key: string): UsageAttempt | null {
  const raw=storage.getItem(key);if(!raw)return null;
  const a=JSON.parse(raw);
  if(!a || typeof a.id!=='string' || !/^\d{4}-\d{2}-\d{2}$/.test(a.date) || !['guest_meals','staff_meals'].includes(a.purpose)
    || typeof a.meal!=='string' || typeof a.notes!=='string' || typeof a.attempted!=='boolean'
    || (a.portions!==null && (!Number.isInteger(a.portions)||a.portions<=0))
    || !Array.isArray(a.items) || !a.items.length || a.items.length>200
    || a.items.some((i:UsageItem)=>!i || typeof i.name!=='string' || typeof i.ingredient_id!=='string' || !['g','ml','unit'].includes(i.expected_base_unit) || !Number.isFinite(i.quantity)||i.quantity<=0))
    throw new Error('A pending usage record could not be read. Ask a manager to check history before submitting again.');
  return a;
}

export function storeUsageAttempt(storage: Pick<Storage,'getItem'|'setItem'>,key:string,attempt:UsageAttempt) {
  const previous=readUsageAttempt(storage,key);
  if(previous && JSON.stringify({...previous,attempted:false})!==JSON.stringify({...attempt,attempted:false}))throw new Error('Check the pending usage record first.');
  const value=JSON.stringify(attempt);storage.setItem(key,value);
  if(storage.getItem(key)!==value)throw new Error('Device storage is unavailable. Nothing was submitted.');
}
