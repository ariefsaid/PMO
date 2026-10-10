import { useTranslation } from 'react-i18next';
import { formatDateOnly } from '@/src/lib/format';
import type { BillRow } from '@/src/lib/db/vendorWithholdingSlips';

export interface VendorWithholdingSlipCellProps {
  row?: BillRow;
  isLoading?: boolean;
  isError?: boolean;
  canWrite?: boolean;
  onRetry?: () => void;
  onRecord?: () => void;
  onView?: (slipId: string) => void;
  onHistory?: () => void;
  vendorMissing?: boolean;
  onSetVendor?: () => void;
}

export function VendorWithholdingSlipCell({ row, isLoading = false, isError = false, canWrite = false, onRetry, onRecord, onView, onHistory, vendorMissing = false, onSetVendor }: VendorWithholdingSlipCellProps) {
  const { t } = useTranslation();
  if (isLoading) return <span className="text-xs text-muted-foreground" role="status">{t('bupot.loading', 'Loading bukti potong…')}</span>;
  if (isError) return <span className="inline-flex items-center gap-1 text-xs text-destructive">{t('bupot.loadError', 'Bukti potong unavailable')} <button type="button" className="underline" onClick={onRetry}>{t('admin.retry', 'Retry')}</button></span>;
  if (!row) return <span className="text-xs text-muted-foreground">{t('bupot.unavailable', 'Unavailable')}</span>;
  const labels: Record<string, string> = {
    slipped: t('bupot.state.slipped', 'Slipped'), 'needs-review': t('bupot.state.needsReview', 'Needs review'),
    unavailable: t('bupot.state.unavailable', 'Unavailable'), 'not-recorded': t('bupot.state.notRecorded', 'Not recorded'),
    'not-required': t('bupot.state.notRequired', 'Not required'), 'return-review': t('bupot.state.returnReview', 'Return review'),
  };
  const isActive = Boolean(row.active_slip_id);
  return <div className="flex max-w-[14rem] flex-col items-end gap-0.5 text-right text-xs">
    <span className={row.coverage_state === 'needs-review' ? 'font-medium text-foreground' : 'text-muted-foreground'}>{labels[row.coverage_state] ?? labels.unavailable}</span>
    {isActive && <>
      <span className="max-w-full break-all font-mono">{row.slip_number ?? ''}</span>
      {row.slip_date && <span className="text-muted-foreground">{formatDateOnly(row.slip_date)}</span>}
      <button type="button" className="touch-target inline-flex items-center justify-center underline underline-offset-2 max-[767px]:min-h-11" onClick={() => onView?.(row.active_slip_id!)}>{t('bupot.view', 'View bukti potong')}</button>
    </>}
    {!isActive && row.coverage_state === 'not-recorded' && vendorMissing && <>
      <span className="text-muted-foreground">{t('bupot.vendorRequired', 'Set a vendor on the request before recording this slip.')}</span>
      {onSetVendor && <button type="button" className="touch-target inline-flex items-center justify-center underline underline-offset-2 max-[767px]:min-h-11" onClick={onSetVendor}>{t('bupot.setVendor', 'Set vendor')}</button>}
    </>}
    {!isActive && row.coverage_state === 'not-recorded' && canWrite && !vendorMissing && <button type="button" className="touch-target inline-flex items-center justify-center underline underline-offset-2 max-[767px]:min-h-11" onClick={onRecord}>{t('bupot.record', 'Record bukti potong')}</button>}
    {onHistory && <button type="button" className="touch-target inline-flex items-center justify-center underline underline-offset-2 max-[767px]:min-h-11" onClick={onHistory}>{t('bupot.history', 'Bukti potong history')}</button>}
  </div>;
}
