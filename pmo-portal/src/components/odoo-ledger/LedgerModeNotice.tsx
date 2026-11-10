/** Shown where the ledger mode is used when reading it failed (#2065): figures may follow PMO documents or the Odoo ledger, and we cannot say which. */
import { useTranslation } from 'react-i18next';
import { ListState } from '@/src/components/ui';

export function LedgerModeNotice({ onRetry, className }: { onRetry: () => void; className?: string }) {
  const { t } = useTranslation('finance');
  return (
    <ListState
      variant="error"
      className={className}
      title={t('odooLedger.mode.loadFailed', 'We could not check where these figures come from')}
      sub={t('odooLedger.mode.loadFailedSub', 'They follow either PMO documents or the Odoo ledger. Try again before relying on them.')}
      onRetry={onRetry}
      retryLabel={t('odooLedger.mode.retry', 'Retry ledger mode')}
    />
  );
}
