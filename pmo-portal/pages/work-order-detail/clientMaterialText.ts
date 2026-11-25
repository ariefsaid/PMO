import { parseMoneyInputAtScale } from '@/src/lib/format';
import { useTranslation } from 'react-i18next';
import { parseRefusal, useRefusalText } from '@/src/lib/refusals';
import type { SubmitError } from '@/src/components/ui';

/** A rejected write as the dialog's persistent error region reads it: the refusal's sentence, else the shared classifier's words. */
export function useSubmitError(): (err: unknown) => SubmitError {
  const refusal = useRefusalText();
  const { t } = useTranslation('workOrders');
  return (err) => {
    // D4: the stock gate for a flagged item speaks of receiving; a pickup says plainly that this item cannot be recorded as one.
    if (parseRefusal(err)?.code === 'STK_QUALITY_RECEIPT') return { headline: t('clientMaterial.pickup.needsQualityCheck', 'This item needs a quality check, so it cannot be recorded as a pickup.') };
    const r = refusal(err, { context: { suppressCapture: true } });
    return r.detail ? { headline: r.headline, detail: r.detail } : { headline: r.headline };
  };
}

/** A quantity a person typed: above 0, at most 3 decimals, as the exact string the RPC receives. */
export function readQuantity(raw: string): string | null {
  const n = parseMoneyInputAtScale(raw.trim(), 3);
  return n === null || n <= 0 ? null : String(n);
}

export interface Option { value: string; label: string }
