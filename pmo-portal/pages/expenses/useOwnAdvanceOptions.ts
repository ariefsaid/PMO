import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { useOwnExpenseAdvances } from '@/src/hooks/useExpenseClaims';
import { formatCurrencyAuto } from '@/src/lib/format';

/** The caller's own paid advances that still hold money (DD-EXP-6) — the claim form's "settle against" choices.
 *  Keeps an already-linked advance selectable even after it is fully settled. The read is narrowed to the caller on the
 *  server, so a long org-wide list cannot crowd their advances out. `isPending`/`isError` let the form tell "none" from
 *  "not loaded". */
export interface OwnAdvanceOptions {
  options: { value: string; label: string }[];
  isPending: boolean;
  isError: boolean;
  refetch: () => void;
}
export function useOwnAdvanceOptions(currentAdvanceId: string | null = null): OwnAdvanceOptions {
  const { t } = useTranslation();
  const { data, isPending, isError, refetch } = useOwnExpenseAdvances();
  const options = useMemo(() => {
    const own = (data?.rows ?? [])
      .map((r) => ({ value: r.advanceId, label: `${r.claimNumber ?? '—'} · ${formatCurrencyAuto(r.outstanding, r.currency)}` }));
    if (currentAdvanceId && !own.some((o) => o.value === currentAdvanceId)) {
      own.unshift({ value: currentAdvanceId, label: t('expenses.form.advance.current', 'The advance already linked') });
    }
    return own;
  }, [data, currentAdvanceId, t]);
  return { options, isPending, isError, refetch: () => void refetch() };
}
