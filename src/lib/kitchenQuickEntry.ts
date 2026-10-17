import { z } from 'zod';
import { addDays, format } from 'date-fns';
import { kitchenUnit, type KitchenItem } from './kitchenCatalogue';
import { measureOptions } from './kitchenMeasure';
import { usageDate } from './dailyUsageDraft';

const date=z.string().refine(usageDate),id=z.string().min(1).max(200);
const choice=z.object({base:z.enum(['g','ml','unit']),unit:z.string().min(1).max(60)}).strict();
const choices=z.record(id,choice).refine(v=>Object.keys(v).length<=1000);
export type KitchenChoices=z.infer<typeof choices>;
export type KitchenEntryScope='usage'|'arrival'|'count';
export const kitchenChoicesKey=(project:string|undefined,actor:string,scope:KitchenEntryScope='usage')=>`kitchen-${scope}-units:${project??'review'}:${actor}`;
export function readKitchenChoices(raw:string|null):KitchenChoices{return raw===null?{}:choices.parse(JSON.parse(raw));}
export function preferredMeasure(item:KitchenItem,saved:KitchenChoices):string|undefined{
 const c=saved[item.id];return c?.base===item.base_unit&&measureOptions(item).includes(c.unit)&&c.unit!==kitchenUnit(item)?c.unit:undefined;
}
export function rememberKitchenChoice(store:Pick<Storage,'getItem'|'setItem'>,key:string,item:KitchenItem,unit:string){
 if(!measureOptions(item).includes(unit))throw Error('Incompatible input unit.');
 const raw=store.getItem(key),previous=readKitchenChoices(raw),next={...previous,[item.id]:{base:item.base_unit,unit}};
 choices.parse(next);if(store.getItem(key)!==raw)throw Error('Unit preferences changed in another tab.');
 const text=JSON.stringify(next);store.setItem(key,text);if(store.getItem(key)!==text)throw Error('Unit preference not saved.');return next;
}
const row=z.object({business_date:date,lines:z.array(z.object({ingredient_id:id,name:z.string().max(500),unit:z.enum(['g','ml','unit']),guest_quantity:z.number().finite().nonnegative(),staff_quantity:z.number().finite().nonnegative()}).passthrough()).max(1000)}).passthrough();
export type RecentIngredientList={date:string;ids:string[];unavailable:string[]};
export function recentUsageRange(day:string){if(!usageDate(day))throw Error('Invalid usage date.');const d=new Date(day+'T12:00:00');return {from:format(addDays(d,-28),'yyyy-MM-dd'),to:format(addDays(d,-1),'yyyy-MM-dd')};}
export function recentIngredientList(data:unknown,day:string,items:KitchenItem[]):RecentIngredientList|null{
 const range=recentUsageRange(day),rows=z.array(row).max(28).parse(data);
 if(new Set(rows.map(r=>r.business_date)).size!==rows.length||rows.some(r=>r.business_date<range.from||r.business_date>range.to||new Set(r.lines.map(l=>l.ingredient_id)).size!==r.lines.length))throw Error('Recent usage list is incomplete or inconsistent.');
 const last=[...rows].sort((a,b)=>b.business_date.localeCompare(a.business_date)).find(r=>r.lines.some(l=>l.guest_quantity+l.staff_quantity>0));
 if(!last)return null;
 const used=last.lines.filter(l=>l.guest_quantity+l.staff_quantity>0),compatible=(l:typeof used[number])=>items.some(i=>i.id===l.ingredient_id&&i.active&&i.base_unit===l.unit&&!i.kitchen_key?.startsWith('snorkelling-mineral-water'));
 return {date:last.business_date,ids:used.filter(compatible).map(l=>l.ingredient_id),unavailable:used.filter(l=>!compatible(l)).map(l=>l.name)};
}
