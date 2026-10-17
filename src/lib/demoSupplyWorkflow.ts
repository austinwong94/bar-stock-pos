import { kitchenFractional } from './kitchenCatalogue';
import { db, require as requirePermission, can, currentUserIdRef } from './demoBackend';
import { adjustLocalIngredientStock, loadLocalIngredientItems, saveLocalIngredientItem, withLocalIngredientRollback } from './localStore';
import { addMonths, format } from 'date-fns';
import { malaysiaDateInputValue } from './format';
import { countBalance } from './stockCount';
import { receiptMatches } from './receiptDuplicates';
import { guardReceiptDeliveryChange, queueReceiptDelivery } from './demoReceiptDelivery';
import { expenseCategories, purchasePurposes, type DailyUsage, type ExpenseReceipt } from './supplyWorkflow';
type Row = Record<string, any>;
const actor = () => currentUserIdRef.value!;
const actorName = () => db.profiles.find(p=>p.id===actor())?.full_name ?? 'Staff';
const fail = (message: string, code = 'P0001'): never => { throw { message, code }; };
const today = () => malaysiaDateInputValue(new Date());
function audit(action: string, id: string, before: unknown, after: unknown) {
  db.audit_logs.push({id:crypto.randomUUID(),actor_id:actor(),action,entity_type:'supply',entity_id:id,before_json:before,after_json:structuredClone(after),created_at:new Date().toISOString()});
}
function replay(operation: string, id: string, payload: unknown) {
  db.operation_requests ??= [];
  if (!id || !actor()) fail('Sign in and provide a submission reference.');
  const hash=JSON.stringify(payload), old=db.operation_requests.find(r=>r.actor_id===actor()&&r.operation===operation&&r.request_id===id);
  if(old&&old.payload_hash!==hash)fail('This submission already has different details. Refresh before retrying.');
  return {old,hash,save:(result_id:string)=>db.operation_requests.push({actor_id:actor(),operation,request_id:id,payload_hash:hash,result_id})};
}
function ensure() {
  db.expense_receipts ??= []; db.kitchen_daily_usage ??= []; db.kitchen_usage_templates ??= [];
  db.purchase_payments ??= []; db.purchase_payment_accounts ??= [];
}
function paymentSummary(id:string) {
  ensure();
  const receipt=db.expense_receipts.find(r=>r.id===id)??db.audit_logs.find(a=>a.id===id&&a.action==='record_purchase_batch')?.after_json?.evidence;
  if(!receipt)fail('Receipt not found.');
  const payments=db.purchase_payments.filter(p=>p.receipt_id===id).sort((a,b)=>b.created_at.localeCompare(a.created_at));
  return {version:db.purchase_payment_accounts.find(a=>a.receipt_id===id)?.version??0,checked:payments.some(p=>!p.void_reason),paid:payments.filter(p=>!p.void_reason).reduce((n,p)=>n+Math.round(p.amount*100),0)/100,total:Number(receipt.total_cost),payments};
}
function paymentAccess(){requirePermission('purchasing.cost.view');requirePermission('purchasing.view');}
export function ensureSupplyDemo() {
  ensure();if(db.supply_preview_version?.length)return;
  const newItems=[{name:'Rice',cost:0.004,stock:40000},{name:'Cabbage',cost:0.005,stock:20000},{name:'Cooking Gas',cost:0.003,stock:28000}];
  for(const value of newItems){if(loadLocalIngredientItems(true).some(i=>i.name===value.name))continue;const item=saveLocalIngredientItem({name:value.name,category:'Food',base_unit:'g',default_pack_size:1000,pack_label:'kg',cost_per_base_unit:value.cost});adjustLocalIngredientStock({ingredientId:item.id,movementType:'adjustment',quantity:value.stock,reason:'Sample Opening Balance',notes:'Review sample only',enteredBy:'Sample Data',createdBy:'u-owner'});}
  const ingredients=loadLocalIngredientItems(true),stamp=new Date().toISOString();
  if(!db.kitchen_usage_templates.length)for(const [name,names] of [['Seafood Lunch',['Rice','Crab','Squid','Prawn','Onion','Garlic','Cooking Gas']],['Vegetables & Rice',['Rice','Cabbage','Onion','Garlic','Cooking Gas']]] as [string,string[]][])db.kitchen_usage_templates.push({id:crypto.randomUUID(),name,ingredient_ids:ingredients.filter(i=>names.includes(i.name)).map(i=>i.id),updated_at:stamp,created_by:'u-owner'});
  if(!db.expense_receipts.length){const current=today().slice(0,7)+'-02',previous=format(addMonths(new Date(current+'T12:00:00'),-1),'yyyy-MM-dd');
    for(const [date,multiplier] of [[current,1],[previous,0.9]] as [string,number][])for(const [supplier,purpose,name,category,quantity,unit,amount] of [['99 Speedmart','guest_meals','Rice','Rice & Dry Goods',10,'pack',280],['AEON','guest_meals','Cabbage','Vegetables',20,'kg',100],['Jusco','staff_meals','Cooking Oil','Seasoning & Oil',3,'bottle',84],['Island Gas Supplier','guest_meals','Cooking Gas','Cooking Gas',2,'cylinder',84]] as [string,string,string,string,number,string,number][]){const total=Math.round(amount*multiplier*100)/100;db.expense_receipts.push({id:crypto.randomUUID(),purchase_date:date,purpose,supplier,receipt_no:'SAMPLE-'+name+'-'+date,total_cost:total,receipt_path:'',items_path:'',receipt_hash:'',items_hash:'',lines:[{name,category,quantity,unit,amount:total}],notes:'Illustrative review data, not a real purchase.',created_at:stamp,created_by:'u-owner',created_by_name:'Sample Data',status:'confirmed',coding_version:1});}}
  db.supply_preview_version=[{version:1}];
}
export const demoSupplyHandlers: Record<string, (args: any) => any> = {
  read_purchase_payment_receipt: ({p_receipt_id})=>{
    paymentAccess();ensure();
    const receipt=demoSupplyHandlers.read_expense_receipts({p_from:'0001-01-01',p_to:'9999-12-31'}).find((r:any)=>r.id===p_receipt_id);
    if(!receipt)fail('Receipt not found.');
    return receipt;
  },
  read_expense_receipts: ({p_from,p_to}) => {
    requirePermission('purchasing.cost.view');ensure();
    const legacy=db.audit_logs.filter(a=>a.action==='record_purchase_batch'&&a.after_json?.evidence).map(a=>{const r=a.after_json,e=r.evidence;return {...e,id:a.id,purpose:e.purpose??'unclassified',supplier:r.supplier??'Unknown Supplier',receipt_no:r.reference??'',lines:e.lines??[],notes:'',created_at:r.confirmed_at,created_by:r.confirmed_by,created_by_name:r.confirmed_by_name,status:'confirmed',legacy:true};});
    return [...db.expense_receipts,...legacy].filter(r=>r.purchase_date>=p_from&&r.purchase_date<=p_to).sort((a,b)=>b.purchase_date.localeCompare(a.purchase_date)).map(r=>{const s=paymentSummary(r.id);return {...r,payment_checked:s.checked,paid_amount:s.paid};});
  },
  read_purchase_payments: ({p_receipt_id})=>{paymentAccess();return paymentSummary(p_receipt_id);},
  record_purchase_payment: (p)=>{
    paymentAccess();if(!can('purchasing.fulfil')&&!can('purchasing.cost.manage'))fail('Purchase payment permission required.','42501');
    const op=replay('purchase_payment',p.p_operation_id,[p.p_receipt_id,p.p_amount,p.p_paid_on,p.p_method,p.p_reference,p.p_expected_version]);
    if(op.old)return paymentSummary(p.p_receipt_id);
    if(db.expense_receipts.some(r=>r.id===p.p_receipt_id&&r.status==='void'))fail('Cannot pay a voided receipt.');
    const s=paymentSummary(p.p_receipt_id);
    if(s.version!==p.p_expected_version)fail('Payment records changed on another device. Reopen the receipt.','40001');
    const n=p.p_amount,d=p.p_paid_on;
    if(!Number.isFinite(n)||n<0||n>99999999.99||Math.abs(n*100-Math.round(n*100))>1e-6||!/^\d{4}-\d{2}-\d{2}$/.test(d)||d>today()||Number.isNaN(Date.parse(d))||new Date(d+'T12:00:00Z').toISOString().slice(0,10)!==d||!['unpaid','bank','qr','cash'].includes(p.p_method)||(p.p_reference?.length??0)>200||(n===0)!==(p.p_method==='unpaid'))fail('Check the payment amount, date, method and reference.');
    if(Math.round(n*100)+Math.round(s.paid*100)>Math.round(s.total*100))fail('Payment exceeds the outstanding amount.');
    if(p.p_method==='unpaid'&&s.checked)fail('Payment status has already been checked.');
    const record={id:crypto.randomUUID(),receipt_id:p.p_receipt_id,amount:n,paid_on:d,method:p.p_method,reference:p.p_reference?.trim()??'',recorded_by:actor(),recorded_by_name:actorName(),created_at:new Date().toISOString()};
    const account=db.purchase_payment_accounts.find(a=>a.receipt_id===p.p_receipt_id);if(account)account.version++;else db.purchase_payment_accounts.push({receipt_id:p.p_receipt_id,version:1});
    db.purchase_payments.push(record);op.save(record.id);audit('record_purchase_payment',p.p_receipt_id,s,record);return paymentSummary(p.p_receipt_id);
  },
  void_purchase_payment: ({p_id,p_reason,p_expected_version})=>{
    paymentAccess();requirePermission('purchasing.cost.manage');const p=db.purchase_payments?.find(p=>p.id===p_id);if(!p)return fail('Payment not found.');
    const s=paymentSummary(p.receipt_id);if(p.void_reason)return s;
    if(s.version!==p_expected_version)fail('Payment records changed on another device. Reopen the receipt.','40001');
    if(!p_reason?.trim()||p_reason.trim().length>500)fail('Enter a correction reason, up to 500 characters.');
    const before=structuredClone(p);Object.assign(p,{void_reason:p_reason.trim(),voided_by:actor(),voided_at:new Date().toISOString()});db.purchase_payment_accounts.find(a=>a.receipt_id===p.receipt_id)!.version++;
    audit('void_purchase_payment',p.receipt_id,before,p);return paymentSummary(p.receipt_id);
  },
  save_expense_receipt: ({p_receipt:r,p_operation_id}) => {
    requirePermission('purchasing.fulfil');requirePermission('purchasing.cost.view');ensure();
    const op=replay('expense_receipt',p_operation_id,r);if(op.old)return db.expense_receipts.find(x=>x.id===op.old!.result_id);
    if(!purchasePurposes.includes(r.purpose)||!r.supplier?.trim()||r.supplier.length>160||!/^\d{4}-\d{2}-\d{2}$/.test(r.purchase_date)||r.purchase_date>today())fail('Select the purchase purpose, supplier and a valid receipt date.');
    if(!Number.isFinite(r.total_cost)||r.total_cost<0||r.total_cost>99999999.99||Math.abs(r.total_cost*100-Math.round(r.total_cost*100))>1e-6)fail('Enter a valid receipt total.');
    if(!r.receipt_path?.startsWith(actor()+'/')||!r.items_path?.startsWith(actor()+'/')||!r.receipt_hash||!r.items_hash||r.receipt_hash===r.items_hash||r.receipt_path===r.items_path)fail('Attach a receipt photo and a different photo of the purchased items.');
    if(receiptMatches(db,r).some(x=>x.status==='confirmed'))fail('This receipt is already recorded. Check the matching receipt before continuing.','23505');
    if(!Array.isArray(r.lines)||r.lines.length>200||r.lines.some((l:Row)=>!l.name?.trim()||!expenseCategories.includes(l.category)||!Number.isFinite(l.amount)||l.amount<0||!Number.isFinite(l.quantity)||l.quantity<=0||!l.unit))fail('Check the receipt item breakdown.');
    const record={...structuredClone(r),supplier:r.supplier.trim(),receipt_no:r.receipt_no?.trim()??'',id:crypto.randomUUID(),status:'confirmed',created_at:new Date().toISOString(),created_by:actor(),created_by_name:actorName()};
    db.expense_receipts.push(record);queueReceiptDelivery(record);op.save(record.id);audit('record_expense_receipt',record.id,null,record);return record;
  },
  void_expense_receipt: ({p_id,p_reason}) => {
    requirePermission('purchasing.manage');requirePermission('purchasing.cost.view');ensure();
    const row=db.expense_receipts.find(r=>r.id===p_id);if(!row||!p_reason?.trim())fail('Enter the correction reason.');
    if(paymentSummary(p_id).paid>0)fail('Reverse the payment record before voiding this receipt.');
    guardReceiptDeliveryChange(p_id,{...row,status:'void'});
    const before=structuredClone(row);row!.status='void';row!.void_reason=p_reason.trim();audit('void_expense_receipt',p_id,before,row);return row;
  },
  read_kitchen_templates: () => {
    requirePermission('kitchen.production.manage');ensure();return db.kitchen_usage_templates;
  },
  save_kitchen_template: ({p_template:r,p_expected_updated_at}) => {
    requirePermission('kitchen.manage');ensure();
    const old=db.kitchen_usage_templates.find(t=>t.id===r.id);
    if((old?.updated_at??null)!==p_expected_updated_at)fail('The template changed on another device. Reload it.', '40001');
    const items=loadLocalIngredientItems(true);
    if(!r.name?.trim()||r.name.length>100||!Array.isArray(r.ingredient_ids)||!r.ingredient_ids.length||new Set(r.ingredient_ids).size!==r.ingredient_ids.length||r.ingredient_ids.some((id:string)=>!items.some(i=>i.id===id&&i.active&&['Food','Seafood','Condiment'].includes(i.category))))fail('Choose a template name and active kitchen ingredients.');
    const record={...r,id:old?.id??crypto.randomUUID(),name:r.name.trim(),updated_at:new Date().toISOString(),created_by:actor()};
    audit('save_kitchen_template',record.id,old??null,record);if(old)Object.assign(old,record);else db.kitchen_usage_templates.push(record);return record;
  },
  read_daily_kitchen_usage: ({p_from,p_to}) => {
    if(!can('kitchen.production.manage')&&!can('purchasing.cost.view'))fail('Kitchen access required.','42501');ensure();
    return db.kitchen_daily_usage.filter(r=>r.business_date>=p_from&&r.business_date<=p_to).map(r=>can('purchasing.cost.view')?r:{...r,lines:r.lines.map(({unit_cost,...l}:Row)=>l)});
  },
  save_daily_kitchen_usage: ({p_record:r,p_expected_updated_at,p_operation_id}) => {
    requirePermission('kitchen.production.manage');ensure();
    const op=replay('daily_kitchen_usage',p_operation_id,[r,p_expected_updated_at]);
    if(op.old)return demoSupplyHandlers.read_daily_kitchen_usage({p_from:r.business_date,p_to:r.business_date})[0];
    const old=db.kitchen_daily_usage.find(x=>x.business_date===r.business_date) as DailyUsage|undefined;
    if((old?.updated_at??null)!==p_expected_updated_at)fail('This day changed on another device. Reload before editing.','40001');
    if(old&&!can('kitchen.manage'))fail('A kitchen manager must correct a confirmed day.','42501');
    if(!/^\d{4}-\d{2}-\d{2}$/.test(r.business_date)||r.business_date>today()||![r.guest_meals,r.staff_meals].every(n=>Number.isInteger(n)&&n>=0&&n<=100000))fail('Check the date and whole meal counts.');
    if(old&&!r.notes?.trim())fail('Enter a reason for correcting this day.');
    const items=loadLocalIngredientItems(true);
    if(!Array.isArray(r.lines)||r.lines.length>200||new Set(r.lines.map((l:Row)=>l.ingredient_id)).size!==r.lines.length)fail('Check the ingredient list.');
    if((r.guest_meals>0&&!r.lines.some((l:Row)=>l.guest_quantity>0))||(r.staff_meals>0&&!r.lines.some((l:Row)=>l.staff_quantity>0)))fail('Enter ingredients used for the recorded meals.');
    for(const l of r.lines){const item=items.find(i=>i.id===l.ingredient_id&&i.active&&['Food','Seafood','Condiment'].includes(i.category));
      if(!item||item.base_unit!==l.unit||(l.expected_item_version&&l.expected_item_version!==item.updated_at)||![l.guest_quantity,l.staff_quantity].every(n=>Number.isFinite(n)&&n>=0&&n<=1e9&&Math.abs(n*100-Math.round(n*100))<1e-6&&(l.unit!=='unit'||Number.isInteger(n)||kitchenFractional(item))))fail('Check ingredient quantities and units.');
      if((!r.guest_meals&&l.guest_quantity)||(!r.staff_meals&&l.staff_quantity))fail('Enter the number of meals for the ingredients used.');
      const previous=old?.lines.find(x=>x.ingredient_id===l.ingredient_id),credit=previous?previous.guest_quantity+previous.staff_quantity:0;
      if(l.guest_quantity+l.staff_quantity>countBalance(item!)+credit)fail('Not enough shared stock: '+item!.name);
    }
    const id=old?.id??crypto.randomUUID();
    withLocalIngredientRollback(()=>{for(const ingredientId of new Set([...r.lines.map((l:Row)=>l.ingredient_id),...(old?.lines.map(l=>l.ingredient_id)??[])] as string[])){
      const before=old?.lines.find(l=>l.ingredient_id===ingredientId),after=r.lines.find((l:Row)=>l.ingredient_id===ingredientId);
      const delta=(before?before.guest_quantity+before.staff_quantity:0)-(after?after.guest_quantity+after.staff_quantity:0);
      if(delta)adjustLocalIngredientStock({ingredientId,movementType:'kitchen_production',quantity:delta,reason:'Daily Kitchen Usage',notes:r.business_date+' · '+(r.notes??''),enteredBy:actorName(),referenceId:id,createdBy:actor()});
    }});
    const record={...structuredClone(r),id,revision:(old?.revision??0)+1,updated_at:new Date().toISOString(),created_by:actor(),created_by_name:actorName(),lines:r.lines.map((l:Row)=>{
      const i=items.find(i=>i.id===l.ingredient_id)!, prior=old?.lines.find(x=>x.ingredient_id===l.ingredient_id);
      return {...l,name:i.kitchen_label||i.name,display_unit:i.kitchen_unit,display_factor:i.kitchen_factor,unit_cost:prior&&'unit_cost' in prior?prior.unit_cost:(Number(i.cost_per_base_unit)>0?Number(i.cost_per_base_unit):null)};
    })};
    audit('save_daily_kitchen_usage',id,old??null,record);if(old)Object.assign(old,record);else db.kitchen_daily_usage.push(record);op.save(id);
    return demoSupplyHandlers.read_daily_kitchen_usage({p_from:r.business_date,p_to:r.business_date})[0];
  },
  code_expense_receipt: ({p_id,p_purpose,p_lines,p_expected_version,p_reason}) => {
    requirePermission('purchasing.cost.view');if(!can('purchasing.cost.manage')&&!can('purchasing.manage'))fail('Accounts editing permission required.','42501');ensure();
    const row=db.expense_receipts.find(r=>r.id===p_id)??db.audit_logs.find(a=>a.id===p_id&&a.action==='record_purchase_batch')?.after_json?.evidence;
    if(!row||row.status==='void')fail('Receipt is unavailable.');
    if((row.coding_version??1)!==p_expected_version)fail('Receipt breakdown changed on another device. Reopen the receipt.','40001');
    if(!purchasePurposes.includes(p_purpose)||!p_reason?.trim()||!Array.isArray(p_lines)||p_lines.length>200||p_lines.some((l:Row)=>!l.name?.trim()||!expenseCategories.includes(l.category)||!Number.isFinite(l.amount)||l.amount<0||Math.abs(l.amount*100-Math.round(l.amount*100))>1e-6||!Number.isFinite(l.quantity)||l.quantity<=0||!l.unit))fail('Check the purpose, item details and correction note.');
    guardReceiptDeliveryChange(p_id,{...row,purpose:p_purpose,lines:p_lines});
    const before=structuredClone(row);Object.assign(row,{purpose:p_purpose,lines:structuredClone(p_lines),coding_version:p_expected_version+1});audit('code_expense_receipt',p_id,before,row);return row;
  },
};
