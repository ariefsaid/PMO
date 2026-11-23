import { useTranslation } from 'react-i18next';
import { useToast } from '@/src/components/ui';
import { AppError } from '@/src/lib/appError';
import { parseRefusal, useRefusalText } from '@/src/lib/refusals';
import { isSetupRefusal } from '@/src/lib/adapterSeam/odoo/stock/refusal';

/** One line of plain words for a failed stock call: the refusal's sentence, a connected post's refusal reason, else the shared classifier. */
export function useStockErrorText(): (err: unknown) => string {
  const { t } = useTranslation('stock');
  const refusal = useRefusalText();
  return (err) => {
    // A connected post refused for a setup condition: the server names the reason, the copy names the step and who does it.
    if (!parseRefusal(err) && err instanceof AppError && err.code === 'commit-rejected' && err.details) {
      const reason = String(err.details);
      const known = t(`refusal.${reason}`, { defaultValue: '' });
      const fact = known || t('refusal.other');
      return !known || isSetupRefusal(reason) ? `${fact} ${t('detail.erp.askAdmin')}` : fact;
    }
    return refusal(err, { context: { operation: 'create', suppressCapture: true } }).headline;
  };
}

/**
 * Tells the person what a failed post means. A post that Odoo may have received (no answer yet) or that Odoo is holding is not a failure:
 * it is information, and the document's page says where it stands. Everything else is a failed action with its reason.
 */
export function useStockFailureNotice(): (err: unknown) => void {
  const { t } = useTranslation('stock');
  const { toast } = useToast();
  const errorText = useStockErrorText();
  return (err) => {
    const code = err instanceof AppError ? err.code : undefined;
    if (code === 'command-held') toast(t('detail.erp.notice.heldTitle'), t('detail.erp.notice.heldBody'), 'info');
    else if (code === 'external-unreachable') toast(t('detail.erp.notice.sentTitle'), t('detail.erp.notice.sentBody'), 'info');
    else toast(t('detail.actionFailed'), errorText(err), 'warning');
  };
}
