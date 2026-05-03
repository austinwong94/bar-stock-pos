import type { Category, DailyReport, ProductWithStock, Profile, Sale, SaleItem, SettingsMap, StockMovement } from './types';

export const demoProfile: Profile = {
  id: '00000000-0000-0000-0000-000000000001',
  full_name: 'Demo Admin',
  role: 'admin',
  created_at: new Date().toISOString(),
  updated_at: new Date().toISOString(),
};

export const demoSettings: SettingsMap = {
  business_name: 'Lovely Paradise Bar',
  currency_symbol: 'MYR',
  secondary_currency_symbol: 'RMB',
  rmb_exchange_rate: 1.52,
  business_day_close_time: '00:00',
  default_carton_size: 24,
  allow_negative_stock: false,
  require_qr_reference: false,
  require_manager_approval_for_complimentary: false,
  staff_names: 'Chloe, Happy, Elle, NekoMiao',
  beer_bundle_enabled: true,
  beer_bundle_name: 'Beer Bundle',
  beer_bundle_units_per_set: 4,
  beer_bundle_price: 40,
  receipt_footer_text: 'Thank you.',
};

export const demoCategories: Category[] = [
  { id: '10000000-0000-0000-0000-000000000001', name: 'Beer', sort_order: 10, created_at: new Date().toISOString() },
  { id: '10000000-0000-0000-0000-000000000002', name: 'Soft Drink', sort_order: 20, created_at: new Date().toISOString() },
  { id: '10000000-0000-0000-0000-000000000004', name: 'Food', sort_order: 30, created_at: new Date().toISOString() },
  { id: '10000000-0000-0000-0000-000000000005', name: 'Cocktail', sort_order: 40, created_at: new Date().toISOString() },
  { id: '10000000-0000-0000-0000-000000000003', name: 'Others', sort_order: 50, created_at: new Date().toISOString() },
];

const beer = demoCategories[0];
const softDrink = demoCategories[1];

export const demoProducts: ProductWithStock[] = [
  { id: '20000000-0000-0000-0000-000000000001', name: '1602 Lager', category_id: beer.id, price_per_unit: 12, cost_per_unit: 7, carton_size: 24, low_stock_threshold: 12, active: true, image_url: 'https://images.unsplash.com/photo-1608270586620-248524c67de9?auto=format&fit=crop&w=900&q=80', created_at: new Date().toISOString(), updated_at: new Date().toISOString(), categories: beer, inventory_balances: { quantity_on_hand: 72 } },
  { id: '20000000-0000-0000-0000-000000000002', name: '1602 Pale Ale', category_id: beer.id, price_per_unit: 14, cost_per_unit: 8, carton_size: 24, low_stock_threshold: 12, active: true, image_url: 'https://images.unsplash.com/photo-1571613316887-6f8d5cbf7ef7?auto=format&fit=crop&w=900&q=80', created_at: new Date().toISOString(), updated_at: new Date().toISOString(), categories: beer, inventory_balances: { quantity_on_hand: 20 } },
  { id: '20000000-0000-0000-0000-000000000003', name: '1602 Extra Dark', category_id: beer.id, price_per_unit: 16, cost_per_unit: 9, carton_size: 24, low_stock_threshold: 12, active: true, image_url: 'https://images.unsplash.com/photo-1584225064785-c62a8b43d148?auto=format&fit=crop&w=900&q=80', created_at: new Date().toISOString(), updated_at: new Date().toISOString(), categories: beer, inventory_balances: { quantity_on_hand: 8 } },
  { id: '20000000-0000-0000-0000-000000000004', name: 'Coke', category_id: softDrink.id, price_per_unit: 5, cost_per_unit: 2.2, carton_size: 24, low_stock_threshold: 12, active: true, image_url: 'https://images.unsplash.com/photo-1554866585-cd94860890b7?auto=format&fit=crop&w=900&q=80', created_at: new Date().toISOString(), updated_at: new Date().toISOString(), categories: softDrink, inventory_balances: { quantity_on_hand: 48 } },
  { id: '20000000-0000-0000-0000-000000000005', name: '7Up', category_id: softDrink.id, price_per_unit: 5, cost_per_unit: 2.2, carton_size: 24, low_stock_threshold: 12, active: true, image_url: 'https://images.unsplash.com/photo-1622483767028-3f66f32aef97?auto=format&fit=crop&w=900&q=80', created_at: new Date().toISOString(), updated_at: new Date().toISOString(), categories: softDrink, inventory_balances: { quantity_on_hand: 36 } },
  { id: '20000000-0000-0000-0000-000000000006', name: 'Fanta', category_id: softDrink.id, price_per_unit: 5, cost_per_unit: 2.2, carton_size: 24, low_stock_threshold: 12, active: true, image_url: 'https://images.unsplash.com/photo-1581636625402-29b2a704ef13?auto=format&fit=crop&w=900&q=80', created_at: new Date().toISOString(), updated_at: new Date().toISOString(), categories: softDrink, inventory_balances: { quantity_on_hand: 24 } },
];

export const demoSales: Sale[] = [
  { id: '30000000-0000-0000-0000-000000000001', sale_number: 'S-20260503-0001', business_date: '2026-05-03', payment_method: 'cash', status: 'completed', total_amount: 29, paid_amount: 29, discount_amount: 0, order_taken_by: 'Chloe', complimentary_reason: null, qr_reference: null, qr_status: 'not_applicable', cashier_id: demoProfile.id, voided_by: null, void_reason: null, voided_at: null, idempotency_key: null, created_at: new Date().toISOString() },
  { id: '30000000-0000-0000-0000-000000000002', sale_number: 'S-20260503-0002', business_date: '2026-05-03', payment_method: 'qr', status: 'completed', total_amount: 28, paid_amount: 28, discount_amount: 0, order_taken_by: 'Happy', complimentary_reason: null, qr_reference: 'QR-8842', qr_payment_type: 'TnGo', qr_receipt_image_path: 'demo/qr-8842.jpg', qr_status: 'pending', cashier_id: demoProfile.id, voided_by: null, void_reason: null, voided_at: null, idempotency_key: null, created_at: new Date().toISOString() },
  { id: '30000000-0000-0000-0000-000000000003', sale_number: 'S-20260503-0003', business_date: '2026-05-03', payment_method: 'complimentary', status: 'completed', total_amount: 12, paid_amount: 0, discount_amount: 0, order_taken_by: 'Elle', complimentary_reason: 'Band drink', qr_reference: null, qr_status: 'not_applicable', cashier_id: demoProfile.id, voided_by: null, void_reason: null, voided_at: null, idempotency_key: null, created_at: new Date().toISOString() },
  { id: '30000000-0000-0000-0000-000000000004', sale_number: 'S-20260502-0001', business_date: '2026-05-02', payment_method: 'cash', status: 'completed', total_amount: 188, paid_amount: 188, discount_amount: 10, order_taken_by: 'Chloe', complimentary_reason: null, qr_reference: null, qr_status: 'not_applicable', cashier_id: demoProfile.id, voided_by: null, void_reason: null, voided_at: null, idempotency_key: null, created_at: new Date().toISOString() },
  { id: '30000000-0000-0000-0000-000000000005', sale_number: 'S-20260501-0001', business_date: '2026-05-01', payment_method: 'qr', status: 'completed', total_amount: 236, paid_amount: 236, discount_amount: 0, order_taken_by: 'NekoMiao', complimentary_reason: null, qr_reference: 'QR-7701', qr_status: 'verified', cashier_id: demoProfile.id, voided_by: null, void_reason: null, voided_at: null, idempotency_key: null, created_at: new Date().toISOString() },
  { id: '30000000-0000-0000-0000-000000000006', sale_number: 'S-20260430-0001', business_date: '2026-04-30', payment_method: 'complimentary', status: 'completed', total_amount: 42, paid_amount: 0, discount_amount: 0, order_taken_by: 'Happy', complimentary_reason: 'VIP guest', qr_reference: null, qr_status: 'not_applicable', cashier_id: demoProfile.id, voided_by: null, void_reason: null, voided_at: null, idempotency_key: null, created_at: new Date().toISOString() },
  { id: '30000000-0000-0000-0000-000000000007', sale_number: 'S-20260424-0001', business_date: '2026-04-24', payment_method: 'cash', status: 'completed', total_amount: 86, paid_amount: 86, discount_amount: 0, order_taken_by: 'Chloe', complimentary_reason: null, qr_reference: null, qr_status: 'not_applicable', cashier_id: demoProfile.id, voided_by: null, void_reason: null, voided_at: null, idempotency_key: null, created_at: '2026-04-24T15:40:00.000Z' },
  { id: '30000000-0000-0000-0000-000000000008', sale_number: 'S-20260418-0001', business_date: '2026-04-18', payment_method: 'qr', status: 'completed', total_amount: 112, paid_amount: 112, discount_amount: 8, order_taken_by: 'Elle', complimentary_reason: null, qr_reference: 'QR-6418', qr_status: 'verified', cashier_id: demoProfile.id, voided_by: null, void_reason: null, voided_at: null, idempotency_key: null, created_at: '2026-04-18T16:20:00.000Z' },
  { id: '30000000-0000-0000-0000-000000000009', sale_number: 'S-20260411-0001', business_date: '2026-04-11', payment_method: 'complimentary', status: 'completed', total_amount: 28, paid_amount: 0, discount_amount: 0, order_taken_by: 'Happy', complimentary_reason: 'Boss treat', qr_reference: null, qr_status: 'not_applicable', cashier_id: demoProfile.id, voided_by: null, void_reason: null, voided_at: null, idempotency_key: null, created_at: '2026-04-11T14:05:00.000Z' },
  { id: '30000000-0000-0000-0000-000000000010', sale_number: 'S-20260403-0001', business_date: '2026-04-03', payment_method: 'cash', status: 'completed', total_amount: 154, paid_amount: 154, discount_amount: 10, order_taken_by: 'NekoMiao', complimentary_reason: null, qr_reference: null, qr_status: 'not_applicable', cashier_id: demoProfile.id, voided_by: null, void_reason: null, voided_at: null, idempotency_key: null, created_at: '2026-04-03T15:30:00.000Z' },
  { id: '30000000-0000-0000-0000-000000000011', sale_number: 'S-20260328-0001', business_date: '2026-03-28', payment_method: 'qr', status: 'completed', total_amount: 96, paid_amount: 96, discount_amount: 0, order_taken_by: 'Chloe', complimentary_reason: null, qr_reference: 'QR-3328', qr_status: 'verified', cashier_id: demoProfile.id, voided_by: null, void_reason: null, voided_at: null, idempotency_key: null, created_at: '2026-03-28T13:10:00.000Z' },
  { id: '30000000-0000-0000-0000-000000000012', sale_number: 'S-20260320-0001', business_date: '2026-03-20', payment_method: 'cash', status: 'completed', total_amount: 74, paid_amount: 74, discount_amount: 0, order_taken_by: 'Elle', complimentary_reason: null, qr_reference: null, qr_status: 'not_applicable', cashier_id: demoProfile.id, voided_by: null, void_reason: null, voided_at: null, idempotency_key: null, created_at: '2026-03-20T12:50:00.000Z' },
  { id: '30000000-0000-0000-0000-000000000013', sale_number: 'S-20260314-0001', business_date: '2026-03-14', payment_method: 'complimentary', status: 'completed', total_amount: 18, paid_amount: 0, discount_amount: 0, order_taken_by: 'NekoMiao', complimentary_reason: 'Supplier sample', qr_reference: null, qr_status: 'not_applicable', cashier_id: demoProfile.id, voided_by: null, void_reason: null, voided_at: null, idempotency_key: null, created_at: '2026-03-14T17:00:00.000Z' },
  { id: '30000000-0000-0000-0000-000000000014', sale_number: 'S-20260306-0001', business_date: '2026-03-06', payment_method: 'qr', status: 'completed', total_amount: 132, paid_amount: 132, discount_amount: 12, order_taken_by: 'Happy', complimentary_reason: null, qr_reference: 'QR-3006', qr_status: 'verified', cashier_id: demoProfile.id, voided_by: null, void_reason: null, voided_at: null, idempotency_key: null, created_at: '2026-03-06T16:45:00.000Z' },
];

export const demoSaleItems: SaleItem[] = [
  { id: '40000000-0000-0000-0000-000000000001', sale_id: demoSales[0].id, product_id: demoProducts[0].id, quantity: 2, unit_price: 12, line_total: 24, created_at: new Date().toISOString(), products: { name: '1602 Lager' } },
  { id: '40000000-0000-0000-0000-000000000002', sale_id: demoSales[0].id, product_id: demoProducts[3].id, quantity: 1, unit_price: 5, line_total: 5, created_at: new Date().toISOString(), products: { name: 'Coke' } },
  { id: '40000000-0000-0000-0000-000000000003', sale_id: demoSales[1].id, product_id: demoProducts[1].id, quantity: 2, unit_price: 14, line_total: 28, created_at: new Date().toISOString(), products: { name: '1602 Pale Ale' } },
  { id: '40000000-0000-0000-0000-000000000004', sale_id: demoSales[2].id, product_id: demoProducts[0].id, quantity: 1, unit_price: 12, line_total: 12, created_at: new Date().toISOString(), products: { name: '1602 Lager' } },
  { id: '40000000-0000-0000-0000-000000000005', sale_id: demoSales[6].id, product_id: demoProducts[2].id, quantity: 3, unit_price: 16, line_total: 48, created_at: '2026-04-24T15:40:00.000Z', products: { name: '1602 Extra Dark' } },
  { id: '40000000-0000-0000-0000-000000000006', sale_id: demoSales[6].id, product_id: demoProducts[3].id, quantity: 2, unit_price: 5, line_total: 10, created_at: '2026-04-24T15:40:00.000Z', products: { name: 'Coke' } },
  { id: '40000000-0000-0000-0000-000000000007', sale_id: demoSales[7].id, product_id: demoProducts[1].id, quantity: 4, unit_price: 14, line_total: 56, created_at: '2026-04-18T16:20:00.000Z', products: { name: '1602 Pale Ale' } },
  { id: '40000000-0000-0000-0000-000000000008', sale_id: demoSales[7].id, product_id: demoProducts[5].id, quantity: 3, unit_price: 5, line_total: 15, created_at: '2026-04-18T16:20:00.000Z', products: { name: 'Fanta' } },
  { id: '40000000-0000-0000-0000-000000000009', sale_id: demoSales[8].id, product_id: demoProducts[1].id, quantity: 2, unit_price: 14, line_total: 28, created_at: '2026-04-11T14:05:00.000Z', products: { name: '1602 Pale Ale' } },
  { id: '40000000-0000-0000-0000-000000000010', sale_id: demoSales[9].id, product_id: demoProducts[0].id, quantity: 6, unit_price: 12, line_total: 72, created_at: '2026-04-03T15:30:00.000Z', products: { name: '1602 Lager' } },
  { id: '40000000-0000-0000-0000-000000000011', sale_id: demoSales[10].id, product_id: demoProducts[2].id, quantity: 3, unit_price: 16, line_total: 48, created_at: '2026-03-28T13:10:00.000Z', products: { name: '1602 Extra Dark' } },
  { id: '40000000-0000-0000-0000-000000000012', sale_id: demoSales[11].id, product_id: demoProducts[4].id, quantity: 4, unit_price: 5, line_total: 20, created_at: '2026-03-20T12:50:00.000Z', products: { name: '7Up' } },
  { id: '40000000-0000-0000-0000-000000000013', sale_id: demoSales[12].id, product_id: demoProducts[5].id, quantity: 3, unit_price: 5, line_total: 15, created_at: '2026-03-14T17:00:00.000Z', products: { name: 'Fanta' } },
  { id: '40000000-0000-0000-0000-000000000014', sale_id: demoSales[13].id, product_id: demoProducts[0].id, quantity: 5, unit_price: 12, line_total: 60, created_at: '2026-03-06T16:45:00.000Z', products: { name: '1602 Lager' } },
];

export const demoMovements: StockMovement[] = [
  { id: '50000000-0000-0000-0000-000000000001', product_id: demoProducts[0].id, movement_type: 'stock_in', quantity_change: 48, quantity_before: 24, quantity_after: 72, unit_input: 'carton', input_quantity: 2, carton_size_at_time: 24, reference_type: 'stock_in', reference_id: null, reason: 'ABC Supplier / INV-1001', notes: 'Demo stock-in', entered_by: 'Chloe', created_by: demoProfile.id, created_at: '2026-05-03T09:00:00.000Z', products: { name: '1602 Lager' } },
  { id: '50000000-0000-0000-0000-000000000002', product_id: demoProducts[0].id, movement_type: 'sale', quantity_change: -2, quantity_before: 74, quantity_after: 72, unit_input: 'system', input_quantity: 2, carton_size_at_time: 24, reference_type: 'sale', reference_id: demoSales[0].id, reason: null, notes: null, entered_by: 'Chloe', created_by: demoProfile.id, created_at: '2026-05-03T15:30:00.000Z', products: { name: '1602 Lager' } },
  { id: '50000000-0000-0000-0000-000000000003', product_id: demoProducts[3].id, movement_type: 'stock_in', quantity_change: 72, quantity_before: 12, quantity_after: 84, unit_input: 'carton', input_quantity: 3, carton_size_at_time: 24, reference_type: 'stock_in', reference_id: null, reason: 'Soft drink supplier / SD-2201', notes: 'Weekend restock', entered_by: 'Happy', created_by: demoProfile.id, created_at: '2026-04-29T08:45:00.000Z', products: { name: 'Coke' } },
  { id: '50000000-0000-0000-0000-000000000004', product_id: demoProducts[2].id, movement_type: 'sale', quantity_change: -3, quantity_before: 42, quantity_after: 39, unit_input: 'system', input_quantity: 3, carton_size_at_time: 24, reference_type: 'sale', reference_id: demoSales[6].id, reason: null, notes: null, entered_by: 'Chloe', created_by: demoProfile.id, created_at: '2026-04-24T15:40:00.000Z', products: { name: '1602 Extra Dark' } },
  { id: '50000000-0000-0000-0000-000000000005', product_id: demoProducts[1].id, movement_type: 'stock_in', quantity_change: 24, quantity_before: 18, quantity_after: 42, unit_input: 'carton', input_quantity: 1, carton_size_at_time: 24, reference_type: 'stock_in', reference_id: null, reason: 'Brewery / BEER-0418', notes: 'Pale Ale top up', entered_by: 'Elle', created_by: demoProfile.id, created_at: '2026-04-18T08:15:00.000Z', products: { name: '1602 Pale Ale' } },
  { id: '50000000-0000-0000-0000-000000000006', product_id: demoProducts[1].id, movement_type: 'complimentary', quantity_change: -2, quantity_before: 42, quantity_after: 40, unit_input: 'system', input_quantity: 2, carton_size_at_time: 24, reference_type: 'sale', reference_id: demoSales[8].id, reason: 'Boss treat', notes: null, entered_by: 'Happy', created_by: demoProfile.id, created_at: '2026-04-11T14:05:00.000Z', products: { name: '1602 Pale Ale' } },
  { id: '50000000-0000-0000-0000-000000000007', product_id: demoProducts[5].id, movement_type: 'stock_in', quantity_change: 48, quantity_before: 10, quantity_after: 58, unit_input: 'carton', input_quantity: 2, carton_size_at_time: 24, reference_type: 'stock_in', reference_id: null, reason: 'Soft drink supplier / SD-1888', notes: 'Fanta add-on', entered_by: 'NekoMiao', created_by: demoProfile.id, created_at: '2026-04-05T10:20:00.000Z', products: { name: 'Fanta' } },
  { id: '50000000-0000-0000-0000-000000000008', product_id: demoProducts[0].id, movement_type: 'sale', quantity_change: -6, quantity_before: 80, quantity_after: 74, unit_input: 'system', input_quantity: 6, carton_size_at_time: 24, reference_type: 'sale', reference_id: demoSales[9].id, reason: null, notes: null, entered_by: 'NekoMiao', created_by: demoProfile.id, created_at: '2026-04-03T15:30:00.000Z', products: { name: '1602 Lager' } },
  { id: '50000000-0000-0000-0000-000000000009', product_id: demoProducts[2].id, movement_type: 'stock_in', quantity_change: 36, quantity_before: 6, quantity_after: 42, unit_input: 'can', input_quantity: 36, carton_size_at_time: 24, reference_type: 'stock_in', reference_id: null, reason: 'Brewery / DARK-0328', notes: 'Loose cans', entered_by: 'Chloe', created_by: demoProfile.id, created_at: '2026-03-28T09:05:00.000Z', products: { name: '1602 Extra Dark' } },
  { id: '50000000-0000-0000-0000-000000000010', product_id: demoProducts[4].id, movement_type: 'sale', quantity_change: -4, quantity_before: 40, quantity_after: 36, unit_input: 'system', input_quantity: 4, carton_size_at_time: 24, reference_type: 'sale', reference_id: demoSales[11].id, reason: null, notes: null, entered_by: 'Elle', created_by: demoProfile.id, created_at: '2026-03-20T12:50:00.000Z', products: { name: '7Up' } },
  { id: '50000000-0000-0000-0000-000000000011', product_id: demoProducts[4].id, movement_type: 'stock_in', quantity_change: 48, quantity_before: 8, quantity_after: 56, unit_input: 'carton', input_quantity: 2, carton_size_at_time: 24, reference_type: 'stock_in', reference_id: null, reason: 'Soft drink supplier / SD-0315', notes: '7Up restock', entered_by: 'Happy', created_by: demoProfile.id, created_at: '2026-03-15T09:30:00.000Z', products: { name: '7Up' } },
  { id: '50000000-0000-0000-0000-000000000012', product_id: demoProducts[5].id, movement_type: 'complimentary', quantity_change: -3, quantity_before: 30, quantity_after: 27, unit_input: 'system', input_quantity: 3, carton_size_at_time: 24, reference_type: 'sale', reference_id: demoSales[12].id, reason: 'Supplier sample', notes: null, entered_by: 'NekoMiao', created_by: demoProfile.id, created_at: '2026-03-14T17:00:00.000Z', products: { name: 'Fanta' } },
  { id: '50000000-0000-0000-0000-000000000013', product_id: demoProducts[0].id, movement_type: 'stock_in', quantity_change: 96, quantity_before: 12, quantity_after: 108, unit_input: 'carton', input_quantity: 4, carton_size_at_time: 24, reference_type: 'stock_in', reference_id: null, reason: 'Brewery / LAG-0306', notes: 'Start of month stock', entered_by: 'Elle', created_by: demoProfile.id, created_at: '2026-03-06T08:10:00.000Z', products: { name: '1602 Lager' } },
  { id: '50000000-0000-0000-0000-000000000014', product_id: demoProducts[0].id, movement_type: 'sale', quantity_change: -5, quantity_before: 108, quantity_after: 103, unit_input: 'system', input_quantity: 5, carton_size_at_time: 24, reference_type: 'sale', reference_id: demoSales[13].id, reason: null, notes: null, entered_by: 'Happy', created_by: demoProfile.id, created_at: '2026-03-06T16:45:00.000Z', products: { name: '1602 Lager' } },
];

export const demoReport: DailyReport = {
  id: '60000000-0000-0000-0000-000000000001',
  business_date: '2026-05-03',
  report_json: { demo: true },
  total_cash: 29,
  total_qr: 28,
  total_complimentary_value: 12,
  total_sales: 57,
  actual_cash_counted: 129,
  expected_cash: 129,
  cash_variance: 0,
  closed_by: demoProfile.id,
  closed_at: new Date().toISOString(),
  reopened_by: null,
  reopened_at: null,
  status: 'closed',
  notes: 'Demo report',
};

export const demoReports: DailyReport[] = [
  demoReport,
  { ...demoReport, id: '60000000-0000-0000-0000-000000000004', business_date: '2026-05-02', total_cash: 188, total_qr: 96, total_complimentary_value: 24, total_sales: 284, actual_cash_counted: 288, expected_cash: 288, cash_variance: 0, notes: 'Saturday sample' },
  { ...demoReport, id: '60000000-0000-0000-0000-000000000002', business_date: '2026-05-01', total_cash: 124, total_qr: 236, total_complimentary_value: 18, total_sales: 360, actual_cash_counted: 224, expected_cash: 224, cash_variance: 0, notes: 'Busy Friday sample' },
  { ...demoReport, id: '60000000-0000-0000-0000-000000000003', business_date: '2026-04-30', total_cash: 96, total_qr: 142, total_complimentary_value: 42, total_sales: 238, actual_cash_counted: 196, expected_cash: 196, cash_variance: 0, notes: 'VIP FOC sample' },
];

export const demoItemSales = [
  { product: '1602 Lager', quantity: 18, cash: 96, qr: 84, focCost: 36 },
  { product: '1602 Pale Ale', quantity: 12, cash: 70, qr: 70, focCost: 28 },
  { product: '1602 Extra Dark', quantity: 7, cash: 64, qr: 32, focCost: 16 },
  { product: 'Coke', quantity: 14, cash: 35, qr: 25, focCost: 10 },
  { product: '7Up', quantity: 9, cash: 25, qr: 15, focCost: 5 },
  { product: 'Fanta', quantity: 6, cash: 15, qr: 10, focCost: 5 },
  { product: 'Custom Order', quantity: 3, cash: 78, qr: 40, focCost: 0 },
];
