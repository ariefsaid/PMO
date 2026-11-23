# Spec: claim-line over-claim warning (survey-cap-warn, part A)

Job story: When I raise a claim, I want the quantity measured or accepted for the work item to be the ceiling on what I claim, so a claim does not exceed what was measured.

Ruling in force: over-claim stays a warning, never a block (OD-SCOPE-6). Parts B (setting-gated database stop, default warn) and C (survey record per work order and line) are separate branches.

## Verified base behaviour
- The claim form's pre-fill already uses accepted minus claimed on the work order (`src/lib/contractQuantityPrefill.ts`, BAST branch), else min(assessed - claimed everywhere, ordered - claimed on this order).
- Over-claim warnings exist only on the Billing plan page (`overClaimWarning`, `src/lib/billingPlan.ts`) and "Over-claimed" on the Billing tab BoQ row. The claim form line had none: this adds it.

## Requirements (EARS)
- FR-SCW-1: The system shall provide one pure function `claimableHeadroom({ordered, claimed, accepted, surveyed?})` in `src/lib/progressBilling.ts`: ceiling = surveyed if given, else accepted if a BAST exists (zero counts), else ordered; headroom = ceiling - claimed, floored at 0; integer milli-units.
- FR-SCW-2: When a quantity typed on a unit-rate line of a work-order scope exceeds that line's headroom, the form shall show a warning under the field: words, warning colour and an alert icon, the headroom figure with its unit, the ceiling and claimed figures, and the next step. Submit stays enabled.
- FR-SCW-3: The pre-fill shall use the same function (single source).
- Out of scope: lump-sum percent lines and the no-work-order scope (no per-order facts).
- Reuse for B and C: B calls `claimableHeadroom` (or its SQL twin, tested against the same cases) for the stop. C feeds the jointly surveyed quantity into the `surveyed` input, which then takes precedence, with no change to callers.

## Acceptance criteria
- AC-SCW-001 Given a BAST of 6 and 3 claimed, headroom is 3 on basis accepted. (unit)
- AC-SCW-002 Given nothing accepted, headroom is ordered minus claimed; a zero BAST is a BAST. (unit)
- AC-SCW-003 Given claimed above the ceiling, headroom is 0 and the signed figure negative. (unit)
- AC-SCW-004 Milli-unit exact; a surveyed figure takes precedence. (unit)
- AC-SCW-005 Given accepted 3, claimed 1, when 3 is typed, the warning shows 2 and submit still raises the claim; at exactly 2 no warning. (RTL)
- AC-SCW-006 Given nothing accepted, ordered 5, claimed 1, typing 5 warns with headroom 4 (ordered basis). (RTL)

Strings: English and Bahasa Indonesia in `projectTabs` locale files (`overClaimAccepted`, `overClaimOrdered`).
