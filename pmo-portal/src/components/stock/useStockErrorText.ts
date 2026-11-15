import { useTranslation } from 'react-i18next';
import { useToast } from '@/src/components/ui';
import { AppError } from '@/src/lib/appError';
import { classifyMutationError } from '@/src/lib/classifyMutationError';
import { parseStockError } from '@/src/lib/stockErrors';
import { formatQuantity } from '@/src/lib/stockFormat';
import { getNumberLocale } from '@/src/lib/locale/activeLocale';

/** One line of plain words for a failed stock RPC: the stable `STK_*` copy, a connected post's refusal reason, else the shared classifier. */
export function useStockErrorText(): (err: unknown) => string {
  const { t } = useTranslation('stock');
  return (err) => {
    const s = parseStockError(err);
    if (!s) {
      // A connected post refused for a setup condition: the server names the reason, the copy names the step and who does it.
      if (err instanceof AppError && err.code === 'commit-rejected' && err.details) return t(`refusal.${err.details}`, { defaultValue: t('refusal.other') });
      return classifyMutationError(err, undefined, { operation: 'create', suppressCapture: true }).headline;
    }
    if (s.code === 'STK_INSUFFICIENT' && s.numbers.available !== undefined && s.numbers.requested !== undefined) {
      const loc = getNumberLocale();
      return t('errors.STK_INSUFFICIENT_DETAIL', { available: formatQuantity(s.numbers.available, loc), requested: formatQuantity(s.numbers.requested, loc) });
    }
    return t(`errors.${s.code}`);
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
