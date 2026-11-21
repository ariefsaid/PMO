import { useTranslation } from 'react-i18next';
import { classifyMutationError } from '@/src/lib/classifyMutationError';
import { parseReservationError } from '@/src/lib/reservationErrors';
import { formatQuantity } from '@/src/lib/stockFormat';
import { getNumberLocale } from '@/src/lib/locale/activeLocale';

/** One line of plain words for a failed reservation call: the stable `RSV_*` copy, else the shared classifier. */
export function useReservationErrorText(): (err: unknown) => string {
  const { t } = useTranslation('stock');
  return (err) => {
    const r = parseReservationError(err);
    if (!r) return classifyMutationError(err, undefined, { operation: 'create', suppressCapture: true }).headline;
    return t(`reservations.errors.${r.code}`, { n: r.number === null ? '' : formatQuantity(r.number, getNumberLocale()) });
  };
}
