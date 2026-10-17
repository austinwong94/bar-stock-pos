import { db, require as requirePermission, currentUserIdRef } from './demoBackend';
import { demoReceiptReviewHandlers as reviews } from './demoReceiptReview';
import { demoSupplyHandlers } from './demoSupplyWorkflow';
import { blankReceiptData, receiptGaps, receiptProblems, receiptReconciliation, type ReceiptReview } from './receiptReview';
import { purchaseRequestSnapshot } from './purchaseDraft';
import { requestReceiptProblems } from './requestReceipt';
import { malaysiaDateInputValue } from './format';
import { hasPurchaseEntry } from './purchaseEntry';
import type { PurchaseRequest } from './platformTypes';

const fail=(message:string,code='P0001'):never=>{throw Object.assign(new Error(message),{code});};
const actor=()=>currentUserIdRef.value!;
function access(){requirePermission('purchasing.fulfil');requirePermission('purchasing.cost.view');}
function snapshot(id:string){const r=db.purchase_requests.find(r=>r.id===id);if(!r||!['submitted','buying','completed'].includes(r.status))return fail('Request is not open for purchasing.');return purchaseRequestSnapshot({...r,purchase_request_items:db.purchase_request_items.filter(i=>i.request_id===id)} as PurchaseRequest);}
function event(r:ReceiptReview,action:string,before:unknown,after:unknown){db.receipt_review_events.push({id:crypto.randomUUID(),review_id:r.id,action,actor_id:actor(),actor_name:r.created_by_name,created_at:new Date().toISOString(),before_json:structuredClone(before),after_json:structuredClone(after)});}
function touch(r:ReceiptReview){r.version++;r.updated_at=new Date().toISOString();return structuredClone(r);}
function accounting(r:ReceiptReview){const d=r.data;return {review_id:r.id,address:d.address,tax_id:d.tax_id,phone:d.phone,currency:d.currency,subtotal:d.subtotal,tax:d.tax,discount:d.discount,review_note:d.review_note,extraction:r.extraction,scan_status:r.scan_status,model:r.model};}

export function requestReceiptHandlers(recordPurchase:(args:unknown)=>any):Record<string,(args:any)=>any>{return {
  start_request_receipt_review:({p_id,p_request_id})=>{
    access();db.receipt_reviews??=[];
    const existing=db.receipt_reviews.find(r=>r.id===p_id);
    if(existing){if(existing.created_by!==actor()||existing.request_id!==p_request_id)fail('Review belongs to another purchase.','42501');return structuredClone(existing);}
    const pending=db.receipt_reviews.find(r=>r.request_id===p_request_id&&r.created_by===actor()&&r.status==='pending');if(pending)return structuredClone(pending);
    const request=snapshot(p_request_id),purpose=({'guest meals':'guest_meals','staff meals':'staff_meals',bar:'bar',guest_meals:'guest_meals',staff_meals:'staff_meals'} as Record<string,string>)[request.purpose?.trim().toLowerCase()??'']??'';
    reviews.save_receipt_review({p_id,p_version:0,p_data:{...blankReceiptData(),purpose,request_entries:{}}});
    const r=db.receipt_reviews.find(r=>r.id===p_id)!;Object.assign(r,{request_id:p_request_id,request_snapshot:request});
    event(r as ReceiptReview,'request_linked',null,{request_id:p_request_id,request_no:request.request_no});return structuredClone(r);
  },
  save_receipt_review:args=>{
    access();const r=db.receipt_reviews?.find(r=>r.id===args.p_id),entries=args.p_data?.request_entries;
    if(r?.request_id){if(!entries||typeof entries!=='object'||Array.isArray(entries)||Object.keys(entries).some(id=>!r.request_snapshot.purchase_request_items.some((i:{id:string})=>i.id===id)))fail('Invalid buying list entry.');}
    else if(entries&&Object.keys(entries).length)fail('Open this purchase from the buying list first.');
    return reviews.save_receipt_review(args);
  },
  refresh_request_receipt_review:({p_id,p_version})=>{
    access();const r=db.receipt_reviews?.find(r=>r.id===p_id) as ReceiptReview;
    if(!r||r.created_by!==actor()||!r.request_id)fail('Permission denied','42501');
    if(r.status!=='pending'||r.scan_status==='scanning'||r.version!==p_version)fail('Review changed. Reopen it.','40001');
    const fresh=snapshot(r.request_id!),before={...structuredClone(r.data),request_labels:Object.fromEntries(r.request_snapshot!.purchase_request_items.map(i=>[i.id,i.item_name+' ('+i.unit+')']))};
    r.data.request_entries=Object.fromEntries(Object.entries(r.data.request_entries??{}).filter(([id])=>{const old=r.request_snapshot!.purchase_request_items.find(i=>i.id===id),next=fresh.purchase_request_items.find(i=>i.id===id);return old&&next&&old.item_name===next.item_name&&old.unit===next.unit;}));
    r.request_snapshot=fresh;touch(r);event(r,'buying_list_refreshed',before,r.data);return structuredClone(r);
  },
  confirm_receipt_review:args=>{
    access();const r=db.receipt_reviews?.find(r=>r.id===args.p_id) as ReceiptReview;
    if(!r?.request_id)return reviews.confirm_receipt_review(args);
    if(r.created_by!==actor())fail('Only the purchaser can confirm this receipt.','42501');
    if(r.status==='confirmed')return structuredClone(r.purchase_result);
    if(r.status!=='pending'||r.scan_status==='scanning'||r.version!==args.p_version)fail('Receipt changed. Reopen and review it.','40001');
    if(args.p_verified!==true)fail('Review and verify the receipt before confirming.');
    const d=r.data;
    if(receiptProblems(d,malaysiaDateInputValue(new Date())).length||requestReceiptProblems(r,d))fail('Check the highlighted receipt details and bought quantities.');
    if((receiptGaps(d).length||receiptReconciliation(d)||r.scan_status==='failed'||r.extraction?.warnings.length||r.extraction?.unreadable.length)&&!d.review_note.trim())fail('Record how you checked the missing or unreadable details.');
    const entries=d.request_entries!,items=r.request_snapshot!.purchase_request_items.filter(i=>hasPurchaseEntry(entries[i.id])).sort((a,b)=>a.id.localeCompare(b.id));
    if(items.some(i=>!db.purchase_request_items.some(current=>current.id===i.id&&current.request_id===r.request_id&&current.item_name===i.item_name&&current.unit===i.unit)))fail('An item or unit changed. Refresh the buying list.','40001');
    const result=recordPurchase({p_request_id:r.request_id,p_operation_id:r.id,p_supplier:d.supplier.trim(),p_reference:d.receipt_no.trim(),p_evidence:{purpose:d.purpose,purchase_date:d.purchase_date,total_cost:Number(d.total_cost),receipt_path:d.receipt!.path,receipt_hash:d.receipt!.hash,items_path:d.items!.path,items_hash:d.items!.hash},p_items:items.map(i=>({id:i.id,expected_updated_at:i.updated_at,quantity:Number(entries[i.id].quantity),actual_cost:entries[i.id].cost.trim()?Number(entries[i.id].cost):null}))});
    const proof=db.audit_logs.find(a=>a.id===result.id)!.after_json.evidence;
    proof.lines=d.lines.map(l=>({name:l.name,category:l.category,unit:l.unit,quantity:Number(l.quantity),amount:Number(l.amount)}));
    proof.accounting_details=accounting(r);
    const receipt=demoSupplyHandlers.read_expense_receipts({p_from:d.purchase_date,p_to:d.purchase_date}).find((e:{id:string})=>e.id===result.id);
    Object.assign(r,{status:'confirmed',purchase_result:receipt,confirmed_at:new Date().toISOString()});touch(r);
    event(r,'confirmed',null,{receipt_id:result.id,request_id:r.request_id,verified:true,review_note:d.review_note});return structuredClone(receipt);
  },
};}
