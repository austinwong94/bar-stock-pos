import { fixedDeliveryUnit, measuredPieceDelivery } from './delivery';
import { awaitingDelivery, receivedQuantity } from './purchasingProgress';
import { countDisplay, countUnit } from './stockCount';
import type { PurchaseRequestItem } from './platformTypes';
import type { IngredientWithBalance } from './types';
import { kitchenFactor, kitchenName, kitchenUnit } from './kitchenCatalogue';

export function suggestedDeliveryEntry(item:Pick<PurchaseRequestItem,'item_name'|'unit'>,catalogue:IngredientWithBalance[]):DeliveryEntry {
  const fixed=fixedDeliveryUnit(item.unit),name=item.item_name.trim().toLocaleLowerCase();
  const matches=catalogue.filter(i=>i.active&&[i.name,kitchenName(i)].some(n=>n.trim().toLocaleLowerCase()===name)&&(!fixed||fixed.baseUnit===i.base_unit||measuredPieceDelivery(item.unit,i.base_unit)));
  const matched=matches.length===1?matches[0]:undefined;
  const saved=matched&&kitchenUnit(matched).toLocaleLowerCase()===item.unit.trim().toLocaleLowerCase()?kitchenFactor(matched):null;
  return {quantity:'',ingredientId:matched?.id??'',size:matched&&measuredPieceDelivery(item.unit,matched.base_unit)?'':fixed?String(fixed.size):saved?String(saved):''};
}

export type DeliveryEntry = { quantity: string; ingredientId: string; size: string; pieces?: string; quantity_measure?: 'kg'|'g'|'L'|'ml'; quantity_value?: string; size_measure?: 'kg'|'g'|'L'|'ml'; size_value?: string };
export const deliveryRemaining = (item: PurchaseRequestItem) => Math.round((Number(item.purchased_quantity) - receivedQuantity(item)) * 10000) / 10000;
export const deliveryStockLabel = (quantity: number, unit: string, displayUnit?:string|null, factor?:number|null) => displayUnit&&factor?`${(quantity/factor).toLocaleString('en-MY',{maximumFractionDigits:6})} ${displayUnit}`:`${countDisplay(quantity, unit)} ${countUnit(unit)}`;
export function deliveryPurchaseLabel(quantity: number, unit: string, size: number | null, baseUnit: string, displayUnit?:string|null, factor?:number|null) {
  const amount = (value: number) => Number(value).toLocaleString('en-MY', { maximumFractionDigits: 4 });
  if(displayUnit===unit&&factor===size)return `${amount(quantity)} ${unit}`;
  return `${amount(quantity)} ${unit}` + (!fixedDeliveryUnit(unit) && size != null ? ` · ${amount(size)} ${factor===1&&displayUnit?displayUnit:baseUnit === 'unit' ? 'pcs' : baseUnit} / ${unit}` : '');
}

export function outstandingAfterDelivery(items: PurchaseRequestItem[], lines: { item_id: string; quantity: number }[]) {
  const quantities = new Map(lines.map(line => [line.item_id, Number(line.quantity)]));
  return items.filter(awaitingDelivery).map(item => ({
    item, remaining: Math.round((deliveryRemaining(item) - (quantities.get(item.id) ?? 0)) * 10000) / 10000,
  })).filter(row => row.remaining > 0);
}
