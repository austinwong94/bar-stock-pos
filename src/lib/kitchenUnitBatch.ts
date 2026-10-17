import { z } from 'zod';
import { kitchenName, kitchenUnit, type KitchenItem } from './kitchenCatalogue';

export const entryUnits=['biji','ekor','pcs','pack','bag','gelen','tin','botol','kg','g','L','ml'] as const;
const stamp=z.string().refine(v=>Number.isFinite(Date.parse(v)));
const lineSchema=z.object({id:z.string().min(1),name:z.string(),base:z.enum(['unit','g','ml']),unit:z.enum(entryUnits),factor:z.string(),carton:z.string(),water:z.boolean(),expected:stamp,size_unit:z.enum(['kg','g','L','ml']).optional(),size_value:z.string().max(40).optional()}).strict();
export type UnitLine=z.infer<typeof lineSchema>;
export type SizeUnit='kg'|'g'|'L'|'ml';
function decimal(value:string){
 const v=value.trim();if(v.length>40||! /^(?:\d+(?:\.\d*)?|\.\d+)$/.test(v))return null;
 const [whole,fraction='']=v.split('.');return {digits:BigInt((whole||'0')+fraction),scale:fraction.length};
}
function decimalText(digits:bigint,scale:number){
 const text=digits.toString().padStart(scale+1,'0');return scale?(text.slice(0,-scale)+'.'+text.slice(-scale)).replace(/\.?0+$/,''):text;
}
export function sizeToBase(value:string,unit:SizeUnit,base:string):string|null{
 if(base==='g'&&!['kg','g'].includes(unit)||base==='ml'&&!['L','ml'].includes(unit)||!['g','ml'].includes(base))return null;
 const d=decimal(value);if(!d)return null;
 const factor=decimalText(d.digits*(['kg','L'].includes(unit)?1000n:1n),d.scale);
 if((factor.split('.')[1]?.length??0)>6||Number(factor)>1e9)return null;return factor;
}
export function baseToSize(value:string,unit:SizeUnit,base:string):string|null{
 if(base==='g'&&!['kg','g'].includes(unit)||base==='ml'&&!['L','ml'].includes(unit)||!['g','ml'].includes(base))return null;
 const d=decimal(value);return d?decimalText(d.digits,d.scale+(['kg','L'].includes(unit)?3:0)):null;
}
export function sizeInput(line:UnitLine){
 const unit:SizeUnit=line.size_unit??(line.base==='g'?'kg':'L');
 return {unit,value:line.size_value??baseToSize(line.factor,unit,line.base)??''};
}
export function editSize(line:UnitLine,value:string,unit:SizeUnit):Partial<UnitLine>{return {size_unit:unit,size_value:value,factor:sizeToBase(value,unit,line.base)??''};}
export function switchSizeUnit(line:UnitLine,unit:SizeUnit):Partial<UnitLine>{
 const current=sizeInput(line),factor=sizeToBase(current.value,current.unit,line.base);
 return editSize(line,factor===null?current.value:baseToSize(factor,unit,line.base)!,unit);
}
export function unitSizeCopy(base:string,unit:string,language:'en'|'ms',water=false){
 const ms=language==='ms',names:Record<string,[string,string]>={pack:['pack','pek'],bag:['bag','beg'],gelen:['container','bekas'],tin:['tin','tin'],botol:['bottle','botol'],biji:['piece','biji'],ekor:['piece','ekor'],pcs:['piece','biji']};
 const name=names[unit]?.[ms?1:0]??unit;
 const fixed=base==='g'&&['kg','g'].includes(unit)?(unit==='kg'?1000:1):base==='ml'&&['L','ml'].includes(unit)?(unit==='L'?1000:1):base==='unit'&&(['biji','ekor','pcs'].includes(unit)||water&&unit==='botol')?1:null;
 const measure=base==='g'?'g':base==='ml'?'ml':ms?'item dikira':fixed===1?'counted item':'counted items';
 const label=base==='g'?(ms?`Berat 1 ${name}`:`Weight of 1 ${name}`):base==='ml'?(ms?`Isipadu 1 ${name}`:`Volume of 1 ${name}`):(ms?`Bilangan item dalam 1 ${name}`:`Items Counted in 1 ${name}`);
 const tracking=base==='g'?(ms?'Stok mengikut berat':'Tracked by Weight'):base==='ml'?(ms?'Stok mengikut isipadu':'Tracked by Volume'):(ms?'Stok mengikut bilangan, bukan berat':'Tracked by Count, Not Weight');
 const hint=fixed!==null?(ms?`Penukaran tetap: 1 ${name} = ${fixed} ${measure}. Tidak perlu mengira.`:`Fixed conversion: 1 ${name} = ${fixed} ${measure}. No calculation needed.`):base==='g'?(ms?`Isi berat pada label satu ${name}. Pilih kg atau g.`:`Enter the labelled weight of one ${name}. Choose kg or g.`):base==='ml'?(ms?`Isi isipadu pada label satu ${name}. Pilih L atau ml.`:`Enter the labelled volume of one ${name}. Choose L or ml.`):(ms?'Jika satu pek/beg/bekas penuh dikira sebagai satu item stok, isi 1. Jika item di dalam dikira berasingan, isi bilangannya. Jangan isi kg atau gram di sini.':'If one whole pack/bag/container is one inventory item, enter 1. If its contents are counted separately, enter their count. Do not enter kg or grams here.');
 const rowHint=fixed!==null?(ms?`Automatik: 1 ${name} = ${fixed} ${measure}.`:`Automatic: 1 ${name} = ${fixed} ${measure}.`):base==='g'?(ms?'Berat satu pek, bukan jumlah semua pek.':'Weight of one pack, not all packs.'):base==='ml'?(ms?'Isipadu satu bekas, bukan jumlah semua bekas.':'Volume of one container, not all containers.'):(ms?'Stok pek penuh: 1. Item berasingan: bilangannya.':'Whole-pack stock: 1. Separate items: their count.');
 return {label,tracking,hint,rowHint,fixed,placeholder:base==='g'?'5':base==='ml'?'2':ms?'Bilangan item':'Item count',measure,name};
}
export function unitSizeSummary(line:UnitLine,language:'en'|'ms'){
 const c=unitSizeCopy(line.base,line.unit,language,line.water),quantity=Number(line.factor).toLocaleString(language==='ms'?'ms-MY':'en-MY',{maximumFractionDigits:6});
 const measure=line.base==='unit'&&Number(line.factor)===1&&language==='en'?'counted item':c.measure;
 if(line.base!=='unit'&&c.fixed===null){const s=sizeInput(line);return `1 ${c.name} = ${s.value} ${s.unit} (${quantity} ${measure})`;}
 return `1 ${c.name} = ${quantity} ${measure}`;
}
const changeSchema=z.object({id:z.string().min(1),unit:z.enum(entryUnits),factor:z.number().positive().max(1e9),expected_updated_at:stamp,carton_size:z.number().int().min(1).max(10000).nullable()}).strict();
const attemptSchema=z.object({id:z.string().uuid(),created_at:stamp,lines:z.array(changeSchema).min(1).max(200)}).strict();
const draftSchema=z.object({version:z.literal(1),lines:z.array(lineSchema).max(200),attempt:attemptSchema.nullable()}).strict();
export type UnitAttempt=z.infer<typeof attemptSchema>;
export type UnitDraft=z.infer<typeof draftSchema>;
export const unitBatchKey=(project:string|undefined,actor:string)=>`kitchen-units:${project??'review'}:${actor}`;
export function unitLine(item:KitchenItem):UnitLine{return {id:item.id,name:kitchenName(item),base:item.base_unit as UnitLine['base'],unit:kitchenUnit(item) as UnitLine['unit'],factor:item.kitchen_factor==null?'':String(item.kitchen_factor),carton:'',water:!!item.kitchen_key?.startsWith('snorkelling-mineral-water'),expected:item.updated_at};}
export function validUnit(base:string,unit:string,factor:number,water=false){
 if(!entryUnits.includes(unit as typeof entryUnits[number])||!Number.isFinite(factor)||factor<=0||factor>1e9||base==='unit'&&!Number.isInteger(factor))return false;
 if(water)return unit==='botol'&&factor===1;
 if(['biji','ekor','pcs'].includes(unit))return base==='unit'&&factor===1;
 if(unit==='kg'||unit==='g')return base==='g'&&factor===(unit==='kg'?1000:1);
 if(unit==='L'||unit==='ml')return base==='ml'&&factor===(unit==='L'?1000:1);
 return true;
}
export function stockUnit(line:UnitLine):UnitLine{return {...line,size_unit:undefined,size_value:undefined,unit:line.water?'botol':line.base==='g'?'kg':line.base==='ml'?'L':['biji','ekor','pcs','botol'].includes(line.unit)?line.unit:'pcs',factor:line.base==='unit'?'1':'1000'};}
export function unitChanges(lines:UnitLine[]){
 if(!lines.length||lines.length>200||new Set(lines.map(l=>l.id)).size!==lines.length)throw Error('Choose 1-200 different items.');
 return lines.map(line=>{lineSchema.parse(line);if((line.size_unit!==undefined||line.size_value!==undefined)&&(line.size_unit===undefined||line.size_value===undefined||sizeToBase(line.size_value,line.size_unit,line.base)!==line.factor))throw Error(line.name+': entered size does not match the conversion.');if(!/^\d+(\.\d{1,6})?$/.test(line.factor.trim())||!validUnit(line.base,line.unit,Number(line.factor),line.water))throw Error(line.name+': check the unit and actual labelled size.');
  if(line.carton&&(!line.water||!/^\d+$/.test(line.carton)||Number(line.carton)<1||Number(line.carton)>10000))throw Error(line.name+': check bottles per carton.');
  return changeSchema.parse({id:line.id,unit:line.unit,factor:Number(line.factor),expected_updated_at:line.expected,carton_size:line.carton?Number(line.carton):null});
 });
}
export function readUnitDraft(raw:string|null):UnitDraft{
 if(raw===null)return {version:1,lines:[],attempt:null};
 try{const d=draftSchema.parse(JSON.parse(raw));if(new Set(d.lines.map(l=>l.id)).size!==d.lines.length)throw Error();for(const l of d.lines){if((l.size_unit!==undefined||l.size_value!==undefined)&&(l.size_unit===undefined||l.size_value===undefined||l.base==='unit'||l.base==='g'&&!['kg','g'].includes(l.size_unit)||l.base==='ml'&&!['L','ml'].includes(l.size_unit)||(sizeToBase(l.size_value,l.size_unit,l.base)??'')!==l.factor))throw Error();}if(d.attempt&&JSON.stringify(unitChanges(d.lines))!==JSON.stringify(d.attempt.lines))throw Error();return d;}catch{throw Error('Saved unit setup could not be read. Keep this device and ask a manager.');}
}
export function writeUnitDraft(storage:Pick<Storage,'getItem'|'setItem'|'removeItem'>,key:string,draft:UnitDraft,expected:string|null){
 if(storage.getItem(key)!==expected)throw Error('Unit setup changed in another tab. Reopen Unit Setup.');
 const raw=draft.lines.length?JSON.stringify(draft):null;if(raw){readUnitDraft(raw);storage.setItem(key,raw);}else storage.removeItem(key);
 if(storage.getItem(key)!==raw)throw Error('Unit setup could not be saved on this device. Nothing new was sent.');return raw;
}
export function verifyUnitBatch(data:unknown,attempt:UnitAttempt,actor:string){
 const d=z.object({operation_id:z.string(),actor_id:z.string(),items:z.array(z.object({id:z.string(),kitchen_unit:z.string(),kitchen_factor:z.number(),updated_at:stamp,default_pack_size:z.number().optional(),pack_label:z.string().nullish()}).passthrough())}).parse(data);
 if(d.operation_id!==attempt.id||d.actor_id!==actor||d.items.length!==attempt.lines.length||new Set(d.items.map(r=>r.id)).size!==d.items.length)throw Error('Unit confirmation is uncertain. Check the same save.');
 for(const l of attempt.lines){const r=d.items.find(r=>r.id===l.id);if(!r||r.kitchen_unit!==l.unit||r.kitchen_factor!==l.factor||(l.carton_size!==null&&(r.default_pack_size!==l.carton_size||r.pack_label!=='Carton')))throw Error('Unit confirmation does not match the reviewed setup.');}
 return d;
}
