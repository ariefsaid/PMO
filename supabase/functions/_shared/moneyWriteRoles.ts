// The role set permitted for a money write, PER PMO DOMAIN — the rulings differ by domain, and this
// map is the enforcement authority for the dispatch surface (a direct POST skips the whole FE).
// Lives in _shared/ so read-only functions (e.g. external-invoice-pdf) can apply the SAME rule
// without loading the whole dispatch guard (#919).
//
// - `procurement` / `companies`: the master-data write roles (Admin·Exec·PM·Finance) — unchanged.
// - `revenue`: Admin + Finance ONLY (owner ruling 2026-07-20; mirrors `REVENUE_WRITE` in
//   `pmo-portal/src/auth/policy.ts`). Round-6 re-audit finding 3: one shared 4-role constant let a PM
//   POST a sales-invoice `cancel` straight to this function — no revenue affordance in the UI, no SoD
//   gate on `cancel` — and reverse a submitted invoice's AR. The FE may be STRICTER than the backend;
//   the backend must never be the permissive side of a ruling.
//
// An unlisted domain resolves to the EMPTY set (fail closed): a newly-added erpnext domain must
// declare its own write roles here before any role can write it.
const MASTER_DATA_WRITE_ROLES = ['Admin', 'Executive', 'Project Manager', 'Finance'] as const;
const REVENUE_WRITE_ROLES = ['Admin', 'Finance'] as const;

const MONEY_WRITE_ROLES_BY_DOMAIN: Record<string, readonly string[]> = {
  companies: MASTER_DATA_WRITE_ROLES,
  procurement: MASTER_DATA_WRITE_ROLES,
  revenue: REVENUE_WRITE_ROLES,
  // P3c `budget` (ADR-0059 Posture B): OD-BUDGET-3 — the SAME role set `activate_budget_version`
  // (mig 0005) requires. The push is the CONSEQUENCE of that PMO act, so its authority must be neither
  // wider (a role that could not activate must not be able to push) nor narrower (a legitimate
  // activation would strand as a permanently failed push).
  budget: MASTER_DATA_WRITE_ROLES,
};

/** The roles permitted to issue a money write in `domain` (empty ⇒ nobody: fail closed). */
export function moneyWriteRolesForDomain(domain: string): readonly string[] {
  return MONEY_WRITE_ROLES_BY_DOMAIN[domain] ?? [];
}
