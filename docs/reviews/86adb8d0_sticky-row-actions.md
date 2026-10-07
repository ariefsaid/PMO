# Sticky DataTable row actions

## What changed

The shared desktop `DataTable` now keeps generated `rowMenu` actions pinned to the right edge while the table scrolls horizontally. The header and body action cells share a sticky-right class with an opaque `bg-card` surface, left border, tokenized left-cast shadow, and separate stacking levels (`z-[3]` for the header and `z-[1]` for body cells). Tables without `rowMenu` and the existing mobile card layout are unchanged.

This fixes the wide-table case where Sales Invoices row actions could scroll out of reach at 1280–1440px, while applying the behavior to every shared-table consumer rather than adding a page-specific workaround.

## Files carrying the change

- `pmo-portal/src/components/ui/DataTable.tsx` defines the shared sticky row-action class and applies it to the generated desktop actions header and cells.
- `pmo-portal/src/components/ui/__tests__/DataTable.test.tsx` verifies the sticky, surface, divider, shadow, and z-index classes for the generated header and body cell under `AC-TBL-STICKY-001`.
- `pmo-portal/e2e/AC-TBL-STICKY-001-sales-invoices-row-actions.spec.ts` supplies a read-only, network-stubbed Sales Invoices journey at 1280px and 1440px. It creates genuine horizontal overflow and checks that visible row-action button rectangles remain inside the `dt-table-branch` viewport.
- `DESIGN.md` records the desktop sticky `rowMenu` rule, surface/separation treatment, stacking behavior, and unchanged mobile placement.
- `docs/qa-portfolio.md` records the completed graduation for the Sales Invoices geometry contract and its retained design rule.
- `docs/plans/2026-10-08-sticky-row-actions-86adb8d0.md` contains the acceptance contract, implementation rationale, test strategy, verification commands, and traceability.

## Verification

From the repository instructions and plan, run the focused unit tests under the test lock:

```bash
scripts/with-test-lock.sh bash -c 'cd pmo-portal && npx vitest run src/components/ui/__tests__/DataTable.test.tsx src/components/ui/__tests__/DataTable.mobile.test.tsx src/components/ui/__tests__/DataTable.rowmenu-clip.test.tsx'
```

Run the owning browser geometry check with:

```bash
scripts/e2e-local.sh AC-TBL-STICKY-001-sales-invoices-row-actions.spec.ts
```

The plan also specifies the scoped final checks: typecheck plus changed-test coverage via `npx vitest run --changed origin/dev`, linting the touched TypeScript files, and the focused E2E journey. The browser spec itself asserts both real overflow and trigger-in-scroller geometry, rather than only checking `scrollWidth`.
