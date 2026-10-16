import { EXPENSES_EMPLOYABLE } from '@/src/lib/adapterSeam/erpnext/expenseEnablement';
import { useErpnextBinding } from './useErpnextBinding';
import { useExternalDomainOwnership } from './useExternalDomainOwnership';

/**
 * S-12 (UX-080, RF-053, RF-060) — one expense-posting readiness derivation for every expense surface,
 * composed from the EXISTING readiness/ownership hooks (the same predicate ExpenseAccountMap applied
 * inline; S-07's `useIntegrations` is untouched). Display only: it never changes posting, approval or
 * enqueue behaviour, and it is not a new server authority contract.
 *
 * The five states are deliberately distinct (the Stated-State Rule):
 * - `checking`     — a readiness read is still pending; screens stay quiet (no banner flash).
 * - `unavailable`  — a readiness read failed; unknown is never rendered as "not connected" or "off".
 * - `notConnected` — no active ERPNext binding; the missing step is connecting ERPNext.
 * - `inactive`     — ERPNext IS connected but the `expenses` domain is not employed; the missing step
 *                    is switching expense posting on (Admin, Integrations › ERPNext setup) — never
 *                    "reconnect" (UX-080: the connection screen already says Connected).
 * - `ready`        — posting is active; account-map completeness is each screen's own detail.
 */
export type ExpensePostingReadinessState =
  | 'checking'
  | 'unavailable'
  | 'notConnected'
  | 'inactive'
  | 'ready';

export interface ExpensePostingReadiness {
  state: ExpensePostingReadinessState;
  /** Re-read the binding + ownership reads behind the state (the banner's Retry affordance). */
  retry: () => void;
}

export function useExpensePostingReadiness(): ExpensePostingReadiness {
  const binding = useErpnextBinding();
  const ownership = useExternalDomainOwnership();
  const state: ExpensePostingReadinessState = binding.isPending || ownership.isPending
    ? 'checking'
    : binding.isError || ownership.isError
      ? 'unavailable'
      : binding.data?.status === 'active'
        ? (EXPENSES_EMPLOYABLE && ownership.data?.some((row) => row.externalTier === 'erpnext' && row.domain === 'expenses')
          ? 'ready'
          : 'inactive')
        : 'notConnected';
  return {
    state,
    retry: () => {
      void binding.refetch();
      void ownership.refetch();
    },
  };
}
