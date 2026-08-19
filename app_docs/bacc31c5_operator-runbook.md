# Operator runbook documentation

## What changed

Added a standalone public-safe operator runbook at `docs/operator-runbook.md`, with a reciprocal discovery link in `docs/environments.md`. The standalone page was chosen because `docs/environments.md` remains the environment/deployment reference, while the new page provides one scannable home for rare cross-organization/platform procedures and the RIS provisioning sequence.

The runbook documents:

- The Operator/org-admin boundary rule.
- Shipped operator powers, including feature toggles, targeted invitations, member status changes, credit grants, organization/usage reads, domain ownership, and platform-operator membership.
- Invocation surfaces, authority, and current audit facts, explicitly marking unaudited actions as “not currently audited.”
- Forthcoming organization creation via `operator_create_org` (#484) and lifecycle guard/state work in #489, including terminal `live`; it deliberately does not publish interim creation SQL.
- Additional source findings covering integration actions, service-only procedures, own-organization browser operations, helpers, and ordinary org-admin recovery paths, with neutral stubs where credential-bearing details must not be published.
- The ordered DD-RIS-4 sequence, including the required pre-data proof that the destructive guard refuses a wipe of the real `live` organization.

The page also states the public-repository restrictions on secrets, credential coordinates, environment names, hosts, organization identifiers, and personal data, and points credential-shaped prerequisites only to `scripts/op-get.sh`.

## Files carrying the change

- `docs/operator-runbook.md` — complete operator inventory and RIS sequence.
- `docs/environments.md` — link to the standalone runbook beside the existing operator/environment procedures.
- `docs/plans/2026-08-20-operator-runbook-bacc31c5.md`
- `docs/plans/2026-08-20-operator-runbook-bacc31c5_v2.md`
- `docs/plans/2026-08-20-operator-runbook-bacc31c5_v3.md` — planning and source-backed scope records for the documentation change.

## Verification

For the documentation change, verify the runbook with the deterministic checks described in the plans:

```bash
rg -n "Does|Invoke|Who may|Audited today|operator_toggle_feature|admin-invite-user|admin_set_user_status|operator_grant_credits|operator_list_orgs|operator_usage_summary|operator_agent_run_stats|operator_set_domain_ownership|platform_operators|m365_disconnect_cascade|admin_change_domain_ownership|finalize_external_connect|recover_external_connect_trap|external-connect|external-disconnect|external-link|external-unlink|external-lists|release_outbox_hold|attest_timesheet_no_erp_document|credits\.grant|integration\.trap_recovery|not currently audited" docs/operator-runbook.md
rg -n "Operator runbook|operator-runbook\.md" docs/environments.md docs/operator-runbook.md
git diff --check -- docs/operator-runbook.md docs/environments.md
```

Review the final diff for public-repo safety and confirm that no application tests are required for this docs-only change.
