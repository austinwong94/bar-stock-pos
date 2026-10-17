import { db, require as requirePermission, can, currentUserIdRef } from './demoBackend';
import { deliveryIssueInput, receiptDeliveryIssueInput } from './deliveryIssues';
import { demoReceiptDeliveryHandlers } from './demoReceiptDelivery';
import { receivedQuantity } from './purchasingProgress';
import type { DeliveryIssue } from './deliveryIssues';

function fail(message: string, code = 'P0001'): never { throw Object.assign(new Error(message), { code }); }
const actorName = () => db.profiles.find(p => p.id === currentUserIdRef.value)?.full_name ?? 'Staff';
const ensure = () => { db.delivery_issues ??= []; };
const updatesFor = (id: string) => db.audit_logs.filter(a => a.entity_type === 'delivery_issue' && a.entity_id === id && a.action === 'delivery_issue_updated')
  .map(a => a.after_json).sort((a,b) => b.version - a.version);
function withUpdates(row: Record<string, any>) {
  const { payload, ...safe } = row, updates = updatesFor(row.id);
  return structuredClone({ ...safe, latest_update: updates[0] ?? null, update_count: updates.length });
}
export const demoDeliveryIssueHandlers: Record<string, (args: any) => any> = {
  read_delivery_source_issues: ({ p_request_id = null, p_receipt_id = null }) => {
    requirePermission('purchasing.view'); ensure();
    if ((p_request_id === null) === (p_receipt_id === null)) fail('Choose one delivery source.');
    return db.delivery_issues.filter(i => i.status === 'open' && (p_request_id ? i.request_id === p_request_id : i.receipt_id === p_receipt_id))
      .sort((a,b) => a.created_at.localeCompare(b.created_at) || a.id.localeCompare(b.id)).map(withUpdates);
  },
  add_delivery_issue_update: ({ p_id, p_issue_id, p_version, p_note }) => {
    if (!can('purchasing.fulfil') && !can('purchasing.manage')) fail('Purchasing access required.', '42501');
    ensure();
    if (!p_id || typeof p_note !== 'string' || !p_note.trim() || p_note.trim().length > 500 || !Number.isInteger(p_version) || p_version < 1) fail('Enter an update (up to 500 characters).');
    const prior = db.audit_logs.find(a => a.id === p_id);
    if (prior) {
      if (prior.actor_id !== currentUserIdRef.value || prior.entity_id !== p_issue_id || prior.action !== 'delivery_issue_updated' || prior.before_json.version !== p_version || prior.after_json.note !== p_note.trim()) fail('This update ID was already used with different details.', '40001');
      return structuredClone(prior.after_json);
    }
    const row = db.delivery_issues.find(i => i.id === p_issue_id);
    if (!row || row.status !== 'open' || row.version !== p_version) fail('This issue changed. Reopen it before adding an update.', '40001');
    const { payload, ...before } = structuredClone(row);
    row.version++;
    const update = { id: p_id, issue_id: row.id, version: row.version, note: p_note.trim(), created_by: currentUserIdRef.value, created_by_name: actorName(), created_at: new Date().toISOString() };
    db.audit_logs.push({ id: p_id, actor_id: currentUserIdRef.value, action: 'delivery_issue_updated', entity_type: 'delivery_issue', entity_id: row.id, before_json: before, after_json: update, created_at: update.created_at });
    return structuredClone(update);
  },
  read_delivery_issue_updates: ({ p_issue_id, p_limit = 5, p_offset = 0 }) => {
    requirePermission('purchasing.view'); ensure();
    if (!Number.isInteger(p_limit) || p_limit < 1 || p_limit > 50 || !Number.isInteger(p_offset) || p_offset < 0) fail('Invalid update page.');
    const issue = db.delivery_issues.find(i => i.id === p_issue_id); if (!issue) fail('Delivery issue not found.');
    const updates = updatesFor(issue.id);
    return { issue: withUpdates(issue), total: updates.length, records: structuredClone(updates.slice(p_offset, p_offset+p_limit)) };
  },
  read_receipt_delivery_issue: ({ p_receipt_id, p_draft_id }) => {
    requirePermission('purchasing.receive'); ensure();
    const { request } = demoReceiptDeliveryHandlers.read_receipt_delivery({ p_request_id: p_receipt_id });
    const sent = db.delivery_issues.find(i => i.id === p_draft_id && i.receipt_id === p_receipt_id);
    const { payload, ...safe } = sent ?? {};
    return { ...request, saved_issue: sent ? structuredClone(safe) : null,
      removed_draft: db.audit_logs.find(a => a.entity_id === p_draft_id && a.entity_type === 'delivery_issue_draft' && a.action === 'delivery_issue_draft_removed' && a.actor_id === currentUserIdRef.value)?.after_json ?? null };
  },
  report_receipt_delivery_issue: ({ p_id, p_receipt_id, p_data }) => {
    requirePermission('purchasing.receive'); ensure();
    if (db.audit_logs.some(r => r.entity_type === 'delivery_issue_draft' && r.entity_id === p_id && r.action === 'delivery_issue_draft_removed')) fail('This unsent report was removed. Start a new report.', '40001');
    const input = receiptDeliveryIssueInput.parse(p_data), payload = JSON.stringify(input);
    const old = db.delivery_issues.find(r => r.id === p_id);
    if (old) {
      if (old.created_by !== currentUserIdRef.value || old.receipt_id !== p_receipt_id || old.payload !== payload) fail('This report ID was already used. Reopen the issue.');
      const { payload: _, ...saved } = old; return structuredClone(saved);
    }
    const { request } = demoReceiptDeliveryHandlers.read_receipt_delivery({ p_request_id: p_receipt_id });
    const receipt = db.expense_receipts.find(r => r.id === p_receipt_id);
    const item = request.purchase_request_items.find((r: any) => r.id === input.item_id);
    const received = item ? receivedQuantity(item) : 0;
    if (!item || receipt?.status !== 'confirmed' || item.updated_at !== input.expected_updated_at || Math.abs(received - input.expected_received_quantity) > 0.000001) fail('Delivery changed. Reopen the receipt before reporting.', '40001');
    if (input.quantity > Math.round((Number(item.purchased_quantity) - received) * 10000) / 10000) fail('Issue quantity cannot exceed the goods still to receive.');
    if (db.delivery_issues.some(r => r.receipt_id === p_receipt_id && r.receipt_line_id === item.id && r.status === 'open')) fail('This item already has an open issue. Check Delivery Issues.', '40001');
    const report: DeliveryIssue = { id: p_id, request_id: null, item_id: null, receipt_id: p_receipt_id, receipt_line_id: item.id,
      request_no: request.request_no, item_name: item.item_name, unit: item.unit, supplier: request.supplier,
      kind: input.kind, quantity: input.quantity, note: input.note, status: 'open', version: 1,
      created_by: currentUserIdRef.value!, created_by_name: actorName(), created_at: new Date().toISOString(),
      closed_by: null, closed_by_name: null, closed_at: null, resolution: null };
    db.delivery_issues.push({ ...report, payload });
    db.audit_logs.push({ id: crypto.randomUUID(), actor_id: currentUserIdRef.value, action: 'delivery_issue_reported', entity_type: 'delivery_issue', entity_id: p_id, before_json: null, after_json: structuredClone(report), created_at: report.created_at });
    return structuredClone(report);
  },
  read_delivery_issue_request: ({ p_request_id, p_draft_id }) => {
    requirePermission('purchasing.view'); ensure();
    const r = db.purchase_requests.find(r => r.id === p_request_id); if (!r) fail('Purchase request not found.');
    const sent = db.delivery_issues.find(i=>i.id===p_draft_id&&i.request_id===p_request_id);
    const {payload,...safe}=sent??{};
    return { id: r.id, request_no: r.request_no, status: r.status, needed_for_date: r.needed_for_date,
      saved_issue: sent?structuredClone(safe):null,
      removed_draft: db.audit_logs.find(a=>a.entity_id===p_draft_id&&a.entity_type==='delivery_issue_draft'&&a.action==='delivery_issue_draft_removed'&&a.actor_id===currentUserIdRef.value)?.after_json??null,
      purchase_request_items: db.purchase_request_items.filter(i => i.request_id === r.id).map(i => ({
        id: i.id, request_id: i.request_id, item_name: i.item_name, unit: i.unit, quantity: i.quantity,
        purchased_quantity: i.purchased_quantity, purchase_status: i.purchase_status, supplier: i.supplier,
        sort_order: i.sort_order, updated_at: i.updated_at,
        purchase_receipts: (db.purchase_receipts ?? []).filter(p => p.purchase_item_id === i.id).map(p => ({ purchase_quantity: p.purchase_quantity })),
      })) };
  },
  report_delivery_issue: ({ p_id, p_data }) => {
    requirePermission('purchasing.receive'); ensure();
    if (db.audit_logs.some(r => r.entity_type === 'delivery_issue_draft' && r.entity_id === p_id && r.action === 'delivery_issue_draft_removed')) fail('This unsent report was removed. Start a new report.', '40001');
    const input = deliveryIssueInput.parse(p_data), payload = JSON.stringify(input);
    const old = db.delivery_issues.find(r => r.id === p_id);
    if (old) {
      if (old.receipt_id || old.created_by !== currentUserIdRef.value || old.payload !== payload) fail('This report ID was already used. Reopen the issue.');
      const { payload: _, ...saved } = old; return structuredClone(saved);
    }
    const item = db.purchase_request_items.find(r => r.id === input.item_id);
    const request = item && db.purchase_requests.find(r => r.id === item.request_id);
    const received = (db.purchase_receipts ?? []).filter(r => r.purchase_item_id === input.item_id).reduce((n, r) => n + Number(r.purchase_quantity), 0);
    if (!item || !request || !['submitted', 'buying', 'completed'].includes(request.status) || item.purchase_status !== 'bought'
      || item.updated_at !== input.expected_updated_at || Math.abs(received - input.expected_received_quantity) > 0.000001) fail('Delivery changed. Reopen the request before reporting.', '40001');
    if (input.quantity > Math.round((Number(item.purchased_quantity) - received) * 100) / 100) fail('Issue quantity cannot exceed the goods still to receive.');
    if (db.delivery_issues.some(r => r.item_id === item.id && r.status === 'open')) fail('This item already has an open issue. Check Delivery Issues.', '40001');
    const report: DeliveryIssue = { id: p_id, request_id: request.id, request_no: request.request_no, item_id: item.id, item_name: item.item_name,
      unit: item.unit, supplier: item.supplier ?? null, kind: input.kind, quantity: input.quantity, note: input.note,
      status: 'open', version: 1, created_by: currentUserIdRef.value!, created_by_name: actorName(), created_at: new Date().toISOString(),
      closed_by: null, closed_by_name: null, closed_at: null, resolution: null };
    db.delivery_issues.push({ ...report, payload });
    db.audit_logs.push({ id: crypto.randomUUID(), actor_id: currentUserIdRef.value, action: 'delivery_issue_reported', entity_type: 'delivery_issue', entity_id: p_id, before_json: null, after_json: structuredClone(report), created_at: report.created_at });
    return structuredClone(report);
  },
  close_delivery_issue: ({ p_id, p_version, p_resolution }) => {
    if (!can('purchasing.fulfil') && !can('purchasing.manage')) fail('Purchasing access required.', '42501');
    ensure(); const row = db.delivery_issues.find(r => r.id === p_id);
    if (!row) fail('Delivery issue not found.');
    if (typeof p_resolution !== 'string' || !p_resolution.trim() || p_resolution.trim().length > 500) fail('Record the follow-up (up to 500 characters).');
    if (row.status === 'closed' && row.closed_by === currentUserIdRef.value && row.resolution === p_resolution.trim()) { const { payload, ...saved } = row; return structuredClone(saved); }
    if (row.status !== 'open' || row.version !== p_version) fail('This issue changed. Reopen it before closing.', '40001');
    const { payload, ...before } = structuredClone(row);
    Object.assign(row, { status: 'closed', version: row.version + 1, closed_by: currentUserIdRef.value, closed_by_name: actorName(), closed_at: new Date().toISOString(), resolution: p_resolution.trim() });
    const { payload: _, ...result } = row;
    db.audit_logs.push({ id: crypto.randomUUID(), actor_id: currentUserIdRef.value, action: 'delivery_issue_closed', entity_type: 'delivery_issue', entity_id: p_id, before_json: before, after_json: structuredClone(result), created_at: row.closed_at });
    return structuredClone(result);
  },
  read_delivery_issues: ({ p_status = 'open', p_limit = 5, p_offset = 0 }) => {
    requirePermission('purchasing.view'); ensure();
    if (!['open', 'closed'].includes(p_status) || !Number.isInteger(p_limit) || p_limit < 1 || p_limit > 50 || !Number.isInteger(p_offset) || p_offset < 0) fail('Invalid issue page.');
    const all = db.delivery_issues.filter(r => r.status === p_status).sort((a, b) => b.created_at.localeCompare(a.created_at) || b.id.localeCompare(a.id));
    return { total: all.length, open: db.delivery_issues.filter(r => r.status === 'open').length, closed: db.delivery_issues.filter(r => r.status === 'closed').length,
      records: all.slice(p_offset, p_offset + p_limit).map(withUpdates) };
  },
  remove_delivery_issue_draft: ({ p_id, p_data, p_reason }) => {
    requirePermission('purchasing.receive'); ensure();
    if (!p_id || !p_data || typeof p_data !== 'object' || JSON.stringify(p_data).length > 16000 || typeof p_reason !== 'string' || !p_reason.trim() || p_reason.trim().length > 500) fail('Enter a removal reason (up to 500 characters).');
    if (db.delivery_issues.some(r => r.id === p_id)) fail('This report was sent. Use the recorded issue and follow-up instead.', '40001');
    const prior = db.audit_logs.find(r => r.entity_type === 'delivery_issue_draft' && r.entity_id === p_id && r.action === 'delivery_issue_draft_removed');
    if (prior) {
      if (prior.actor_id !== currentUserIdRef.value || JSON.stringify(prior.before_json) !== JSON.stringify(p_data) || prior.after_json.reason !== p_reason.trim()) fail('This removal was already recorded with different details.', '40001');
      return structuredClone(prior.after_json);
    }
    const result = { removed_at: new Date().toISOString(), removed_by: currentUserIdRef.value, removed_by_name: actorName(), reason: p_reason.trim(), request_no: p_data.request_no };
    db.audit_logs.push({ id: crypto.randomUUID(), actor_id: currentUserIdRef.value, action: 'delivery_issue_draft_removed', entity_type: 'delivery_issue_draft', entity_id: p_id, before_json: structuredClone(p_data), after_json: result, created_at: result.removed_at });
    return structuredClone(result);
  },
};
