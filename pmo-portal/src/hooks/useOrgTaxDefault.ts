import { useEffect, useRef } from 'react';
import { useQuery } from '@tanstack/react-query';
import { repositories } from '@/src/lib/repositories';
import { useAuth } from '@/src/auth/useAuth';
import type { TaxTreatment } from '@/src/lib/db/procurementLifecycle';

/**
 * The org's tax-treatment PRE-SELECTION (`OD-TAX-1`, migration 0207) — `'exclusive'` on a seeded
 * org, `'inclusive'` where the Admin flipped it, `undefined` until the org row resolves.
 *
 * ⛔ FOR FORMS COMPOSING A NEW ROW, AND NOTHING ELSE. Never call this to decide what an existing
 * figure means: a stored `tax_treatment` of NULL means "no value to interpret", never "inherit the
 * current default", and reading today's setting onto an old row re-writes what that row meant every
 * time an Admin flips it (#478 — the ambiguity that cannot be recovered afterwards). A rendered
 * figure gets its basis from its OWN row, via `TaxBasisLabel`.
 *
 * ⚑ Deliberately NO `placeholderData`. `useOrgCurrency` can honestly guess 'USD' because a wrong
 * currency is visibly wrong and self-corrects on load; a wrong tax basis pre-selected into a form is
 * INVISIBLY wrong — the user submits it and the row carries a marker nobody chose, which is the one
 * outcome 0196/0197 designed their columns to prevent. Unknown stays undefined and the select stays
 * empty. staleTime Infinity — an org's accounting posture changes only by Admin action.
 */
/** react-query cache key for the org tax default — shared so the Admin write can invalidate it. */
export const ORG_TAX_DEFAULT_KEY = 'org-tax-default';

export function useOrgTaxDefault(): TaxTreatment | undefined {
  const { currentUser } = useAuth();
  const { data } = useQuery<TaxTreatment | null>({
    queryKey: [ORG_TAX_DEFAULT_KEY, currentUser?.org_id],
    queryFn: () => repositories.orgSettings.getTaxDefault(),
    enabled: Boolean(currentUser),
    staleTime: Infinity,
  });
  return data ?? undefined;
}

/**
 * Seeds a tax-treatment control with the org default the first time that default becomes known —
 * the whole of `OD-TAX-1`'s "it pre-selects only", in one place so no form re-derives the rule.
 *
 * Three properties, each load-bearing:
 *  • ONCE. A `useRef` latch, not a `value === ''` test on every render: without it, a user who
 *    deliberately clears the select back to "— choose —" would have the default typed back in
 *    under their cursor.
 *  • NEVER OVER A CHOICE. If the control already holds something when the default lands, the
 *    default is dropped. That covers the edit case (a stored treatment seeded from the row) and the
 *    fast typist who answered before the query resolved.
 *  • NEVER A GUESS. `undefined` (org row unread) seeds nothing at all, so a failed read leaves the
 *    control empty and the existing submit guard blocks — it never invents a marker.
 *
 * ⚑ The default is a PARAMETER, not something this hook fetches. Reading it here would bury a
 * react-query + AuthContext dependency inside a seeding rule, so every form that wanted the rule
 * would inherit two providers it has no other use for — and every test of such a form would have to
 * stand them up to render a select. The call site reads `useOrgTaxDefault()` and hands the value
 * down; the rule below is then pure enough to state on its own.
 *
 * `enabled: false` opts a form out entirely — the EDIT case. A form editing an existing record must
 * show that record's own stored treatment; seeding it from the current org setting would state
 * today's posture about a figure someone recorded months ago, which is the read-time inference
 * OD-TAX-1 forbids outright.
 */
export function useTaxTreatmentPreselect(
  orgDefault: TaxTreatment | undefined,
  current: string,
  apply: (value: TaxTreatment) => void,
  enabled = true,
): void {
  const seeded = useRef(false);
  // Refs so the effect depends ONLY on the default arriving — re-running it on every keystroke
  // would make the latch the only thing standing between the user and a re-seed.
  const currentRef = useRef(current);
  currentRef.current = current;
  const applyRef = useRef(apply);
  applyRef.current = apply;

  useEffect(() => {
    if (!enabled || seeded.current || !orgDefault) return;
    seeded.current = true;
    if (currentRef.current === '') applyRef.current(orgDefault);
  }, [enabled, orgDefault]);
}
