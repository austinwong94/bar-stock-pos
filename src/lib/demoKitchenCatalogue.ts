import { db, can, require as requirePermission, currentUserIdRef } from './demoBackend';
import { adjustLocalIngredientStock, loadLocalIngredientItems, loadLocalIngredientMovements, saveLocalIngredientItem, stockInLocalIngredient, withLocalIngredientRollback } from './localStore';
import { kitchenCatalogue, kitchenQuantity, kitchenUnit, waterVariants } from './kitchenCatalogue';
import { entryQuantity } from './kitchenMeasure';
import { malaysiaDateInputValue } from './format';
const fail=(message:string,code='P0001'):never=>{throw {message,code};};
const actor=()=>currentUserIdRef.value!;
const actorName=()=>db.profiles.find(p=>p.id===actor())?.full_name??'Staff';
const validDate=(v:string)=>/^\d{4}-\d{2}-\d{2}$/.test(v)&&!Number.isNaN(Date.parse(v+'T00:00:00Z'))&&new Date(v+'T00:00:00Z').toISOString().slice(0,10)===v;
const today=()=>malaysiaDateInputValue(new Date());
const audit=(action:string,id:string,before:unknown,after:unknown)=>db.audit_logs.push({id:crypto.randomUUID(),actor_id:actor(),action,entity_type:'kitchen',entity_id:id,before_json:before,after_json:structuredClone(after),created_at:new Date().toISOString()});
function attempt(operation:string,id:string,payload:unknown){db.operation_requests??=[];const hash=JSON.stringify(payload),old=db.operation_requests.find(r=>r.actor_id===actor()&&r.operation===operation&&r.request_id===id);if(old&&old.payload_hash!==hash)fail('This submission already has different details.');return {old,save:(result_id:string)=>db.operation_requests.push({actor_id:actor(),operation,request_id:id,payload_hash:hash,result_id})};}
export function ensureKitchenCatalogue(){
  if(db.whatsapp_catalogue_version?.length){ensureWaterVariants();return;}
  kitchenCatalogue.forEach((d,index)=>{
    const existing=loadLocalIngredientItems(true).filter(i=>d.aliases.some(a=>a.toLowerCase()===i.name.toLowerCase()));
    if(existing.length>1)return;
    const old=existing[0],base=d.unit==='kg'?'g':'unit',factor=old?(old.base_unit===base&&(base==='g'||['biji','ekor'].includes(d.unit))?(base==='g'?1000:1):null):(base==='g'?1000:1);
    saveLocalIngredientItem({...old,name:old?.name??d.name,category:old?.category??(d.group==='Frozen'?'Seafood':'Food'),base_unit:old?.base_unit??base,kitchen_key:d.key,kitchen_label:d.name,kitchen_group:d.group,kitchen_unit:d.unit,kitchen_factor:factor,kitchen_scopes:d.scopes,kitchen_order:index});
    const catalogue=db.catalogue_items.find(c=>d.aliases.some(a=>a.toLowerCase()===c.name.toLowerCase()));
    if(catalogue)Object.assign(catalogue,{name:d.name,category:d.group,unit:d.orderUnit});
    else db.catalogue_items.push({id:crypto.randomUUID(),kind:'ingredient',name:d.name,category:d.group,unit:d.orderUnit,default_quantity:null,times_used:0,active:true});
  });
  db.whatsapp_catalogue_version=[{version:1}];db.kitchen_arrivals??=[];db.kitchen_water_usage??=[];
  ensureWaterVariants();
}
function ensureWaterVariants(){
  for(const [index,v] of waterVariants.entries()){
    const old=loadLocalIngredientItems(true).find(i=>i.kitchen_key===v.key);
    if(v.key==='snorkelling-mineral-water'){
      if(old&&old.kitchen_label==='Snorkelling Mineral Water')saveLocalIngredientItem({...old,kitchen_label:'Mineral Water (Size Unspecified)'});
    }else if(!old)saveLocalIngredientItem({name:'Mineral Water '+v.label,category:'Food',base_unit:'unit',kitchen_key:v.key,kitchen_label:'Mineral Water '+v.label,kitchen_group:'Snorkelling',kitchen_unit:'botol',kitchen_factor:1,kitchen_scopes:['water'],kitchen_order:47+index});
    if(!db.catalogue_items.some(c=>c.name==='Mineral Water '+v.label)&&v.key!=='snorkelling-mineral-water')db.catalogue_items.push({id:crypto.randomUUID(),kind:'ingredient',name:'Mineral Water '+v.label,category:'Snorkelling',unit:'carton',active:true});
  }
}
export const demoKitchenCatalogueHandlers:Record<string,(a:any)=>any>={
  read_kitchen_stock:()=>{
    if(!can('kitchen.production.manage')&&!can('purchasing.receive')&&!can('kitchen.stock.count'))fail('Kitchen access required.','42501');
    const all=loadLocalIngredientItems(true).filter(i=>['Food','Seafood','Condiment'].includes(i.category));const movements=loadLocalIngredientMovements();
    return {items:all.map(({cost_per_base_unit,...i})=>({...i,balance_version:i.updated_at,last_count_at:movements.find(m=>m.ingredient_id===i.id&&m.movement_type==='count')?.created_at??null})),movements:movements.filter(m=>all.some(i=>i.id===m.ingredient_id)).slice(0,200)};
  },
  save_kitchen_unit:({p_id,p_unit,p_factor,p_expected_updated_at,p_carton_size})=>{
    requirePermission('kitchen.manage');const i=loadLocalIngredientItems(true).find(i=>i.id===p_id);if(!i)fail('Item unavailable.');
    if(i!.updated_at!==p_expected_updated_at)fail('Item changed. Reopen unit setup.','40001');
    if(!['biji','ekor','pack','bag','gelen','tin','botol','kg','g','ml','L','pcs'].includes(p_unit)||!Number.isFinite(p_factor)||p_factor<=0||p_factor>1e9||(i!.base_unit==='unit'&&!Number.isInteger(p_factor)))fail('Check the unit conversion.');
    if((p_unit==='kg'&&(i!.base_unit!=='g'||p_factor!==1000))||(p_unit==='g'&&(i!.base_unit!=='g'||p_factor!==1))||(p_unit==='L'&&(i!.base_unit!=='ml'||p_factor!==1000))||(p_unit==='ml'&&(i!.base_unit!=='ml'||p_factor!==1))||(['biji','ekor','pcs'].includes(p_unit)&&(i!.base_unit!=='unit'||p_factor!==1)))fail('Check the unit conversion.');
    if(i!.kitchen_key?.startsWith('snorkelling-mineral-water')&&(p_unit!=='botol'||p_factor!==1))fail('Water stock stays in individual bottles. Set bottles per carton separately.');
    if(p_carton_size&&!i!.kitchen_key?.startsWith('snorkelling-mineral-water'))fail('Carton size is for water only.');
    if(p_carton_size!==null&&(!Number.isInteger(p_carton_size)||p_carton_size<1||p_carton_size>10000))fail('Enter bottles per carton.');
    const saved=saveLocalIngredientItem({...i!,kitchen_unit:p_unit,kitchen_factor:p_factor,...(p_carton_size?{default_pack_size:p_carton_size,pack_label:'Carton'}:{})});audit('kitchen_unit_setup',p_id,i,saved);return saved;
  },
  save_kitchen_units:({p_operation_id,p_lines})=>{
    requirePermission('kitchen.manage');db.operation_requests??=[];
    if(!p_operation_id||!Array.isArray(p_lines)||!p_lines.length||p_lines.length>200||new Set(p_lines.map((l:any)=>l.id)).size!==p_lines.length)fail('Choose 1-200 different items.');
    const payload=JSON.stringify(p_lines),old=db.operation_requests.find(r=>r.actor_id===actor()&&r.operation==='kitchen_units'&&r.request_id===p_operation_id);
    if(old){if(old.payload!==payload)fail('This unit save already has different details.');return structuredClone(old.result);}
    const auditCount=db.audit_logs.length;
    try{const items=withLocalIngredientRollback(()=>[...p_lines].sort((a,b)=>a.id.localeCompare(b.id)).map(l=>{
      if(!l.expected_updated_at||Object.keys(l).some(k=>!['id','unit','factor','expected_updated_at','carton_size'].includes(k)))fail('Invalid unit setting.');
      return demoKitchenCatalogueHandlers.save_kitchen_unit({p_id:l.id,p_unit:l.unit,p_factor:l.factor,p_expected_updated_at:l.expected_updated_at,p_carton_size:l.carton_size});
    }));const result={operation_id:p_operation_id,actor_id:actor(),items};db.operation_requests.push({actor_id:actor(),operation:'kitchen_units',request_id:p_operation_id,payload,result:structuredClone(result)});return result;
    }catch(e){db.audit_logs.length=auditCount;throw e;}
  },
  record_kitchen_arrival:({p_record:r,p_operation_id})=>{
    requirePermission('purchasing.receive');db.kitchen_arrivals??=[];const op=attempt('kitchen_arrival',p_operation_id,r);if(op.old)return db.kitchen_arrivals.find(x=>x.id===op.old!.result_id);
    if(!validDate(r.date)||r.date>today()||!r.supplier?.trim()||!Array.isArray(r.lines)||!r.lines.length||r.lines.length>200||new Set(r.lines.map((l:any)=>l.ingredient_id)).size!==r.lines.length)fail('Check supplier, date and delivered items.');
    const items=loadLocalIngredientItems();for(const l of r.lines){const i=items.find(i=>i.id===l.ingredient_id);if(!i||i.base_unit!==l.unit||i.updated_at!==l.expected_version)fail('Stock changed. Refresh this delivery.','40001');if(entryQuantity(String(l.entered_quantity),i!,l.display_unit!==kitchenUnit(i!)?l.display_unit:undefined)!==l.quantity||l.quantity<=0)fail('Check quantities and units.');}
    const record={...structuredClone(r),id:crypto.randomUUID(),created_by:actor(),created_by_name:actorName(),created_at:new Date().toISOString()};
    withLocalIngredientRollback(()=>{for(const l of r.lines)stockInLocalIngredient({ingredientId:l.ingredient_id,inputQuantity:l.quantity,unitType:'base',enteredBy:actorName(),notes:`Delivery ${record.id} | ${r.date} | ${r.supplier} | ${r.reference??''}`});});
    db.kitchen_arrivals.push(record);op.save(record.id);audit('kitchen_arrival',record.id,null,record);return record;
  },
  read_kitchen_arrivals:({p_from,p_to})=>{requirePermission('purchasing.receive');return (db.kitchen_arrivals??[]).filter(r=>r.date>=p_from&&r.date<=p_to);},
  read_kitchen_water_usage:({p_from,p_to})=>{if(!can('kitchen.production.manage')&&!can('purchasing.cost.view'))fail('Access denied.','42501');return (db.kitchen_water_usage??[]).filter(r=>r.business_date>=p_from&&r.business_date<=p_to);},
  save_kitchen_water_usage:({p_record:r,p_expected_updated_at,p_operation_id})=>{
    requirePermission('kitchen.production.manage');db.kitchen_water_usage??=[];const op=attempt('kitchen_water_usage',p_operation_id,[r,p_expected_updated_at]);if(op.old)return db.kitchen_water_usage.find(x=>x.id===op.old!.result_id);
    const waterKey=r.water_key??'snorkelling-mineral-water';if(!waterVariants.some(v=>v.key===waterKey))fail('Choose a water bottle size.');
    const old=db.kitchen_water_usage.find(x=>x.business_date===r.business_date&&(x.water_key??'snorkelling-mineral-water')===waterKey),i=loadLocalIngredientItems().find(i=>i.kitchen_key===waterKey);
    if(!i||i.base_unit!=='unit')fail('Set up water in bottles first.');
    if((old?.updated_at??null)!==p_expected_updated_at)fail('This day changed. Reload it.','40001');
    if(old){requirePermission('kitchen.manage');if(!r.notes?.trim())fail('Enter a correction reason.');}
    if(!validDate(r.business_date)||r.business_date>today()||!Number.isInteger(r.bottles)||r.bottles<0||r.bottles>100000||typeof r.closed!=='boolean'||(r.closed&&r.bottles))fail('Check the date and bottles used.');
    const id=old?.id??crypto.randomUUID(),delta=(old?.bottles??0)-r.bottles;
    if(delta)adjustLocalIngredientStock({ingredientId:i!.id,movementType:'kitchen_production',quantity:delta,reason:'Snorkelling Mineral Water',notes:r.business_date+' | '+(r.notes??''),enteredBy:actorName(),createdBy:actor(),referenceId:id});
    const record={...structuredClone(r),id,created_by:actor(),created_by_name:actorName(),revision:(old?.revision??0)+1,updated_at:new Date().toISOString()};audit('kitchen_water_usage',id,old??null,record);if(old)Object.assign(old,record);else db.kitchen_water_usage.push(record);op.save(id);return record;
  },
};
