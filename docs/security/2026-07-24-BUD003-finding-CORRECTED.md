# ⚑ CORRECTED FINDING — AC-BUD-003 / FR-BUD-006 is a REAL shipped defect, not a seed wart

**Supersedes the earlier characterisation in `2026-07-24-erpnext-deploy-readiness.md` (which wrongly
called this "local-seed only, no prod impact"). Traced end to end 2026-07-24.**

## The confirmed contradiction (spec ⇄ shipped code)
- **Spec, explicit and twice-stated:** FR-BUD-006(a) *"no `domain_externally_owned` row for 'budget' is
  ever created"* + FR-BUD-010 *"⚑ `domain_externally_owned` does NOT gain a `budget` row — **employment is
  asserted by the binding + the push route, not by a flip.**"* Budget is Posture B: PMO stays SoT.
- **Shipped code gates the P3c budget-ERP feature on exactly that forbidden row:**
  - `pmo-portal/pages/project-detail/tabs/BudgetTab.tsx:33` — `employsExternalBudget = ownershipRows.some(r => r.domain==='budget')`; the `<BudgetProjection>` panel renders only if true.
  - `supabase/migrations/0149_get_budget_projection.sql:431` — `get_budget_projection` returns data only when `domain_owned_by_tier(org,'budget','erpnext')`, and `domain_owned_by_tier` (0135) reads `external_domain_ownership`.
  - `seed.sql:411` inserts the forbidden row so the feature works LOCALLY.

## Prod symptom (confirmed): a lose-lose
The ERPNext connect flow (`external-connect`) employs only ClickUp `tasks`; ERPNext domains are employed
per-domain by an operator (`operator_set_domain_ownership`, 0087). So for a real budget customer:
- Operator employs `budget` → the P3c feature works BUT the spec-forbidden `domain_externally_owned('budget')`
  row now exists in prod → **FR-BUD-006(a) violated in prod.**
- Operator follows the spec (no budget row) → **the budget-ERP projection panel + data are INVISIBLE in prod.**
Either way the shipped P3c feature-gate deviates from its own spec.

## NOT a money-safety defect
Budget's tables are NEVER RLS-flipped (verified: 0 flip policies, 0 native_mirror_guard, `get_project_budget`
= Σ Active even for an employed org). PMO stays the authority. The defect is the FEATURE-GATE mechanism,
not budget correctness.

## Resolution — needs an OWNER decision (a code change to a shipped feature)
- **Option A (spec-faithful — recommended):** change the feature-gate to the signal the spec names — the
  ERPNext **binding** (`external_org_bindings` active for tier `erpnext` + the budget push route) — in BOTH
  `BudgetTab.tsx:33` and `get_budget_projection`'s gate (`0149:431`); remove the seed's budget ownership row.
  Then FR-BUD-006(a) holds AND the feature works via the binding, exactly as FR-BUD-010 specifies. This is the
  design the spec author clearly intended.
- **Option B (bless the deviation):** rule FR-BUD-006(a)/FR-BUD-010 superseded, accept
  `domain_externally_owned('budget')` as the employ signal (it is inert for RLS), have the ERPNext enablement
  flow employ `budget` explicitly, and re-scope AC-BUD-003 to the structural no-flip only. Cheaper, but
  overrides an explicit, deliberate, twice-stated spec invariant and keeps the ownership table doubling as a
  UI signal.

**AC-BUD-003 test stands RED against the current code** (spec-faithful assertion (a) restored). It closes green
under Option A after the gate is moved to the binding; under Option B only after the spec + test are re-scoped.

## Director note (honesty)
I mischaracterised this twice before tracing it fully — first as "local-seed only," then re-scoped the test to
bless the deviation (reverted). The spec is explicit; the code deviates; the fix is a real, reviewable code
change. Recorded so the next reader has the traced truth, not my earlier wrong reads.
