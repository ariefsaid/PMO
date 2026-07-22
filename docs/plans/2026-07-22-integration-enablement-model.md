# Plan — Integration enablement model

- **Spec:** `docs/specs/integration-enablement-model.spec.md`
- **ADR:** `docs/adr/0061-integration-enablement-model.md`
- **Date:** 2026-07-22
- **Scope:** docs-approved architecture fix only; implementation starts after owner approval.
- **Existing contracts:** ADR-0055, ADR-0016, ADR-0018, ADR-0047, OD-INT-14, ADR-0059.

## Design

`external_org_bindings` plus `external_domain_ownership` remains the org-local enablement authority. A shared server-side helper reads the kill-switch with the same default everywhere:

```ts
export function externalExecutionEnabled(getEnv = (name: string) => Deno.env.get(name)) {
  return getEnv('EXTERNAL_CONNECT_ENABLED') !== 'false';
}
```

Only the exact string `false` disables execution; unset and `true` enable it. The helper must be used by all relevant external execution paths, not by the browser. `resolvePerOrgSecret` no longer returns `no-binding` solely because the deployment switch is off; callers first short-circuit on the kill-switch, and otherwise resolve the active binding for the execution org.

Connect uses this order: verify caller and org → validate ClickUp credential → check kill-switch → write Vault secret → invoke one server-side finalize RPC that atomically upserts the active binding and employs `tasks` ownership → run/record the readiness proof → return Active. Because Vault is an external side effect, a finalize failure calls a privileged Vault-delete cleanup path and returns failure; it never reports Active. The final RPC must itself reject if the kill-switch is disabled or readiness has not been recorded. A readiness proof is bounded and deterministic: the per-org resolver returns a credential and the existing ClickUp adapter performs its non-mutating credential/API capability check; it does not claim that a full historical sweep has completed.

Recovery is a separate operator runbook/command path, not a client-side reconnect requirement. It discovers trap-state orgs from employed ClickUp tasks ownership without an active resolver-usable binding, repairs or rotates Vault/binding state, runs the same readiness proof, then retains ownership. If repair fails, it calls the authorized release ownership path first, restoring PMO editability. Every transition is audited with org, actor, tier, effective switch, result, and cleanup outcome.

## Traceability and owning layer

| AC | Owner | Planned proof |
|---|---|---|
| AC-IEM-001 | Unit | `supabase/functions/_shared/externalExecutionEnabled.test.ts` |
| AC-IEM-002 | Unit | `supabase/functions/_shared/perOrgSecret.test.ts` |
| AC-IEM-003 | pgTAP | `supabase/tests/integration_enablement_model.test.sql` |
| AC-IEM-004 | Curated E2E | `pmo-portal/e2e/AC-IEM-004-connect-atomic-success.spec.ts` |
| AC-IEM-005 | Unit | `supabase/functions/external-connect/connect.test.ts` |
| AC-IEM-006 | pgTAP | `supabase/tests/integration_enablement_model.test.sql` |
| AC-IEM-007 | Curated E2E | `pmo-portal/e2e/AC-IEM-007-kill-switch-recovery.spec.ts` |
| AC-IEM-008 | pgTAP | `supabase/tests/integration_enablement_model.test.sql` |

## Implementation tasks (TDD-first, 2–5 minutes each)

### Shared switch and resolver

1. **Write the failing switch tests** *(AC-IEM-001, NFR-IEM-001).* Create `supabase/functions/_shared/externalExecutionEnabled.test.ts` with cases for absent, `true`, `false`, `1`, and `yes`; assert only exact `false` disables. Verify: `cd supabase/functions/_shared && deno test externalExecutionEnabled.test.ts`.
2. **Add the shared switch helper.** Create `supabase/functions/_shared/externalExecutionEnabled.ts` with the `externalExecutionEnabled(getEnv?)` signature shown above and no network/database imports. Verify: `cd supabase/functions/_shared && deno check externalExecutionEnabled.ts && deno test externalExecutionEnabled.test.ts`.
3. **Write resolver matrix regressions** *(AC-IEM-002).* Extend `supabase/functions/_shared/perOrgSecret.test.ts` with enabled + active binding, missing binding, inactive binding, Vault miss, and two-org isolation cases; assert the resolver is not disabled by a boolean passed from the deployment switch. Verify: `cd supabase/functions/_shared && deno test perOrgSecret.test.ts`.
4. **Refactor the resolver contract.** Edit `supabase/functions/_shared/perOrgSecret.ts` so it resolves the active binding for the supplied `orgId`; move kill-switch short-circuiting to callers using `externalExecutionEnabled`. Preserve the discriminated results and fail-closed Vault miss. Verify: `cd supabase/functions/_shared && deno check perOrgSecret.ts && deno test perOrgSecret.test.ts`.
5. **Write execution-path switch tests** *(AC-IEM-001, AC-IEM-007).* Add cases to the existing Deno tests for `adapter-dispatch`, `clickup-sweep`, `clickup-webhook-worker`, `erpnext-onboard`, `erpnext-sweep`, and `erpnext-webhook` proving false stops external calls and restoring the switch reuses the existing binding. Verify: `scripts/with-test-lock.sh bash -c 'cd supabase/functions && deno test adapter-dispatch clickup-sweep clickup-webhook-worker erpnext-onboard erpnext-sweep erpnext-webhook'`.
6. **Wire every execution path.** Edit `supabase/functions/adapter-dispatch/index.ts`, `clickup-sweep/index.ts`, `clickup-webhook-worker/index.ts`, `erpnext-onboard/index.ts`, `erpnext-sweep/index.ts`, and `erpnext-webhook/index.ts` to use the shared switch and then call the resolver with the org binding. Keep OD-INT-14's global webhook verification unchanged. Verify: `cd supabase/functions && deno check adapter-dispatch/index.ts clickup-sweep/index.ts clickup-webhook-worker/index.ts erpnext-onboard/index.ts erpnext-sweep/index.ts erpnext-webhook/index.ts`.

### Atomic connect

7. **Write failing readiness tests** *(AC-IEM-003, AC-IEM-004).* Extend `supabase/functions/external-connect/connect.test.ts` with: switch false; Vault miss; adapter readiness failure; and successful readiness. Assert ownership RPC is zero calls on each failure and occurs only after readiness on success. Verify: `cd supabase/functions/external-connect && deno test connect.test.ts`.
8. **Add a reversible finalize/cleanup migration.** Create the next migration after the current migration head (verify with `ls supabase/migrations | sort | tail -1`) defining a security-definer finalize RPC for `(org_id, tier, secret_ref, readiness_token)` that checks the kill-switch decision supplied by the edge function's deployment context, verifies the active binding, and updates binding plus `external_domain_ownership` in one database transaction. Add a privileged, narrowly scoped Vault-delete RPC for failed-finalize cleanup, revoke public access, grant only required server roles, and include `drop function if exists` reversal statements. Verify: `scripts/with-db-lock.sh bash -c 'supabase db reset && supabase test db'`.
9. **Refactor connect around the boundary.** Edit `supabase/functions/external-connect/index.ts`: perform `externalExecutionEnabled()` before side effects; retain existing JWT/profile/role and ClickUp validation; resolve the org binding through the new readiness helper; call the finalize RPC only after readiness; invoke cleanup on finalize failure; return a failure classification rather than logging ownership failure and returning Active. Do not return Vault values. Verify: `cd supabase/functions/external-connect && deno check index.ts && deno test connect.test.ts`.
10. **Write client failure tests** *(AC-IEM-005).* Add cases to `pmo-portal/src/components/integrations/IntegrationsView.test.tsx` for disabled, invalid-token, and sync-not-ready responses; assert an actionable error, no Active badge, and no credential text in rendered output. Verify: `cd pmo-portal && npx vitest run src/components/integrations/IntegrationsView.test.tsx`.
11. **Make the status truthful.** Edit `pmo-portal/src/components/integrations/IntegrationsView.tsx` and its existing integration repository/hook so Active is rendered only from a committed active binding/readiness response, and classified connect failures remain actionable form errors. Do not read server secrets or add a client flag authority. Verify: `cd pmo-portal && npx vitest run src/components/integrations/IntegrationsView.test.tsx`.

### Trap-state recovery and rollout

12. **Write trapped-org pgTAP proofs** *(AC-IEM-003, AC-IEM-006, AC-IEM-008).* Create `supabase/tests/integration_enablement_model.test.sql` with seeded employed-without-binding and employed-with-vault-miss orgs; assert repair-success retains ownership only after readiness, repair-failure releases ownership, repeat repair is idempotent, and cross-org/non-admin calls are rejected. Tag each test description with its AC ID. Verify: `scripts/with-db-lock.sh bash -c 'supabase db reset && supabase test db'`.
13. **Implement the recovery RPC/runbook.** Add the recovery operation to the same migration family with org-scoped authorization, an explicit `repair`/`release` result, audit rows, and no hard delete of binding/read-model rows (ADR-0018). Add `docs/runbooks/integration-trap-state-recovery.md` documenting discovery query, kill-switch-on prerequisite, Vault/binding repair, bounded readiness check, release fallback, verification query, and rollback. Verify: `scripts/with-db-lock.sh bash -c 'supabase db reset && supabase test db'` and `git diff --check`.
14. **Add the atomic success journey** *(AC-IEM-004).* Create `pmo-portal/e2e/AC-IEM-004-connect-atomic-success.spec.ts`; as an org-admin, submit a valid ClickUp credential, assert Active only after the finalize response, and assert a sync request uses the org binding. Mock external HTTP only at the boundary. Verify: `cd pmo-portal && npx playwright test e2e/AC-IEM-004-connect-atomic-success.spec.ts`.
15. **Add kill-switch restoration journey** *(AC-IEM-007).* Create `pmo-portal/e2e/AC-IEM-007-kill-switch-recovery.spec.ts`; start with an active binding, stop execution, restore execution, and assert sync resumes without a reconnect or credential-entry step. Verify: `cd pmo-portal && npx playwright test e2e/AC-IEM-007-kill-switch-recovery.spec.ts`.
16. **Run rollout in the safe order.** In `docs/runbooks/integration-trap-state-recovery.md`, record this exact order: deploy migrations/RPCs and code with the switch explicitly false; inventory and repair trap-state orgs; run pgTAP and the curated journeys; verify one seeded org's connect→readiness→ownership→sync sequence; set the deployed function secret to true (default remains true if omitted); monitor audit/error signals; only then permit normal self-serve. To roll back, set the switch false, stop new connects, release ownership for any unrepairable org, and revert the migration using its reversal statements. Verify: `git diff --check`.
17. **Full implementation gate.** From `pmo-portal/`, run the complete suite, not targeted tests: `npm run verify`. Then from the repository root run `scripts/with-db-lock.sh bash -c 'supabase db reset && supabase test db'` and `git status --short`. No implementation task may be marked complete with a red test.

## Open questions for owner approval

1. Confirm the exact bounded ClickUp readiness operation and whether it may issue a non-mutating API request beyond token validation.
2. Confirm the deployment mechanism that supplies the kill-switch's effective value to the finalize RPC; the RPC must not trust a client-provided boolean.
3. Confirm which operator identity is permitted to execute trap-state recovery in the current single-org deployment.
