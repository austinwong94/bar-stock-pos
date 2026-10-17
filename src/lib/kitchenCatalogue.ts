import type { IngredientWithBalance } from './types';
import { countBalance, countQuantity } from './stockCount';

export type KitchenGroup = 'Bahan Mentah' | 'Bahan Kering' | 'Frozen' | 'Keperluan Dapur' | 'Snorkelling';
export type KitchenScope = 'guest' | 'staff' | 'water';
export type KitchenProfile = { kitchen_key?: string; kitchen_label?: string; kitchen_group?: KitchenGroup; kitchen_unit?: string; kitchen_factor?: number | null; kitchen_scopes?: KitchenScope[]; kitchen_order?: number };
export type KitchenItem = IngredientWithBalance & KitchenProfile;
type Definition = { key: string; name: string; aliases: string[]; group: KitchenGroup; unit: string; orderUnit: string; scopes: KitchenScope[] };
const definitions: [string,string,string,string?,string?][] = [
  ['Timun','biji','Cucumber'],['Jagung','biji','Corn'],['Tomato','biji','Tomato,Tomatoes'],['Carrot','biji','Lobak,Carrot'],
  ['Cili Besar','kg','Large Chilli'],['Cili Merah','biji','Red Chilli'],['Nenas','pack','Pineapple'],
  ['Bawang Besar','bag','Onion,Onions'],['Bawang Putih','biji','Garlic','bag'],['Bawang Bombay','biji','Bombay Onion','bag'],['Bawang Holland','biji','Holland Onion','bag'],['Kentang','bag','Potato'],
  ['Labu Kuning','biji','Pumpkin',undefined,'staff'],['Kubis','biji','Cabbage',undefined,'staff'],
  ['Beras','pack','Rice'],['Telur','biji','Egg,Eggs'],['Gula','pack','Sugar'],['Minyak Masak','gelen','Cooking Oil'],
  ['Tepung Gandum','pack','Wheat Flour'],['Tepung Jagung','pack','Corn Flour'],['Garam','pack','Salt'],['Ajinomoto','pack','Ajinamoto'],
  ['Sos Cili','gelen','Chilli Sauce'],['Sos Tomato','gelen','Tomato Sauce'],['Sos Tiram','gelen','Oyster Sauce'],['Cuka','gelen','Vinegar'],
  ['Black Pepper','pack','Black Pepper'],['Mushroom','tin','Mushroom'],['Laici Tin','tin','Laici,Canned Lychee'],['Syrup Laici','botol','Lychee Syrup'],
  ['Keropok Ikan','pack','Fish Crackers'],['Serbuk Kari','pack','Curry Powder'],['Maggi Kari','pack','Meggi Kari',undefined,'staff'],['Mihun','pack','Bihun',undefined,'staff'],['Kopiko','pack','Kopiko',undefined,'staff'],['Susu Cair','tin','Evaporated Milk',undefined,'staff'],
  ['Sayap','pack','Chicken Wings,Wings'],['Udang','pack','Prawn,Prawns'],['Sotong','pack','Squid'],['Ikan','pack','Fish'],['Ketam','ekor','Crab,Crabs','kg'],['Ais','pack','Ice'],['Ayam Bulat','ekor','Whole Chicken,Ayam',undefined,'staff'],
  ['Plastik Sampah','pack','Plstik Sampah,Garbage Bags'],['Baking Paper Pink','pack','Pink Baking Paper'],['Cooking Gas','kg','Gas Memasak,LPG'],
  ['Snorkelling Mineral Water','botol','Snorkeling Mineral Water','carton','water'],
];
export const kitchenCatalogue: Definition[] = definitions.map(([name,unit,aliases,orderUnit,scope],index)=>({
  key:name.toLowerCase().replace(/[^a-z0-9]+/g,'-'), name, aliases:[name,...aliases.split(',')], unit, orderUnit:orderUnit??unit,
  group:index<14?'Bahan Mentah':index<36?'Bahan Kering':index<43?'Frozen':index<46?'Keperluan Dapur':'Snorkelling',
  scopes:scope==='staff'?['staff']:scope==='water'?['water']:['guest','staff'],
}));
export const waterVariants=[{key:'snorkelling-mineral-water-500ml',label:'500 ml'},{key:'snorkelling-mineral-water-230ml',label:'230 ml'},{key:'snorkelling-mineral-water',label:'Size Unspecified'}];
for(const v of waterVariants.filter(v=>v.key!=='snorkelling-mineral-water'))kitchenCatalogue.push({key:v.key,name:'Mineral Water '+v.label,aliases:['Mineral Water '+v.label],group:'Snorkelling',unit:'botol',orderUnit:'carton',scopes:['water']});
export const kitchenGroups: KitchenGroup[] = ['Bahan Mentah','Bahan Kering','Frozen','Keperluan Dapur','Snorkelling'];
export const kitchenGroupEnglish: Record<KitchenGroup,string> = {'Bahan Mentah':'Fresh Ingredients','Bahan Kering':'Dry Goods',Frozen:'Frozen','Keperluan Dapur':'Kitchen Supplies',Snorkelling:'Snorkelling'};
export const kitchenName=(item:KitchenItem)=>item.kitchen_label||item.name;
export const kitchenFactor=(item:KitchenItem|undefined)=>!item?0:item.kitchen_key ? Number(item.kitchen_factor)||0 : item.base_unit==='g'?1000:1;
export const kitchenUnit=(item:KitchenItem)=>item.kitchen_key ? item.kitchen_unit||'unit' : item.base_unit==='g'?'kg':item.base_unit==='unit'?'pcs':item.base_unit;
export const kitchenFractional=(item:KitchenItem)=>!!item.kitchen_key && item.base_unit==='unit' && kitchenFactor(item)===1 && ['pack','bag','gelen','tin'].includes(item.kitchen_unit??'');
export const kitchenAmount=(base:number,item:KitchenItem)=>kitchenFactor(item)?base/kitchenFactor(item):null;
export const kitchenBalance=(item:KitchenItem)=>kitchenAmount(countBalance(item),item);
export const kitchenValue=(base:number,item:KitchenItem)=>kitchenAmount(base,item)?.toLocaleString('en-MY',{maximumFractionDigits:3})??'?';
export function kitchenQuantity(input:string,item:KitchenItem):number|null {
  if(!/^\d+(\.\d{1,3})?$/.test(input.trim())||!kitchenFactor(item))return null;
  const base=Number(input)*kitchenFactor(item);
  if(!Number.isFinite(base)||base<0||base>1e9||(item.base_unit==='unit'&&!Number.isInteger(base)&&!kitchenFractional(item)))return null;
  if(kitchenFractional(item))return Math.abs(base*100-Math.round(base*100))<1e-7?Math.round(base*100)/100:null;
  return countQuantity(String(base/(item.base_unit==='g'?1000:1)),item.base_unit);
}
export function kitchenOrdered<T extends KitchenItem>(items:T[]):T[]{return [...items].sort((a,b)=>(a.kitchen_order??999)-(b.kitchen_order??999)||a.name.localeCompare(b.name));}
export const kitchenMatches=(item:KitchenItem,query:string)=>[item.name,item.kitchen_label,...(kitchenCatalogue.find(d=>d.key===item.kitchen_key)?.aliases??[])].join(' ').toLowerCase().includes(query.trim().toLowerCase());
export function dailyWaterDifference(previous:number,received:number,used:number,counted:number){return counted-(previous+received-used);}
