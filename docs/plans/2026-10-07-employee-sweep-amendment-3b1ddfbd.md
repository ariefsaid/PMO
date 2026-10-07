# Plan: Gate ERPNext sweep amendment field by submittability (Issue #921)

## Scope and design

`git log origin/dev --grep="#921"` produced no commits, so this fix is not already on `dev`.

The shipped field builder is `sweepFieldsForKind()` in `supabase/functions/erpnext-sweep/index.ts`. It currently treats every non-`contact` kind as an amendment-capable lifecycle document, so the `employee` master list request includes `amended_from`; ERPNext rejects the whole list query because that field is not on `Employee`.

Use the existing `DOCTYPE_REGISTRY[kind].submittable` property as the sole capability source. The field builder will always request `name`, `modified`, and `docstatus`, and will add `amended_from` only when the registry entry is submittable. It will leave mapper fields, payment-type discrimination, recovery-anchor selection, company scoping, polling ownership, request shape otherwise, and all data/schema/API contracts unchanged. No migration, RLS change, cache change, UI work, or ADR is warranted.

The canonical proof remains in the shipped Deno sweep code because that is where the request field list is constructed. The regression test will assert the invariant over every registry kind—not a hand-maintained master list—so a future master cannot accidentally gain `amended_from` and a future submittable kind cannot lose amendment-lineage polling.

## Acceptance traceability

The issue supplies the acceptance behavior; label its owning test **AC-921**:

| Acceptance criterion | Owning layer | Canonical proof |
|---|---|---|
| AC-921 — Given each registered ERP kind, when the sweep builds its list-query fields, then `amended_from` is absent for every non-submittable/master kind (including Employee) and present for every submittable kind. | Deno unit | `supabase/functions/erpnext-sweep/ownershipAndFields.test.ts` |

## TDD implementation tasks

### 1. Add the failing registry-driven sweep-field regression test (AC-921)

**Files:**
- `supabase/functions/erpnext-sweep/ownershipAndFields.test.ts`

**Test first:** import `DOCTYPE_REGISTRY` alongside the existing sweep imports. Replace the Employee test's stale expectation that `amended_from` is a lifecycle field with its correct invariant: it must still contain every `EMPLOYEE_FROM_DOC_FIELDS`, `name`, `modified`, `docstatus`, and `company`, but must not contain `amended_from`. Add a separately named `Deno.test('AC-921 ...')` that iterates `Object.entries(DOCTYPE_REGISTRY)` and asserts `sweepFieldsForKind(kind).includes('amended_from') === entry.submittable`, with assertion messages naming the kind. This covers Employee and all current/future masters plus every submittable document without duplicating the registry's list.

**Expected RED:** before production code changes, the `employee` assertion and the registry invariant fail because the field builder adds `amended_from` for every kind other than `contact`.

**Verify RED then GREEN target:**
```bash
cd supabase/functions/erpnext-sweep && deno test ownershipAndFields.test.ts --config deno.json --allow-env --allow-net --allow-read
```

### 2. Derive amendment-lineage polling from registry submittability (AC-921)

**Files:**
- `supabase/functions/erpnext-sweep/index.ts`

**Implementation:** in `sweepFieldsForKind(kind)`, replace the `kind === 'contact'` special case with a lifecycle base array containing `name`, `modified`, and `docstatus`; append `amended_from` only if `DOCTYPE_REGISTRY[kind].submittable` is true, then add the resulting fields to the existing `Set`. Keep all subsequent payment-type, anchor, and company-field logic byte-for-byte. Do not change `DOCTYPE_REGISTRY`, mapper field declarations, filters, hydration, or sweep execution.

**Verify:**
```bash
cd supabase/functions/erpnext-sweep && deno test ownershipAndFields.test.ts --config deno.json --allow-env --allow-net --allow-read
```

### 3. Run the required scoped and repository gates (AC-921 regression evidence)

**Files:** none.

**Verify in this order:**
```bash
cd pmo-portal && npm run typecheck
cd pmo-portal && npx eslint --max-warnings=0 ../supabase/functions/erpnext-sweep/index.ts ../supabase/functions/erpnext-sweep/ownershipAndFields.test.ts
cd pmo-portal && ../scripts/with-test-lock.sh npx vitest run --changed origin/dev
bash scripts/deno-test-edge-fns.sh
```

Do not treat the issue as complete if any command is red. The final Deno gate is intentionally the repository script so it runs the complete edge-function/shared-Deno inventory, including the shipped handler import path.

## Builder guardrails

- This is a bounded edge-function sweep fix; do not add a new explicit master set, because `submittable` is already the registry capability that distinguishes amendment-capable documents.
- `Employee` remains company-scoped: retain its `company` field and the existing server-side company filter/admission behavior.
- Do not remove `amended_from` from submittable kinds: it is required for existing cancel/amend lineage reconciliation.
- No spec, migration, or ADR change is part of this implementation; issue #921's explicit acceptance is recorded as AC-921 in the Deno proof.
