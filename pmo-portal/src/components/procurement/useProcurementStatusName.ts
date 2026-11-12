import { useTranslation } from 'react-i18next';
import { statusLabel } from '@/src/lib/status/statusMap';

/** The same name as plain text, for filters, menus and export columns. */
export function useProcurementStatusName(): (status: string) => string {
  const { t } = useTranslation('status');
  return (status) => statusLabel('procurement', status, t);
}
