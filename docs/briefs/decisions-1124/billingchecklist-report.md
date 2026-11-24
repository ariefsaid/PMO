# Billing checklist edit report

Implementation verified at `3eaa95b57f2cf44037641770eefbf34006d57ca9` on `feat/1124-billing-checklist-edit`. Specification: `docs/specs/wo-checklist-edit.spec.md`.

## Review findings

- **Important — template fidelity:** Finance or an Admin can save the checklist as a template with its hidden-role rules and document slots intact. Fixed in migration 2181. Owning proof: `AC-WCE-002` in `supabase/tests/2180_wo_billing_step_add.test.sql`.
- **Important — per-organization rollout:** an Admin sees the setting in Administration → Accounting; it defaults off per organization, and add/save remain unavailable until enabled. The database enforces the switch and Admin-only setter. Owning proof: `FR-WCE-006` in `supabase/tests/2180_wo_billing_step_add.test.sql`, plus the settings catalogue and checklist section Vitest files.
- **Important — acceptance evidence:** the 2180 pgTAP proof and mutation-polarity checks are present and pass on the spare runner. The writer, tenant-isolation, light-account, and capability sweeps pass. Work-order and setting screenshots were captured at 1440px and 390px in English and Bahasa. The work-order proof passes; the full Accounting route proof still exits red on route-wide layout and word-count checks, though axe reports zero serious or critical findings. See `billingchecklist-open.md`.
- **Minor — append position:** a user can append after the last step even when they cannot see the tail; the UI sends a null end sentinel and the database resolves it against the complete list. Fixed in the app and migration 2181. Owning proofs: the hidden-tail `AC-WCE-005` case in `supabase/tests/2180_wo_billing_step_add.test.sql` and the pure-rule Vitest file.
- **Critical findings:** none.

## Gates

- `npm run check:guards` — pass.
- `npm run typecheck` — pass.
- ESLint with `--max-warnings=0` on all changed TypeScript files — pass.
- Touched Vitest files — 6 files, 109 tests passed under Node 22.
- Spare-runner pgTAP — 2180: 142/142 passed. Supporting files also passed: `0178_anon_executable_definers`, `0002_tenant_isolation`, `2711_light_account_boundary_sweep`, `2712_light_account_write_guards`, `2715_light_guard_management_definers`, and `2716_role_capability_consumers`.
- `scripts/check-isolation-denominator.mjs --self-test` — could not validate against the shared local database because the live catalog is not at this branch's migration head. No local database reset or migration was run; the remote tenant-isolation proof passed.
- Rendered proof — work-order route pass; Accounting route red as noted above. Captures and detector output remain in ignored `docs/private/ux-shots/1124-billingchecklist/`.

The initial spare-runner run found that the test placed a numeric position check after appending at that position, making it valid. The assertion was moved before the append, where it is beyond the four-row list. The corrected test passes; the implementation and intended assertion were retained.
