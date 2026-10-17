import type { PurchaseRequest, PurchaseRequestItem } from './platformTypes';

export type PurchaseQueueView = 'open' | 'receiving' | 'history';
export type PurchaseQueue = {
  requests: PurchaseRequest[];
  total: number;
  counts: Record<PurchaseQueueView, number>;
};

export function receivedQuantity(item: PurchaseRequestItem) {
  return Math.round((item.purchase_receipts ?? []).reduce((sum, receipt) => sum + Number(receipt.purchase_quantity), 0) * 10000) / 10000;
}

export function awaitingDelivery(item: PurchaseRequestItem) {
  return item.purchase_status === 'bought' && receivedQuantity(item) < Number(item.purchased_quantity);
}

export function remainingToBuy(item: Pick<PurchaseRequestItem, 'quantity' | 'purchased_quantity' | 'purchase_status'>) {
  const bought = item.purchase_status === 'bought' ? Number(item.purchased_quantity) || 0 : 0;
  return Math.max(0, Math.round((Number(item.quantity) - bought) * 100) / 100);
}

export function requestProgress(request: PurchaseRequest) {
  const items = request.purchase_request_items ?? [];
  const pending = items.filter(item => remainingToBuy(item) > 0).length;
  const awaiting = items.filter(awaitingDelivery).length;
  const received = items.filter(item => receivedQuantity(item) > 0).length;
  const status = request.status === 'cancelled' ? 'Cancelled'
    : pending ? received ? 'Partially Received' : 'To Buy'
    : awaiting ? received ? 'Partially Received' : 'Awaiting Delivery'
    : items.some(item => item.purchase_status === 'unavailable') ? 'Closed With Unavailable Items' : 'Received';
  return { pending, awaiting, received, status, open: request.status !== 'cancelled' && (pending > 0 || awaiting > 0) };
}
