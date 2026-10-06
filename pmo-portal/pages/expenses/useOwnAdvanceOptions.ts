import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { useAuth } from '@/src/auth/useAuth';
import { useExpenseAdvanceAging } from '@/src/hooks/useExpenseClaims';
import { formatCurrencyCents } from '@/src/lib/format';

/** The caller's own paid advances that still hold money (DD-EXP-6) — the claim form's "settle against" choices.
 *  Keeps an already-linked advance selectable even after it is fully settled. */
export function useOwnAdvanceOptions(currentAdvanceId: string | null = null): { value: string; label: string }[] {
  const { t } = useTranslation();
  const userId = useAuth().currentUser?.id;
  const aging = useExpenseAdvanceAging();
  return useMemo(() => {
    const own = (aging.data?.rows ?? [])
      .filter((r) => r.claimantId === userId)
      .map((r) => ({ value: r.advanceId, label: `${r.claimNumber ?? '—'} · ${formatCurrencyCents(r.outstanding, r.currency)}` }));
    if (currentAdvanceId && !own.some((o) => o.value === currentAdvanceId)) {
      own.unshift({ value: currentAdvanceId, label: t('expenses.form.advance.current', 'The advance already linked') });
    }
    return own;
  }, [aging.data, userId, currentAdvanceId, t]);
}
