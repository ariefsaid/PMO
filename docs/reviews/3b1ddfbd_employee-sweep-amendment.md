# ERPNext sweep amendment-field fix

Issue #921 is implemented in the shipped `supabase/functions/erpnext-sweep/index.ts` sweep. `sweepFieldsForKind()` still requests `name`, `modified`, and `docstatus` for every kind, but now adds `amended_from` only when the corresponding `DOCTYPE_REGISTRY` entry is marked `submittable`. This prevents master doctypes such as Employee from sending a field that ERPNext does not permit, while preserving amendment-lineage polling for submittable doctypes.

The regression coverage is in `supabase/functions/erpnext-sweep/ownershipAndFields.test.ts`. The Employee assertion explicitly requires the lifecycle fields and rejects `amended_from`; the `AC-921` test iterates the registry so every registered kind must match its `submittable` capability. The existing Employee mapper fields and company field assertions remain in place. The implementation also removes an unused catch binding in `index.ts`.

The implementation plan and acceptance traceability are recorded in `docs/plans/2026-10-07-employee-sweep-amendment-3b1ddfbd.md`.

## Verification

Run the shipped Deno test directly:

```bash
cd supabase/functions/erpnext-sweep && deno test ownershipAndFields.test.ts --config deno.json --allow-env --allow-net --allow-read
```

The plan also specifies the repository gates: `cd pmo-portal && npm run typecheck`, ESLint with `--max-warnings=0` on the two touched sweep files, the changed Vitest run under `../scripts/with-test-lock.sh`, and `bash scripts/deno-test-edge-fns.sh`.
