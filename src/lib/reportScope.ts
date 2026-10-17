import type { AccountReportArchive } from './types';

export const barReportScope = ['Bar sales, closing, voids and bar stock only. Purchases and kitchen usage are separate.', 'Jualan bar, penutupan, batal dan stok bar sahaja. Belian dan penggunaan dapur berasingan.'] as const;
export const operationsReportScope = ['Saved bar and kitchen stock/usage snapshot. Purchase receipts and supplier payments are not included.', 'Snapshot tersimpan bagi bar, stok dan penggunaan dapur. Resit belian dan bayaran pembekal tidak termasuk.'] as const;

export function reportDownloadName(scope: 'bar' | 'operations', kind: string, start: string, end: string) {
  const period = start === end ? start : `${start}_to_${end}`;
  return `lovely-paradise_${scope}_${kind}_report_${period}.pdf`;
}

export function archiveDownloadName(report: Pick<AccountReportArchive, 'report_kind' | 'period_start' | 'period_end'>) {
  return reportDownloadName('operations', report.report_kind, report.period_start, report.period_end);
}
