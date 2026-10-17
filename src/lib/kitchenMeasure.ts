import { kitchenFactor, kitchenQuantity, kitchenUnit, type KitchenItem } from './kitchenCatalogue';
import { baseToSize, sizeToBase, type SizeUnit } from './kitchenUnitBatch';

export function measureOptions(item:KitchenItem){
 return item.base_unit==='g'?[...new Set([kitchenUnit(item),'kg','g'])]:item.base_unit==='ml'?[...new Set([kitchenUnit(item),'L','ml'])]:[];
}
export function validMeasure(unit:unknown,base:string){return unit===undefined||typeof unit==='string'&&(base==='g'?['kg','g'].includes(unit):base==='ml'?['L','ml'].includes(unit):false);}
export function entryQuantity(value:string,item:KitchenItem,measure?:string):number|null{
 if(!measure)return kitchenQuantity(value,item);
 const base=sizeToBase(value,measure as SizeUnit,item.base_unit);
 return base===null||(base.split('.')[1]?.length??0)>2?null:Number(base);
}
export function entryValue(base:number,item:KitchenItem,measure?:string):string|null{
 if(measure)return baseToSize(String(base),measure as SizeUnit,item.base_unit);
 const value=String(base/kitchenFactor(item));return kitchenQuantity(value,item)===base?value:null;
}
export function entryDisplay(base:number,item:KitchenItem,measure?:string){
 if(!measure&&!kitchenFactor(item))return '?';
 return (base/(measure?(['kg','L'].includes(measure)?1000:1):kitchenFactor(item))).toLocaleString('en-MY',{maximumFractionDigits:6});
}
export function measuredPackedCount(packs:string,loose:string,packSize:number,item:KitchenItem,measure:string):number|null{
 if(!packs.trim()&&!loose.trim()||packs.trim()&&!/^\d+$/.test(packs.trim()))return null;
 const remainder=entryQuantity(loose||'0',item,measure);
 if(remainder===null||!Number.isFinite(packSize)||packSize<=0||Math.abs(packSize*100-Math.round(packSize*100))>1e-7)return null;
 // The stock ledger stores hundredths; add whole integer hundredths without float drift.
 const total=Number(packs||0)*Math.round(packSize*100)+Math.round(remainder*100);
 return Number.isSafeInteger(total)&&total>=0&&total<=1e11?total/100:null;
}
export function changeMeasure(value:string,item:KitchenItem,from:string|undefined,to:string):{value:string;measure?:string}|null{
 const measure=to===kitchenUnit(item)?undefined:to;
 if(!validMeasure(measure,item.base_unit))return null;
 if(!value.trim())return {value,measure};
 const base=entryQuantity(value,item,from);if(base===null)return null;
 const next=entryValue(base,item,measure);return next===null?null:{value:next,measure};
}
