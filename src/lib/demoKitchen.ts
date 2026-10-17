import { kitchenFractional } from './kitchenCatalogue';
import { can, canViewBooking, currentUserIdRef, db, require as requirePermission } from './demoBackend';
import { adjustLocalIngredientStock, loadLocalIngredientItems, loadLocalIngredientMovements, submitLocalKitchenProduction, withLocalIngredientRollback } from './localStore';
import { localFoodHistory } from './foodStockHistory';
import { localFoodItemHistory } from './foodItemHistory';
import { malaysiaDateInputValue } from './format';

type Row = Record<string, any>;
const foodCategories = ['Food', 'Seafood', 'Condiment'];
const actor = () => {if(!currentUserIdRef.value)throw new Error('Sign in before recording changes.');return currentUserIdRef.value;};
const staffName = (id: string) => db.profiles.find(p => p.id === id)?.full_name ?? null;
const canManage = (bookingId: string) => can('kitchen.production.manage') || ((can('guests.booking.create') || can('boarding.mark')) && canViewBooking(bookingId));
const balance = (item: Row) => Number((Array.isArray(item.ingredient_balances) ? item.ingredient_balances[0] : item.ingredient_balances)?.quantity_on_hand ?? 0);
function previous(operation: string, token: string, payload: string) {
  if (!token) throw new Error('A request reference is required.');
  db.operation_requests ??= [];
  const row = db.operation_requests.find(r => r.actor_id === actor() && r.operation === operation && r.request_id === token);
  if (row && row.payload_hash !== payload) throw new Error('This request already succeeded with different details. Reload the records.');
  return row;
}
function audit(action: string, id: string, before: Row | null, after: Row) {
  db.audit_logs.push({ id: crypto.randomUUID(), actor_id: actor(), action, entity_type: action, entity_id: id, before_json: before, after_json: structuredClone(after), created_at: new Date().toISOString() });
}
export const demoKitchenHandlers: Record<string, (args: any) => any> = {
  read_food_item_history: (args) => {
    if(!can('kitchen.production.manage')&&!can('purchasing.receive')&&!can('kitchen.stock.count'))throw new Error('Kitchen access required.');
    const item=loadLocalIngredientItems(true).find(i=>i.id===args.p_ingredient_id&&foodCategories.includes(i.category));
    if(!item)throw new Error('This food item is unavailable.');
    const {id,name,kitchen_label,base_unit}=item;
    const rows=loadLocalIngredientMovements().filter(m=>m.ingredient_id===id).map(m=>({...m,ingredient_items:{name,kitchen_label,base_unit}}));
    return localFoodItemHistory(rows,{id,name,kitchen_label,base_unit},args);
  },
  record_kitchen_usage_checked: ({p_items,p_business_date,p_purpose,p_meal,p_portions,p_notes,p_request_id}) => {
    requirePermission('kitchen.production.manage');
    const payload=JSON.stringify([p_items,p_business_date,p_purpose,p_meal,p_portions,p_notes]);
    const done=previous('kitchen_meal_usage',p_request_id,payload);if(done)return done.result_id;
    const invalid=(message:string):never=>{throw {code:'P0001',message};};
    if(!['guest_meals','staff_meals'].includes(p_purpose))invalid('Choose guest meals or staff meals.');
    if(!/^\d{4}-\d{2}-\d{2}$/.test(p_business_date)||p_business_date>malaysiaDateInputValue(new Date()))invalid('Choose today or a past usage date.');
    if(p_portions!==null&&(!Number.isInteger(p_portions)||p_portions<=0))invalid('Enter a positive number of meals, or leave it blank.');
    if(String(p_meal??'').length>120||String(p_notes??'').length>2000)invalid('Shorten the meal name or notes.');
    if(!Array.isArray(p_items)||!p_items.length||p_items.length>200||new Set(p_items.map(i=>i.ingredient_id)).size!==p_items.length)invalid('Choose distinct food items.');
    const items=loadLocalIngredientItems(true);
    for(const line of p_items){
      const item=items.find(i=>i.id===line.ingredient_id&&i.active&&foodCategories.includes(i.category));
      const n=line.quantity;
      if(!item||!Number.isFinite(n)||n<=0||n>1e9||Math.abs(n*100-Math.round(n*100))>1e-8||(item.base_unit==='unit'&&!Number.isInteger(n)&&!kitchenFractional(item)))invalid('Enter a positive quantity in the displayed unit.');
      if(item!.base_unit!==line.expected_base_unit)invalid('The inventory unit changed. Refresh and review.');
      if(n>balance(item!))invalid('Insufficient food stock for '+item!.name+'.');
    }
    const name=staffName(actor());if(!name)invalid('Your staff profile needs a name before recording usage.');
    const meal=(p_purpose==='guest_meals'?'Guest Meals':'Staff Meals')+(String(p_meal??'').trim()?' / '+p_meal.trim():'');
    const report=withLocalIngredientRollback(()=>submitLocalKitchenProduction({businessDate:p_business_date,platterName:meal,platterCount:1,servingBasis:'batch',submittedBy:name,createdBy:actor(),mealPurpose:p_purpose,mealsPrepared:p_portions,notes:p_notes,items:p_items.map((i:Row)=>({ingredient_id:i.ingredient_id,quantity_per_platter:i.quantity}))}));
    audit('record_kitchen_usage',report.id,null,report);
    db.operation_requests.push({actor_id:actor(),operation:'kitchen_meal_usage',request_id:p_request_id,payload_hash:payload,result_id:report.id});
    return report.id;
  },
  read_food_stock_history: (args) => {
    if(!can('kitchen.production.manage')&&!can('purchasing.receive')&&!can('kitchen.stock.count'))throw new Error('Kitchen access required.');
    const ids=new Set(loadLocalIngredientItems(true).filter(i=>foodCategories.includes(i.category)).map(i=>i.id));
    return localFoodHistory(loadLocalIngredientMovements().filter(m=>ids.has(m.ingredient_id)).map(m=>({...m,ingredient_items:{...m.ingredient_items!,kitchen_label:loadLocalIngredientItems(true).find(i=>i.id===m.ingredient_id)?.kitchen_label}})),args);
  },
  read_guest_meal_needs: ({p_date}) => {
    if (!can('kitchen.production.manage') && !can('guests.booking.create') && !can('boarding.mark')) throw new Error('Meal requirements access denied.');
    return db.tourists.flatMap(tourist => {
      const booking = db.bookings.find(b => b.id === tourist.booking_id && b.service_date === p_date && !['cancelled','no_show'].includes(b.status));
      if (!booking || !canManage(booking.id)) return [];
      const saved = (db.guest_meal_needs ?? []).find(n => n.tourist_id === tourist.id);
      return [{ tourist_id: tourist.id, booking_id: booking.id, booking_ref: booking.booking_ref, lead_name: booking.lead_name, full_name: tourist.full_name,
        meal_preference: 'unknown', allergy_status: 'unknown', allergens: [], notes: '', updated_at: null, reviewed_at: null,
        ...saved, updated_by: saved ? staffName(saved.updated_by) : null, reviewed_by: saved?.reviewed_by ? staffName(saved.reviewed_by) : null }];
    }).sort((a,b) => a.booking_ref.localeCompare(b.booking_ref) || a.full_name.localeCompare(b.full_name));
  },
  save_guest_meal_needs: ({p_tourist_id, p_expected_updated_at, p_details, p_request_id}) => {
    const tourist = db.tourists.find(t => t.id === p_tourist_id);
    if (!tourist || !canManage(tourist.booking_id)) throw new Error('Meal requirements access denied.');
    const payload = JSON.stringify([p_tourist_id, p_expected_updated_at, p_details]);
    const done = previous('guest_meal_needs', p_request_id, payload);
    if (done) return done.result_id;
    db.guest_meal_needs ??= [];
    let row = db.guest_meal_needs.find(r => r.tourist_id === p_tourist_id);
    if ((row?.updated_at ?? null) !== p_expected_updated_at) throw new Error('Meal requirements changed on another device. Close and reopen this guest.');
    if (!['unknown','standard','vegetarian','vegan','other'].includes(p_details.meal_preference) || !['unknown','none_reported','reported'].includes(p_details.allergy_status)) throw new Error('Choose a valid meal and allergy status.');
    const allergens = p_details.allergy_status === 'reported' ? p_details.allergens : [];
    const notes = String(p_details.notes ?? '').trim();
    if (!Array.isArray(allergens) || allergens.length > 32 || allergens.some(a => typeof a !== 'string' || a.length > 80) || notes.length > 2000) throw new Error('Check the allergy details.');
    if (p_details.allergy_status === 'reported' && !allergens.length && !notes) throw new Error('Name the reported allergy.');
    const before = row ? structuredClone(row) : null;
    const updated_at = new Date(Math.max(Date.now(), Date.parse(row?.updated_at ?? '') + 1 || 0)).toISOString();
    if (!row) { row = {tourist_id: p_tourist_id}; db.guest_meal_needs.push(row); }
    Object.assign(row, {meal_preference:p_details.meal_preference, allergy_status:p_details.allergy_status, allergens:[...allergens], notes, updated_by:actor(), updated_at, reviewed_by:null, reviewed_at:null});
    audit('guest_meal_needs',p_tourist_id,before,row);
    db.operation_requests.push({actor_id:actor(),operation:'guest_meal_needs',request_id:p_request_id,payload_hash:payload,result_id:p_tourist_id});
    return p_tourist_id;
  },
  review_guest_meal_needs: ({p_tourist_id,p_expected_updated_at}) => {
    requirePermission('kitchen.production.manage');
    const row = (db.guest_meal_needs ?? []).find(r => r.tourist_id === p_tourist_id);
    if (!row || row.updated_at !== p_expected_updated_at) throw new Error('Meal requirements changed. Refresh before reviewing.');
    if (row.meal_preference === 'unknown' || row.allergy_status === 'unknown') throw new Error('Ask the guest about meals and allergies first.');
    if (!row.reviewed_at) { const before=structuredClone(row); row.reviewed_by=actor(); row.reviewed_at=new Date().toISOString(); audit('meal_needs_review',p_tourist_id,before,row); }
    return p_tourist_id;
  },
  read_kitchen_stock: () => {
    if(!can('kitchen.production.manage')&&!can('purchasing.receive')&&!can('kitchen.stock.count'))throw new Error('Kitchen access required.');
    const items=loadLocalIngredientItems(true).filter(i=>foodCategories.includes(i.category));
    const ids=new Set(items.map(i=>i.id));
    return {items:items.map(({cost_per_base_unit,...item})=>({...item,balance_version:item.updated_at})),movements:loadLocalIngredientMovements().filter(m=>ids.has(m.ingredient_id)).slice(0,200)};
  },
  record_kitchen_stock_count: ({p_items,p_notes,p_request_id}) => {
    requirePermission('kitchen.stock.count');
    const payload=JSON.stringify([p_items,p_notes]);
    const done=previous('kitchen_stock_count',p_request_id,payload);
    if(done)return done.result_id;
    if(!Array.isArray(p_items)||!p_items.length||p_items.length>200||new Set(p_items.map(i=>i.ingredient_id)).size!==p_items.length)throw {code:'P0001',message:'Count between 1 and 200 distinct food items.'};
    if(String(p_notes??'').length>2000)throw {code:'P0001',message:'Keep count notes within 2000 characters.'};
    const items=loadLocalIngredientItems(true);
    for(const line of p_items){
      const item=items.find(i=>i.id===line.ingredient_id&&i.active&&foodCategories.includes(i.category));
      const n=Number(line.counted_quantity);
      if(!item||line.counted_quantity===null||!Number.isFinite(n)||n<0||n>1e9||Math.abs(n*100-Math.round(n*100))>1e-8||(item.base_unit==='unit'&&!Number.isInteger(n)&&!kitchenFractional(item)))throw {code:'P0001',message:'Enter a valid physical count in the displayed unit.'};
      if(item.base_unit!==line.expected_base_unit||balance(item)!==line.expected_balance||item.updated_at!==line.expected_version)throw {code:'P0001',message:'Stock changed after counting '+item.name+'. Refresh and recount this item.'};
    }
    withLocalIngredientRollback(()=>p_items.forEach(line=>adjustLocalIngredientStock({ingredientId:line.ingredient_id,movementType:'count',quantity:line.counted_quantity,reason:'Physical Stock Count',notes:p_notes,enteredBy:staffName(actor()),referenceId:p_request_id,createdBy:actor()})));
    audit('kitchen_stock_count',p_request_id,null,{items:p_items,notes:p_notes,counted_by:staffName(actor())});
    db.operation_requests.push({actor_id:actor(),operation:'kitchen_stock_count',request_id:p_request_id,payload_hash:payload,result_id:p_request_id});
    return p_request_id;
  },
  record_kitchen_stock_out: ({p_items,p_reason,p_notes,p_request_id}) => {
    requirePermission('kitchen.production.manage');
    const payload=JSON.stringify([p_items,p_reason,p_notes]);
    const done=previous('kitchen_stock_out',p_request_id,payload);
    if (done) return done.result_id;
    if (!['Spoilage','Wastage','Missing','Other Use'].includes(p_reason) || !String(p_notes??'').trim() || p_notes.length>2000) throw {code:'P0001',message:'Choose a reason and enter a short explanation.'};
    if (!Array.isArray(p_items) || !p_items.length || p_items.length>200 || new Set(p_items.map(i=>i.ingredient_id)).size!==p_items.length) throw {code:'P0001',message:'Choose distinct food items.'};
    const items=loadLocalIngredientItems(true);
    for (const line of p_items) {
      const item=items.find(i=>i.id===line.ingredient_id&&i.active&&foodCategories.includes(i.category));
      const n=Number(line.quantity);
      if (!item || !Number.isFinite(n) || n<=0 || Math.abs(n*100-Math.round(n*100))>1e-8 || (item.base_unit==='unit'&&!Number.isInteger(n)&&!kitchenFractional(item))) throw {code:'P0001',message:'Enter a positive quantity in the displayed unit.'};
      if (line.expected_item_version&&line.expected_item_version!==item.updated_at)throw {code:'40001',message:'Item unit changed. Refresh and review.'};
      if (line.expected_base_unit!==item.base_unit) throw {code:'P0001',message:'The inventory unit changed. Refresh and review the quantities.'};
      if (line.expected_balance!==balance(item)||('expected_version' in line&&line.expected_version!==item.updated_at)) throw {code:'P0001',message:'Food stock changed. Clear its quantity and review again.'};
      if (n>balance(item)) throw {code:'P0001',message:'Insufficient food stock for '+item.name+'.'};
    }
    withLocalIngredientRollback(()=>p_items.forEach(line=>adjustLocalIngredientStock({ingredientId:line.ingredient_id,movementType:p_reason==='Other Use'?'adjustment':'waste',quantity:p_reason==='Other Use'?-line.quantity:line.quantity,reason:p_reason,notes:p_notes,enteredBy:staffName(actor()),referenceId:p_request_id,createdBy:actor()})));
    audit('kitchen_stock_out',p_request_id,null,{items:p_items,reason:p_reason,notes:p_notes});
    db.operation_requests.push({actor_id:actor(),operation:'kitchen_stock_out',request_id:p_request_id,payload_hash:payload,result_id:p_request_id});
    return p_request_id;
  },
  record_kitchen_stock_out_checked: (args) => {
    requirePermission('kitchen.production.manage');
    if(!Array.isArray(args.p_items)||!args.p_items.length||args.p_items.some((line:Row)=>!line||!('expected_version' in line)))throw {code:'P0001',message:'Reload the food stock before reviewing.'};
    return demoKitchenHandlers.record_kitchen_stock_out(args);
  },
};
