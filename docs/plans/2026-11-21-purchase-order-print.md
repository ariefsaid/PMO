# Implementation Plan: Printable Purchase Order with Authorised-to-Collect Line (#2688)

> Builds on #2687 (printable delivery note and shared print helpers). Spec: `docs/specs/purchase-order-print.spec.md`. Role contract: `.claude/agents/implementer.md` (UI parts: `ui-implementer.md`). Map #2516 (contractor field operations by 15 Dec 2026).
> Reuses: `pmo-portal/src/components/print/*`, `pmo-portal/pages/DeliveryNotePrint.tsx` pattern, `pmo-portal/src/lib/repositories/procurement.ts`.

## Architecture & Seams

1. **Database Schema & RPC** (`supabase/migrations/1444_purchase_order_print.sql`):
   - Table `public.purchase_order_settings`:
     - `org_id uuid primary key references public.organizations(id) on delete cascade default (select auth_org_id())`
     - `print_enabled boolean not null default false`
     - `authorised_collectors text[] not null default array[]::text[]`
     - `signature_blocks text[] not null default array['Prepared by', 'Approved by', 'Vendor acceptance']`
     - `updated_by uuid references public.profiles(id)`
     - `updated_at timestamptz not null default now()`
   - Bounded list validation helper functions:
     - `check_collector_names_bounded(text[])`: <= 50 elements, each non-empty between 1 and 100 characters.
     - `check_signature_blocks_bounded(text[])`: <= 10 elements, each non-empty between 1 and 80 characters.
   - CHECK constraints on `purchase_order_settings` using bounded helper functions.
   - RLS policies with `(select helper())` wrapping on `public.purchase_order_settings`.
   - Before-insert trigger `purchase_order_settings_stamp_org_id` using `public.stamp_org_id()`.
   - Security-definer RPC `public.po_set_print_settings(p_enabled boolean, p_signature_blocks text[], p_authorised_collectors text[])` (Admin-only).
   - Reversible in `supabase/migrations/rollback/1444_purchase_order_print_down.sql`.
   - Proven by pgTAP `supabase/tests/purchase_order_print_settings.test.sql` (AC-POP-009, AC-POP-010, AC-POP-011, AC-POP-012).

2. **Data Access Layer & Hooks**:
   - `pmo-portal/src/lib/db/purchaseOrderSettings.ts`:
     - `getPurchaseOrderSettings(): Promise<PurchaseOrderSettings>`
     - `setPurchaseOrderSettings(enabled: boolean, signatureBlocks: string[], collectors: string[]): Promise<void>`
   - Repository seam extension in `pmo-portal/src/lib/repositories/procurement.ts`:
     - `purchaseOrderSettings(): Promise<PurchaseOrderSettings>`
     - `setPurchaseOrderSettings(...)`
   - Hook `pmo-portal/src/hooks/usePurchaseOrderSettings.ts`:
     - `usePurchaseOrderSettings()` query
     - `useSetPurchaseOrderSettings()` mutation

3. **Printable View (`PurchaseOrderPrint.tsx`)**:
   - Route `/procurement/:procurementId/purchase-orders/:orderId/print` registered in `App.tsx` (with chunk preloading and namespace declarations).
   - Reuses `PrintDocument`, `PrintActionBar`, `PrintHeader`, `PrintTable`, `PrintSignatureBlocks`.
   - Header with org name, PO number, dates, vendor, project, work order attribution, and currency.
   - Dedicated "Authorised to collect" section:
     - Selectable collector filter in screen action bar (All vs specific collector).
     - Renders configured named collectors or selected collector; fallback line for paper signing if no collectors configured.
   - Line items table rendering procurement items with rate, quantity, amount, and total.
   - Physical signature blocks with wet-ink signing area.

4. **Procurement Ledger & Details Integration**:
   - When `print_enabled` is true, row menu on `PO` rows in `ProcurementLedger.tsx` includes "Print purchase order".
   - In `ProcurementDetails.tsx`, if purchase order exists and printing is enabled, action is available.
   - When `print_enabled` is false, no actions are rendered, preserving existing behavior untouched.

5. **Settings UI Integration**:
   - `pmo-portal/pages/admin/PurchaseOrderSettingsSection.tsx` under `/administration/accounting` (alongside `OrgProcurementGates`).
   - Switch for `print_enabled`.
   - List editor for named collectors (add, remove, edit, bounded count).
   - List editor for signature blocks (add, remove, edit).

6. **Localization**:
   - English and Bahasa Indonesia strings in `procurement.json` and `administration.json`.

---

## Slices & TDD Order

### Slice 1: Database Migration & pgTAP Proof
- [x] Write pgTAP test `supabase/tests/purchase_order_print_settings.test.sql` asserting:
  - Table creation and default values (`print_enabled = false`, default signature blocks, empty collectors).
  - Admin can update settings via `po_set_print_settings` (AC-POP-009).
  - Non-Admin is refused with `PO_ADMIN_ONLY` (AC-POP-010).
  - Excessive collector count (>50) or length (>100 chars) is refused (AC-POP-011).
  - Cross-tenant access is blocked by RLS (AC-POP-012).
- [x] Implement migration `supabase/migrations/1444_purchase_order_print.sql`.
- [x] Implement rollback `supabase/migrations/rollback/1444_purchase_order_print_down.sql`.

### Slice 2: DAL & Repository Seam
- [x] Unit tests in `pmo-portal/src/lib/db/purchaseOrderSettings.test.ts`.
- [x] Implement `pmo-portal/src/lib/db/purchaseOrderSettings.ts`.
- [x] Expose through `pmo-portal/src/lib/repositories/procurement.ts`.
- [x] Implement `pmo-portal/src/hooks/usePurchaseOrderSettings.ts`.

### Slice 3: Purchase Order Print Screen
- [x] Unit tests in `pmo-portal/pages/PurchaseOrderPrint.test.tsx` verifying:
  - Full purchase order rendered with vendor, project, items, and total (AC-POP-007).
  - Disabled setting displays disabled state (AC-POP-003).
  - Authorised to collect line renders named collectors (AC-POP-004).
  - Selecting specific collector filters the line (AC-POP-005).
  - Empty collectors renders open line (AC-POP-006).
  - Print trigger calls `window.print()` (AC-POP-008).
- [x] Implement `pmo-portal/pages/PurchaseOrderPrint.tsx`.
- [x] Register route in `pmo-portal/App.tsx`.

### Slice 4: Admin Settings UI
- [x] Unit tests in `pmo-portal/pages/admin/PurchaseOrderSettingsSection.test.tsx`.
- [x] Implement `pmo-portal/pages/admin/PurchaseOrderSettingsSection.tsx`.
- [x] Mount in `pmo-portal/pages/Administration.tsx` under accounting panel.

### Slice 5: Procurement Ledger & Detail Integration
- [x] Unit tests in `pmo-portal/pages/procurement/ProcurementLedger.test.tsx` for PO print action (AC-POP-001, AC-POP-002).
- [x] Update `pmo-portal/pages/procurement/ProcurementLedger.tsx`.
- [x] Update `pmo-portal/pages/ProcurementDetails.tsx`.

### Slice 6: Localization
- [x] Add translation keys to `pmo-portal/public/locales/en/procurement.json` and `administration.json`.
- [x] Add translation keys to `pmo-portal/public/locales/id/procurement.json` and `administration.json`.

### Slice 7: Verification & Gates
- [x] `npm run check:guards`
- [x] `npm run typecheck`
- [x] `npx eslint --max-warnings=0 <changed files>`
- [x] `npx vitest related --run <changed files>`
- [x] Run VPS pgTAP: `/Users/ariefsaid/Coding/PMO/docs/private/vps-pgtap.sh feat/2688-purchase-order-print supabase/tests/purchase_order_print_settings.test.sql`
  — PASS, 20/20. Mutation-checked twice on throwaway branches (Admin gate removed → AC-POP-010 red; bounds helpers
  forced true → AC-POP-011 red 8×), then the throwaway branches deleted.

## Takeover corrections (2026-11-21)

A builder ran out of quota after the spec, plan, migration and DAL/hook commits, with the print screen, settings
section and procurement integrations uncommitted. Resuming from that state, the following were corrected before the
UI work was committed:

1. **Hook test workaround removed.** `usePurchaseOrderSettings` had grown a fallback `QueryClient` and an
   `enabled: Boolean(orgId && contextClient)` guard so unmounted providers would not throw in tests. That broke the
   committed hook test (query never ran) and put test scaffolding into production code. Restored the committed hook.
   The procurement page/ledger suites render without a query client or an authenticated session, so `test/setup.ts`
   stubs the hook off for them (the same treatment `useProjectsMoneyCollection` and `useThreeWayMatch` already get);
   the hook's own suite, the settings-section suite and the two print-action suites unmock it or set their own value.
2. **One route, not three.** Two speculative routes (`/procurement/:procurementId/print`,
   `/purchase-orders/:orderId/print`) were removed: the page resolves the order from the procurement detail, so both
   would have rendered the not-found state. Only `/procurement/:procurementId/purchase-orders/:orderId/print` remains.
3. **Locale catalogue aligned with the code.** Most page keys were missing from `en`/`id` and one key name differed
   (`notAvailable` vs `disabledNotice`), so Indonesian users would have seen English fallbacks — AC-POP-013 would not
   have held. Both catalogues now carry every used key, and unused keys were dropped.
4. **FR-POP-004 completed on the printed page.** The page now prints the procurement reference code and the currency
   (both were specified but missing) and localises the PO status through `recordStatusLabel`.
5. **Order is located by id.** A route whose `orderId` does not belong to the procurement shows the not-found notice
   instead of printing the first order (the previous fallback could print the wrong document).
6. **Bounds are proven at the table too.** The pgTAP suite now covers more than 50 collectors, more than 10 blocks, a
   null element, and direct writes that must hit the CHECK constraint (not only the RPC), plus a cross-org update that
   touches no rows. The helper functions now reject a null array element (previously `length(null)` was not 0).
7. **Settings section strings.** Remove-button aria labels, save states and the bound hints read from the catalogue
   (they previously fell back to `common.*` keys that do not exist), so both languages are complete.
