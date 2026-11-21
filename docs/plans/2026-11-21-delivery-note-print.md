# Printable Delivery Note Implementation Plan (#2687)

> Builds on #2524 (material requests against a work order). Spec: `docs/specs/delivery-note-print.spec.md`. Role contract: `.claude/agents/implementer.md` (UI parts: `ui-implementer.md`). Reuse, don't reinvent: `pmo-portal/pages/MaterialRequestDetail.tsx`, `pmo-portal/src/lib/i18n/orgTerms.ts`, `pmo-portal/src/lib/db/materialRequests.ts`. Prepares reusable print helper for #2688 (purchase orders).

## Architecture & Seams
1. **Database Schema & RPC** (`supabase/migrations/1420_delivery_note_print.sql`):
   - Extend `org_terminology` check constraint to include `'deliveryNote'`.
   - Add columns to `material_request_settings`:
     - `delivery_note_enabled boolean not null default false`
     - `delivery_note_signature_blocks text[] not null default array['Dispatched by', 'Delivered by', 'Received by']`
   - Security-definer RPC `mrq_set_delivery_note_settings(p_enabled boolean, p_signature_blocks text[])`.
   - Reversible in `supabase/migrations/rollback/1420_delivery_note_print_down.sql`.
   - Proven by pgTAP `supabase/tests/mrq_delivery_note_settings.test.sql` (AC-DNP-006, AC-DNP-007, AC-DNP-010).

2. **Terminology Layer**:
   - Add `deliveryNote` to `TERM_KEYS` in `pmo-portal/src/lib/i18n/orgTerms.ts`.
   - Add shipped default forms in `SHIPPED_FORMS` for `en` ("delivery note" / "delivery notes") and `id` ("surat jalan", "nota pengiriman").
   - Update localization catalogues (`en` and `id` in `materialRequests.json` and `administration.json`).

3. **Data Access Layer & Hooks**:
   - Extend `MaterialRequestSettings` interface in `pmo-portal/src/lib/db/materialRequests.ts`.
   - Add `getDeliveryNoteSettings()` and `setDeliveryNoteSettings()`.
   - Add `useDeliveryNoteSettings()` hook in `pmo-portal/src/hooks/useMaterialRequests.ts`.

4. **Generic Print Helper Components** (`pmo-portal/src/components/print/`):
   - `PrintDocument.tsx`: Paper container layout with `@media print` rules, print-hidden controls, and standard print styling.
   - `PrintHeader.tsx`: Organisation name, title from terminology, metadata grid (number, dates, references).
   - `PrintTable.tsx`: Table layout for items with unit, quantity, and notes.
   - `PrintSignatureBlocks.tsx`: Grid of signature boxes with configurable labels, space for signature, name, and date lines (with optional slot for ticket #2688 collector line).
   - `PrintActionBar.tsx`: Screen-only top navigation with Back button and Print button invoking `window.print()`.

5. **Screens & Views**:
   - `DeliveryNotePrint.tsx` (`/material-requests/:requestId/delivery-note`): Full printable page rendering the approved material request as a delivery note.
   - Register route in `pmo-portal/App.tsx`.
   - Update `pmo-portal/pages/MaterialRequestDetail.tsx`: Show "Print delivery note" button/menu item only when approved/fulfilled and `delivery_note_enabled` is true.
   - Update `pmo-portal/pages/MaterialRequestSettings.tsx`: Add Admin settings section for delivery note enablement and signature block labels.

## Slices & TDD Order

### Slice 1: Database Migration & pgTAP Proof
- [ ] Write pgTAP test `supabase/tests/mrq_delivery_note_settings.test.sql` verifying:
  - Default values on new columns (AC-DNP-002, AC-DNP-006).
  - Admin can update settings via `mrq_set_delivery_note_settings` (AC-DNP-006).
  - Non-Admin is refused with `MRQ_ADMIN_ONLY` (AC-DNP-007).
  - Cross-organisation access is blocked by RLS (AC-DNP-010).
  - `org_terminology` accepts `'deliveryNote'` term key (AC-DNP-004).
- [ ] Write migration `supabase/migrations/1420_delivery_note_print.sql` and rollback `1420_delivery_note_print_down.sql`.

### Slice 2: Terminology and Localization
- [ ] Add failing test in `pmo-portal/src/lib/i18n/orgTerms.i18next.test.ts` for `deliveryNote`.
- [ ] Update `pmo-portal/src/lib/i18n/orgTerms.ts` with `deliveryNote` in `TERM_KEYS` and `SHIPPED_FORMS`.
- [ ] Add translation strings to `public/locales/en/materialRequests.json`, `public/locales/id/materialRequests.json`, and `administration.json`.

### Slice 3: Data Access Layer & Settings RPC
- [ ] Unit tests in `pmo-portal/src/lib/db/materialRequests.test.ts` for `getDeliveryNoteSettings` and `setDeliveryNoteSettings`.
- [ ] Implement DAL functions in `pmo-portal/src/lib/db/materialRequests.ts`.
- [ ] Add `useDeliveryNoteSettings` in `pmo-portal/src/hooks/useMaterialRequests.ts`.

### Slice 4: Generic Print Helper Components
- [ ] Unit tests `pmo-portal/src/components/print/PrintHelper.test.tsx` for `PrintDocument`, `PrintHeader`, `PrintTable`, `PrintSignatureBlocks`.
- [ ] Implement components under `pmo-portal/src/components/print/`. Verify reuse potential for #2688.

### Slice 5: Delivery Note Print Screen & Route
- [ ] Unit tests `pmo-portal/pages/DeliveryNotePrint.test.tsx` verifying:
  - Approved/fulfilled material request renders complete delivery note (AC-DNP-005).
  - Terminology override reflects in title (AC-DNP-004).
  - Draft/pending request shows not-approved state (AC-DNP-003).
  - Disabled setting displays disabled state (AC-DNP-002).
  - Print button triggers `window.print()` (AC-DNP-006).
- [ ] Implement `pmo-portal/pages/DeliveryNotePrint.tsx` and register route in `App.tsx`.

### Slice 6: Material Request Detail & Settings UI Integration
- [ ] Unit tests in `MaterialRequestDetail.test.tsx` for conditional delivery note print action (AC-DNP-001, AC-DNP-002).
- [ ] Update `pmo-portal/pages/MaterialRequestDetail.tsx` to include delivery note print action.
- [ ] Unit tests in `MaterialRequestSettings.test.tsx` for delivery note configuration (AC-DNP-006).
- [ ] Update `pmo-portal/pages/MaterialRequestSettings.tsx` with delivery note settings editor.

### Slice 7: Verification & Gates
- [ ] `npm run check:guards`
- [ ] `npm run typecheck`
- [ ] `npx eslint --max-warnings=0 <changed files>`
- [ ] `npx vitest related --run <changed files>`
- [ ] Run remote pgTAP test suite via VPS runner: `/Users/ariefsaid/Coding/PMO/docs/private/vps-pgtap.sh feat/2687-delivery-note-print supabase/tests/mrq_delivery_note_settings.test.sql`
