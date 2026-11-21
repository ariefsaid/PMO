# Plan: payment channel on a purchase request (#2698)

Spec: `docs/specs/purchase-payment-channel.spec.md`. Gates: `npm run check:guards`, `npm run typecheck`, eslint on changed
files, touched vitest files. pgTAP is written, not run, by the builder (orchestrator proves it per wave).

## Migrations (numbers 1355 to 1356 only; each with a rollback)

1. `supabase/migrations/1355_payment_channel_schema.sql` (rollback `supabase/migrations/rollback/1355_payment_channel_schema_down.sql`)
   - `org_payment_channel_settings(org_id pk fk, enabled bool default false, enabled_at, updated_by, updated_at)`.
   - `org_payment_channels(id, org_id fk, name, archived_at, sort_order, created_by, created_at)`; unique index on
     `(org_id, lower(name)) where archived_at is null`; name length check 1..60.
   - `alter table procurements add column payment_channel_id uuid references org_payment_channels(id)` (nullable; no
     update grant added, so RPC-only); index on it.
   - RLS enabled and forced on both tables; select policy `org_id = (select auth_org_id()) and (select is_active_member())`;
     revoke all then grant select only to `authenticated` (pattern: `1018`).
2. `supabase/migrations/1356_payment_channel_rpcs.sql` (rollback `.../1356_payment_channel_rpcs_down.sql`)
   - `set_payment_channel_settings(p_enabled boolean)`: Admin only, upsert, seed four general rows when the org has none,
     `log_audit`. Pattern: `set_three_way_match_settings` (1018).
   - `save_payment_channel(p_id uuid, p_name text)` (null id adds) and `archive_payment_channel(p_id uuid, p_archived boolean)`:
     Admin only, feature on.
   - `set_procurement_payment_channel(p_id uuid, p_channel_id uuid)`: the `update_procurement_header` rule (0393): active
     member, `org_feature_enabled(org,'procurement')`, row locked in caller's org, status Draft or Rejected, requester or
     Admin; plus feature on and channel live in the same org. Every refusal 42501.
   - `revoke all ... from public, anon; grant execute ... to authenticated`.
   - NOT touched: `create_procurement_with_items` (re-created by #2697), `update_procurement_header`, `transition_procurement`.
3. Fragments: `supabase/tests/inventory/anon-executable-definers/payment-channel.txt` (four RPCs) and
   `scripts/isolation-probe-denominator.d/payment-channel.*` for the two tables (read both scripts' headers for the format).

## Tests (written first)

| AC | Layer | File |
|---|---|---|
| AC-PCH-001..008 | pgTAP | `supabase/tests/payment_channel.test.sql` (two orgs, roles Admin, Finance, PM, requester; incl. direct-update refusal) |
| AC-PCH-012 | pgTAP | existing 0178 and 0646 with the fragments |
| AC-PCH-009 | Unit | `pmo-portal/pages/ProcurementDetails.paymentChannel.test.tsx`, `pmo-portal/pages/finance/PayablesPage.paymentChannel.test.tsx` (new files; existing tests untouched) |
| AC-PCH-010 | Unit | `pmo-portal/pages/procurement/HeaderEdit.paymentChannel.test.tsx` (file name per the existing header-edit component) |
| AC-PCH-011 | Unit | `pmo-portal/pages/admin/OrgPaymentChannels.test.tsx`, DAL `pmo-portal/src/lib/db/paymentChannels.test.ts` |

## Code

- DAL `pmo-portal/src/lib/db/paymentChannels.ts` (settings, list, save, archive, set on request; no org_id sent; the new RPCs
  are not in generated types, so use the one-cast pattern of `threeWayMatch.ts`); repository `src/lib/repositories/` entry;
  hook `src/hooks/usePaymentChannels.ts` (`enabled`, `channels`).
- Procurement select adds `payment_channel:org_payment_channels(id,name)` only when the hook says on (so off orgs run the
  unchanged query; the select string is built where `procurements.ts` builds it, behind the flag).
- Details tab: a "Payment channel" row beside payment status in `pages/procurement/ProcurementDetailTabs.tsx`, only when on.
- Payables: a "Payment channel" column in `pages/finance/PayablesPage.tsx` only when on.
- Header edit: Payment channel `SelectField` (shared primitives) gated by `usePaymentChannels().enabled` and a UX `can()`; save
  via `set_procurement_payment_channel`.
- Admin: `pages/admin/OrgPaymentChannels.tsx` (switch + list with add, rename, archive; `ListState`, `ConfirmDialog` for
  archive), mounted next to `OrgProcurementGates` for the `manage orgAccounting` permission.
- Strings: English and Bahasa Indonesia in the existing translation namespaces. Glossary: "Payment channel" in
  `docs/glossary.md`. No ADR (not architectural).

## Order

1. pgTAP file, then migrations 1355 and 1356 with rollbacks and fragments.
2. DAL, repository and hook tests, then code.
3. UI tests then components; strings; glossary.
4. Gates; push after each commit. Mutation notes are in spec section 7.

## Open questions

- Should Finance also set the channel after the Draft or Rejected stage? This plan follows the existing header rule
  exactly; widening is a separate, deliberate rule change.
- Starter rows: four general names; the Director may prefer an empty list even on switch-on.
