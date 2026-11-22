---
status: proposed
date: 2026-11-22
---

# ADR-0121 — Organisation settings keep their own storage; the on/off ones share one front-end module, and every change gets one audit line

- **Issue:** #2746 (map #1533). **Spec:** `docs/specs/org-settings-module.spec.md`. **Plan:** `docs/plans/2026-11-22-org-settings-module.md`.
- **Migrations:** `1510_org_setting_audit.sql` (slice 3), `1511`–`1515` (one per money-path slice).
- **Relates to:** ADR-0016 (`can()` is UX, the server decides), ADR-0017 (repository seam), ADR-0049 (Operator
  entitlements in `org_features`), ADR-0003 (generated database types).

## Context

The 15 December round added about thirty organisation settings: 27 `organizations` columns and 14 `*_settings`
tables (inventory: the spec). Each was built as a stack of shallow parts: a getter, a setter, a data-access pair, a
repository pair, a hook, an Admin card and a `policy.ts` line. The parts vary in incidental ways (freshness window,
control shape, error display, audit) and the next on/off setting costs as much as the first.

The architecture pass proposed one `org_settings(org_id, key, value jsonb)` table with a key registry, a generic
getter and setter, and migrating every column and table into it.

Read against the code, the settings are three different things:

1. **One on/off value** with no companion field (13 of 30). Even here, three seed rows on first turn-on, one
   counts only while another is on, one swaps the price read path, and two are refused when the ERP owns stock.
2. **Groups validated together** (17): both-or-neither (reservation borrow role and label), a target that needs a
   currency, `0 < low < 1 < high`, a mode change refused while transfers are in flight, foreign keys to roles and
   people. These rules are CHECK constraints, foreign keys and preconditions in the setter.
3. **Real per-key rows** (email event settings), already a keyed table.

SQL reads them in RLS policies and definer functions through typed columns and helpers
(`stock_wo_transfers_on(org)`, `labour_cost_enabled(org)`, `safety_records_enabled()`, …), several on money paths.
The release is on `main`, not yet in production, with a client acceptance weeks away.

## Decision

1. **Storage stays as it is.** No `org_settings` key/value table. A setting keeps its typed column or table, its
   CHECK and foreign keys, its setter's preconditions and its typed SQL readers.
2. **One front-end module for organisation switches** (on/off settings):
   `src/lib/repositories/orgSwitches.ts` (the registry: per key, where the value is read and written, the `can()`
   entity, the writer roles, the dependent query roots), `src/hooks/useOrgSwitch.ts` (`useOrgSwitch(key)`,
   `useSetOrgSwitch(key)`) and `src/components/admin/OrgSwitchSetting.tsx` (the card). One query key family
   `['org-setting', orgId, key]`, one freshness policy (`SERVER_SESSION_QUERY_OPTIONS`), one inline refusal display.
   A registry entry is either an **existing server read/write pair** (the adapter for switches that already have
   an RPC) or a **column** of `organizations` (the adapter for Admin-only switches written under the column grant
   and the existing Admin update policy, as rows 1, 5, 9 and 17 of the inventory already are).
3. **A new Admin-only switch is a column, not an RPC:** `boolean not null default false`, `grant update (col)`, one
   registry entry, one `<OrgSwitchSetting>` line, its i18n strings, and its name added to the audit trigger. A
   switch whose writers are not Admin alone (Admin + Finance, say) still gets its own setter RPC: the role gate
   lives in the database, not in a registry the server would have to interpret.
4. **One audit rule, in the database:** a trigger function `audit_org_setting_change()` attached to `organizations`
   and to each settings table, with the setting columns as trigger arguments, writes one `org.setting.change`
   event (`setting`, `from`, `to`, actor) whenever a listed column changes value, whichever path wrote it. Setters
   that already write their own domain event keep it; nothing is restated.
5. **Grouped settings keep their forms.** They get the audit line, and they may adopt the freshness policy when
   next touched; they do not go through the switch module.
6. **Organisation setting ≠ feature entitlement.** Settings are Admin-owned choices inside an org; entitlements
   (`org_features`, plans) stay Operator-owned (ADR-0049, #1718). The module never reads or writes `org_features`.

## Rejected

- **One key/value table with a registry (the candidate).** It moves validation out of CHECK constraints and foreign
  keys into a registry interpreter, makes the generic setter a security-definer function that picks its target
  and its role gate from data, and forces every SQL reader, several on money paths, to be rewritten to read jsonb.
  It buys, for one-boolean switches only, what decision 3 buys with a column and no rewrite. No user-visible break is fixed by it.
- **A generic `set_org_setting(key, value)` over the existing columns (dynamic SQL).** Same definer-picks-target
  surface, to save a three-line migration.
- **One read of every switch in one request.** Switches have different read audiences (some Admin/Finance only), so
  one read needs per-key audiences in a definer. No measured cost asks for it; revisit with a profile.
- **Moving settings from the six other screens into Administration.** A screen change; the owner's call.

## Consequences

- An on/off setting's front end drops to one registry entry and one card line; the shared hook is tested once.
- `can()` and the server can still drift, as everywhere under ADR-0016; a unit test pins each entry's `can()` roles
  to its declared writers, and the existing per-feature pgTAP files pin the server side.
- The column adapter writes `organizations` directly from the client under RLS and a column grant, the same path
  the clearance checklist uses today. Its type comes from the generated database types once they are regenerated
  (the typed-client ticket); until then the registry names the column as a string literal.
- Where settings sit on screen is unchanged. Card look changes (one switch card) go to the owner as screenshots.
- Reversal: slices 1–2 are front-end only (revert the PR). Slice 3 drops one trigger function and its triggers
  (`rollback/1510_org_setting_audit_down.sql`); audit rows already written stay, as audit rows do.
