import type { ReceiptData, ReceiptReview } from './receiptReview';
import { remainingToBuy } from './purchasingProgress';
import { hasPurchaseEntry, purchaseEntryIssues } from './purchaseEntry';

export function requestReceiptProblems(r:ReceiptReview,d:ReceiptData):boolean {
  if(!r.request_id)return false;
  const items=r.request_snapshot?.purchase_request_items??[],entries=d.request_entries??{};
  const entered=items.filter(i=>hasPurchaseEntry(entries[i.id]));
  return !entered.length||Object.keys(entries).some(id=>!items.some(i=>i.id===id))||entered.some(i=>{
    const issue=purchaseEntryIssues(entries[i.id],remainingToBuy(i));
    return i.purchase_status==='unavailable'||!!issue.quantity||issue.cost;
  });
}
