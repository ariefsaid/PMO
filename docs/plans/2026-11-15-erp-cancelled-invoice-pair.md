# ERP-cancelled invoice pair — implementation plan (#1696)

Money tier: Director-dispatched, ships alone. The original plan at `92fcf883e` is historical; the Director's subsequent ruling omits unverified replacements, confines the described financial impact to the project invoice total, and retains manual undo for unknown lifecycle. The accepted-pair read and cancellation display are already implemented on this branch. See `docs/specs/erp-connect-anytime.spec.md` for the existing acceptance criteria.

## Authorized confirmation follow-up

Add a reversible migration in the approved 1056–1057 range, checking the current base and rollback names before choosing a slot. Introduce a security-definer compare-and-unpair RPC, with a pinned search path, active-member and Finance/Admin checks, server-derived organization, and execute granted only to authenticated callers. Lock the PMO row first, compare the reviewed ERP identity and `paired_at`, then lock its ERP row and compare the exact `erp_docstatus` and `erp_cancelled_at` snapshot. Refuse mismatches and reuse the existing undo semantics and audit. Keep the existing `unpair_invoice` and its callers unchanged.

The #1696 review confirmation passes the reviewed pair identity, generation and lifecycle snapshot. If the lifecycle cannot be read, do not invent a snapshot; require a successful read before a guarded confirmation. On refusal, reload for another decision. Do not change the ERP feed or automatically unpair.

## Acceptance and proof

- A confirmation against an earlier pair or generation refuses and leaves the current pair and attribution intact.
- A confirmation whose reviewed lifecycle differs from the locked ERP row refuses and leaves the pair and attribution intact.
- Same-organization active Finance can confirm; non-Finance, foreign-organization, inactive and anonymous callers cannot.
- Focused pgTAP tests and independent transaction-local mutations prove pair, generation, lifecycle, role and organization checks. Save and compare `pg_get_functiondef` before and after mutation, restore the function, and rerun the focused pgTAP file.
- Cover the client snapshot and confirmation action with directly touched unit tests; run guards, typecheck, touched-file lint and applicable local gates. DB commands use the shared FIFO lock. Browser journeys and rendered proof remain held until the Director lifts that separate restriction.
