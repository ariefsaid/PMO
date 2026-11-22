import { useTranslation } from 'react-i18next';
import { useRefusalText } from '@/src/lib/refusals';

/**
 * The plain sentence for a refused work-order/discipline write (#2517). The record itself was already saved
 * when this runs, so the headline says so; the detail names the database's reason (0951 §2) when it is one.
 */
export function useAttributionErrorText(): (error: unknown) => { headline: string; detail: string } {
  const { t } = useTranslation('workOrderCost');
  const refusal = useRefusalText();
  return (error) => {
    const r = refusal(error, { context: { suppressCapture: true } });
    return {
      headline: t('workOrderCost:savedWithoutAttribution', 'Saved, but the work order or discipline was not set'),
      detail: r.known ? r.headline : t('workOrderCost:refusal.generic', 'Try again from the record.'),
    };
  };
}
