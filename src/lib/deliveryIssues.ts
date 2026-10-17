import { z } from 'zod';

export const deliveryIssueKinds = ['delayed', 'missing', 'damaged'] as const;
export const deliveryIssueLabels = {
  delayed: ['Arriving Later', 'Sampai Kemudian'],
  missing: ['Missing', 'Tidak Sampai'],
  damaged: ['Damaged / Rejected', 'Rosak / Ditolak'],
} as const;
export const deliveryIssueInput = z.object({
  item_id: z.string().min(1),
  kind: z.enum(deliveryIssueKinds),
  quantity: z.number().finite().positive().max(999999).refine(n => Math.abs(n * 100 - Math.round(n * 100)) < 0.000001),
  note: z.string().trim().max(500),
  expected_updated_at: z.string().min(1),
  expected_received_quantity: z.number().finite().nonnegative(),
});
export const receiptDeliveryIssueInput = deliveryIssueInput.extend({
  quantity: z.number().finite().positive().max(999999).refine(n => Math.abs(n * 10000 - Math.round(n * 10000)) < 0.000001),
});
export type DeliveryIssueInput = z.infer<typeof deliveryIssueInput>;
export type DeliveryIssueUpdate = {
  id: string; issue_id: string; version: number; note: string;
  created_by: string; created_by_name: string; created_at: string;
};
export type DeliveryIssue = {
  id: string; request_id: string | null; request_no: string; item_id: string | null;
  receipt_id?: string | null; receipt_line_id?: string | null;
  item_name: string; unit: string; supplier: string | null;
  kind: typeof deliveryIssueKinds[number]; quantity: number; note: string;
  status: 'open' | 'closed'; version: number;
  created_by: string; created_by_name: string; created_at: string;
  closed_by: string | null; closed_by_name: string | null; closed_at: string | null; resolution: string | null;
  latest_update?: DeliveryIssueUpdate | null; update_count?: number;
};
