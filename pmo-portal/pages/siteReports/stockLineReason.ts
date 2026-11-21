import type { DsrStockLine } from '@/src/lib/db/dsrStockIssue';

/** The plain-words reason for a flagged line (#2676 FR-DRS-031). A failed line shows the engine's reason code as written by the database. */
export function stockLineReason(t: (k: string, o?: Record<string, unknown>) => string, l: DsrStockLine, location: string | null): string {
  switch (l.state) {
    case 'short': return t('stock.reason.short', { n: l.shortBy ?? '', location: location ?? '' });
    case 'no_location': return t('stock.reason.noLocation');
    case 'no_work_item': return t('stock.reason.noWorkItem');
    case 'failed': return t('stock.reason.failed', { reason: l.reason ?? '' });
    case 'not_stocked': return t('stock.reason.notStocked');
    default: return '';
  }
}
