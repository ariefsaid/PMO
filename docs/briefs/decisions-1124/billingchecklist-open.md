# Billing checklist edit — open items

No product decisions are open.

## Gate decision needed

`scripts/ux-proof.sh /administration/accounting` exits red on route-wide layout and word-count checks. The capture shows the new organization setting, and axe reports zero serious or critical findings. The reported layout warnings include other Accounting sections outside this feature; the code diff in this lane adds the setting row and its translations. Please decide whether this lane should expand to repair the broader Accounting screen or record that route-wide failure as existing screen debt.

The local isolation-denominator self-test also cannot validate this branch against the shared database catalog, which was left untouched. The remote `0002_tenant_isolation` pgTAP proof passed on the migrated branch.
