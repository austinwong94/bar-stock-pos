import { db, require as requirePermission, can, currentUserIdRef } from './demoBackend';
import { demoSupplyHandlers } from './demoSupplyWorkflow';
import { receiptDataSchema, receiptGaps, receiptProblems, receiptPayload, receiptReconciliation } from './receiptReview';
import { malaysiaDateInputValue } from './format';
import { receiptMatches } from './receiptDuplicates';
type Row=Record<string,any>;
const actor=()=>currentUserIdRef.value!;
const name=()=>db.profiles.find(p=>p.id===actor())?.full_name??'Staff';
const fail=(message:string,code='P0001'):never=>{throw Object.assign(new Error(message),{code});};
function access(edit=false){requirePermission('purchasing.cost.view');requirePermission(edit?'purchasing.fulfil':'purchasing.view');}
function ensure(){db.receipt_reviews??=[];db.receipt_review_events??=[];db.receipt_ai_settings??=[{enabled:false,daily_limit:100,model:'gpt-6-luna',version:1}];db.purchase_suppliers??=[];}
function event(id:string|null,action:string,before:unknown,after:unknown){const snapshot=db.receipt_reviews.find(r=>r.id===id)?.request_snapshot;if(snapshot&&['created','edited'].includes(action)){const labels=Object.fromEntries(snapshot.purchase_request_items.map((i:Row)=>[i.id,i.item_name+' ('+i.unit+')']));if(before)before={request_labels:labels,...before as object};if(after)after={request_labels:labels,...after as object};}db.receipt_review_events.push({id:crypto.randomUUID(),review_id:id,action,actor_id:actor(),actor_name:name(),created_at:new Date().toISOString(),before_json:structuredClone(before),after_json:structuredClone(after)});}
function row(id:string){ensure();const r=db.receipt_reviews.find(r=>r.id===id);if(!r)return fail('Receipt review not found.');return r;}
function touch(r:Row){r.version++;r.updated_at=new Date().toISOString();return structuredClone(r);}
export const demoReceiptReviewHandlers:Record<string,(args:any)=>any>={
  check_purchase_receipt_duplicates:({p_supplier,p_receipt_no,p_receipt_hash,p_exclude_review_id})=>{access();return structuredClone(receiptMatches(db,{supplier:p_supplier??'',receipt_no:p_receipt_no??'',receipt_hash:p_receipt_hash??''},p_exclude_review_id));},
  save_expense_receipt:()=>fail('Review and verify the receipt before confirming.'),
  read_receipt_ai_settings:()=>{if(!can('purchasing.view')&&!can('platform.settings.manage'))fail('Permission denied','42501');ensure();return structuredClone(db.receipt_ai_settings[0]);},
  save_receipt_ai_settings:({p_enabled,p_daily_limit,p_version})=>{requirePermission('platform.settings.manage');ensure();const r=db.receipt_ai_settings[0];if(r.version!==p_version)fail('Settings changed. Reload before saving.','40001');if(!Number.isInteger(p_daily_limit)||p_daily_limit<1||p_daily_limit>1000)fail('Choose a daily limit between 1 and 1000.');const before=structuredClone(r);Object.assign(r,{enabled:p_enabled,daily_limit:p_daily_limit,version:r.version+1});event(null,'scan_settings_changed',before,r);return structuredClone(r);},
  read_purchase_supplier_profiles:()=>{access();ensure();return db.purchase_suppliers.map(r=>({...r,address:r.address??'',tax_id:r.tax_id??'',phone:r.phone??'',version:r.version??1}));},
  save_purchase_supplier_profile:({p_profile:p,p_version})=>{access(true);ensure();const old=db.purchase_suppliers.find(r=>r.name.toLowerCase()===p.name.trim().toLowerCase());if((old?.version??(old?1:0))!==p_version)fail('Supplier changed. Reload before saving.','40001');if(!p.name.trim()||p.name.length>160||p.address.length>1000||p.tax_id.length>120||p.phone.length>100)fail('Check supplier details.');const before=old?structuredClone(old):null;const r={...p,name:p.name.trim(),id:old?.id??crypto.randomUUID(),version:p_version+1};if(old)Object.assign(old,r);else db.purchase_suppliers.push(r);event(null,'supplier_details_saved',before,r);return r;},
  read_receipt_reviews:({p_id,p_status='pending',p_offset=0})=>{access();ensure();if(p_id)return structuredClone(row(p_id));const all=db.receipt_reviews.filter(r=>r.status===p_status).sort((a,b)=>b.updated_at.localeCompare(a.updated_at));return {total:all.length,records:structuredClone(all.slice(p_offset,p_offset+50))};},
  read_receipt_review_events:({p_id})=>{access();ensure();return structuredClone(db.receipt_review_events.filter(r=>r.review_id===p_id));},
  save_receipt_review:({p_id,p_version,p_data})=>{access(true);ensure();const data=receiptDataSchema.parse(p_data),old=db.receipt_reviews.find(r=>r.id===p_id);
    if(old&&(old.created_by!==actor()||old.status!=='pending'))fail('Only the purchaser can edit this pending receipt.','42501');
    if(old&&JSON.stringify(old.data)===JSON.stringify(data))return structuredClone(old);
    if((old?.version??0)!==p_version)fail('Receipt changed on another device. Reopen it before editing.','40001');
    if(old?.scan_status==='scanning')fail('Receipt is being scanned.');
    if([data.receipt,data.items].some(p=>p&&!p.path.startsWith(actor()+'/')))fail('Photo belongs to another account.');
    if(old?.extraction&&JSON.stringify(old.data.receipt)!==JSON.stringify(data.receipt))fail('Keep the original scanned receipt. Remove this review with a reason and create a replacement.');
    const before=old?structuredClone(old.data):null;
    const r=old??{id:p_id,version:0,status:'pending',created_by:actor(),created_by_name:name(),created_at:new Date().toISOString(),scan_status:'idle',scan_error:null,extraction:null,model:null,result_id:null,deleted_at:null,delete_reason:null,confirmed_at:null};
    r.data=data;touch(r);if(!old)db.receipt_reviews.push(r);event(p_id,old?'edited':'created',before,data);return structuredClone(r);
  },
  delete_receipt_review:({p_id,p_version,p_reason})=>{access(true);const r=row(p_id);if(r.created_by!==actor()&&!can('purchasing.manage'))fail('Permission denied','42501');if(r.status==='deleted')return structuredClone(r);if(r.version!==p_version||r.status!=='pending'||r.scan_status==='scanning')fail('Receipt changed or is being scanned. Reopen it.','40001');if(!p_reason?.trim())fail('A removal reason is required.');Object.assign(r,{status:'deleted',deleted_at:new Date().toISOString(),delete_reason:p_reason.trim()});touch(r);event(p_id,'removed',null,{reason:p_reason.trim(),deleted_at:r.deleted_at});return structuredClone(r);},
  confirm_receipt_review:({p_id,p_version,p_verified})=>{access(true);const r=row(p_id);if(r.created_by!==actor())fail('Only the purchaser can confirm this receipt.','42501');if(r.status==='confirmed')return structuredClone(db.expense_receipts.find(e=>e.id===r.result_id));if(r.status!=='pending'||r.scan_status==='scanning'||r.version!==p_version)fail('Receipt changed. Reopen and review it.','40001');if(p_verified!==true)fail('Review and verify the receipt before confirming.');
    if(receiptProblems(r.data,malaysiaDateInputValue(new Date())).length)fail('Check the highlighted receipt details.');
    if((receiptGaps(r.data).length||receiptReconciliation(r.data)||r.scan_status==='failed'||r.extraction?.warnings.length||r.extraction?.unreadable.length)&&!r.data.review_note.trim())fail('Record how you checked the missing or unreadable details.');
    const result=demoSupplyHandlers.save_expense_receipt({p_operation_id:p_id,p_receipt:receiptPayload(r.data)});
    result.accounting_details={review_id:r.id,address:r.data.address,tax_id:r.data.tax_id,phone:r.data.phone,currency:r.data.currency,subtotal:r.data.subtotal,tax:r.data.tax,discount:r.data.discount,review_note:r.data.review_note,extraction:r.extraction,scan_status:r.scan_status,model:r.model};
    Object.assign(r,{status:'confirmed',result_id:result.id,confirmed_at:new Date().toISOString()});touch(r);event(p_id,'confirmed',null,{receipt_id:result.id,verified:true,review_note:r.data.review_note});return structuredClone(result);
  },
  preview_receipt_scan:({p_id})=>{access(true);ensure();const r=row(p_id);if(!db.receipt_ai_settings[0].enabled)fail('AI receipt scanning is switched off by Admin.');if(r.created_by!==actor()||r.status!=='pending')fail('Scan your own pending receipt.','42501');if(r.scan_status==='complete')return structuredClone(r);if(r.scan_status!=='idle'||!r.data.receipt)fail('Scan has already started or the receipt photo is missing.');
    event(p_id,'scan_started',null,{model:'gpt-6-luna'});Object.assign(r,{scan_status:'failed',model:'gpt-6-luna',scan_error:'AI is not connected in the shared review. No API charge. Enter details manually; the receipt is kept pending.'});touch(r);event(p_id,'scan_failed',null,{error:r.scan_error});return structuredClone(r);},
  reset_receipt_review_scan:({p_id,p_version})=>{requirePermission('platform.settings.manage');const r=row(p_id);if(r.version!==p_version||r.status!=='pending'||r.scan_status!=='failed')fail('Only failed scans can be reset.');r.scan_status='idle';touch(r);event(p_id,'scan_reset',null,{previous_error:r.scan_error});return structuredClone(r);},
};
