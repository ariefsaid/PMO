import { useTranslation } from 'react-i18next';
import { statusLabel } from '@/src/lib/status/statusMap';

/** The same name as plain text, for filters, menus and export columns. */
export function useProcurementStatusName(): (status: string) => string {
  const { t } = useTranslation(['status', 'procurementRecord']);
  return (status) => (status === 'Rejected'
    ? t('procurementRecord:status.returned', 'Returned')
    : statusLabel('procurement', status, t));
}
