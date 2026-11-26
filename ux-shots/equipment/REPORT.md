# Equipment screens: order-of-work round (ui/1126-equipment)

Branch `ui/1126-equipment` (from `origin/batch/1126-ui`, merged again before READY). Screenshots are on this branch only (`shots/1126-equipment`), under `ux-shots/equipment/{before,after}/{admin,equipment-officer,equipment-manager}/<screen>-<lang>-<width>[-full].png`. `state-*` files show interaction states.

## Purpose and structure (settled before layout)

| Screen | Who / the one question | Structure after (worst first) |
|---|---|---|
| Machine page `/equipment/assets/:id` | Officer: "Is this machine OK to work, and what does it cost us?" | Header (name, Owned/Rented pill, code, key facts) → Documents (expired / due-soon marks) → Rental terms (table; edits in dialogs + ⋯ menu) → Vendor response (table) → Usage → Costing → Allocations |
| Availability `/equipment/availability` | Officer/Manager: "Which machines can work today, and how did each do this month?" | Toggle Status / Rental check → Status table → This month (filters row + figures table) · settings in a drawer · legend in the one help |
| Equipment home `/equipment` | Officer: "Set today's status for every machine" | Nav buttons → the same status table, dated today |
| Expiring documents `/equipment/expiring` | Officer: "What must I renew, soonest first?" | One table grouped Expired (red count) / Due in 30 days, worst row first |
| Monthly plan `/equipment-plans` | Manager: "What does this project need this month, and do I approve it?" | Project + month toolbar → plan panel (status, waiting-for, actions in its header) → lines table with Amount and Month total |
| Assets, person, plan settings, hours log, rental check | register / record / settings | same frame as above: header actions grouped, panels, tables |

Text sketch, machine page (1440):

```
[icon] Mobile crane 50t …                      (Rented)
       EQ-CRN-02
 ─ Logged in: hours ─ In service since: 28 Aug ─
┌ Documents ─────────────────────── [Add document] ┐
│ Document | Number | Expires | (Expired / Due soon) | Edit Archive │
┌ Rental terms ───────────── [Add rental terms] [⋯] ┐
│ Start | End | Vendor | Rate (right) | Per         │
┌ Vendor response · Usage · Costing · Allocations ┐
```

Availability (1440):

```
Availability (?)                       ← help: what each status does; unrecorded days
[Equipment status | Rental invoice check]
┌ Equipment status ──────────────── [Save statuses] ┐
│ Status date [26 Nov 2026]                          │
│ Machine | Recorded | Proof | Escalation | Set status │
┌ This month ──────────────── [Targets and hours] ┐
│ Interval · From · To · Machines                  │
│ Machine | Period | Availability | Days available | Utilisation | Awaiting | Unrecorded │
```

## What changed and why (ten lines)

1. Machine page: the open rental-terms form (and a raw vendor id) is now a terms table; add / change rate / in-service / mark owned open their own dialogs. Every block is a record panel in job order.
2. Status list ("not even a table"): one table on home and Availability, with Recorded, Proof, Escalation and Set status in their own columns.
3. Availability ("too much for one component"): status entry, month figures, settings and the legend are four homes, not one block.
4. Expiring documents: grouped table; number under its document; days left right-aligned; Open link folded into the name; Renew no longer clipped at 1440.
5. Monthly plan: lines were a stack of 8-field cards; now a table with per-line Amount and the month total under the Amount column; a new/edited line opens in place as its form.
6. Plan settings: both checkboxes had no visible label; fixed. Categories one line each.
7. Breadcrumbs: machine and person pages stuck on "Loading…", plan pages said "Not found"; fixed in the shell (own commits).
8. Assets: Import grouped with New asset; ownership column (already loaded); vendor table fits its panel.
9. Empty states are one line (no empty table frames).
10. Words: page-explaining sentences moved into the one help; no information removed.

## Measured edges (1440×900, same data, Admin)

| Screen | Measure | Before | After |
|---|---|---|---|
| Home | status control left x | 1237 (list rows) | 1157 (one column) |
| Home / Availability | machine code left x | 261 (list inset) | 273 (panel inset = heading inset 273) |
| Availability | right-aligned figure columns, distinct right x per column | 3 columns, 1 each | 4 columns, 1 each (one edge per column) |
| Availability | tables on page | 1 | 2 (status + month) |
| Expiring | right-aligned Days left column | none (left, wrapped) | one edge x=1061 |
| Expiring | actions visible at 1440 | Renew clipped at 1415+ | inside panel |
| Machine page | heading left edges | 248, 273, 325 (form bare on page) | 273 panels, 333 title (after icon) |
| Machine page | figure columns ending past panel | rate figures in a sentence | Rate column one edge x=1180 |
| Assets | vendor table last figure right x | n/a (raw table, left aligned) | 1391, inside panel (was 1445 overflow mid-round, fixed) |

## Screenshots

- BEFORE / AFTER, Admin, EN + ID, 1440 / 1024 / 390, nine routes: `before/admin/`, `after/admin/`
- Job roles (EN, 1440/1024/390): `{before,after}/equipment-officer/`, `{before,after}/equipment-manager/` for home, expiring, availability, machine
- States: `after/admin/state-{status-being-set,rental-check,targets-drawer,help-open,rental-terms-dialog,rental-menu,plan-lines}-en-{1440,390}.png`; before: `before/admin/state-{status-being-set,rental-check,rental-other-actions,plan-lines}-…`

Sample data (local only): created as Admin through the app's own API (same RLS): 6 machines (3 rented via `create_rented_equipment_asset`), 3 people, 5 document types, 8 expiring documents, 10 days of statuses; the plan switched on and one category + one draft plan via the app UI. The three rental terms' vendor was then pointed at a Vendor-type company directly in the local DB. Two local job-role logins for renders: an Equipment Officer and an Equipment Manager.

## Skill lines applied

- restructure: "Freeze the feature floor before any edit" — every figure kept a home (table below); "Compose the whole screen once" — availability split by question, not card patches.
- restructure/compose: "Long work … one table when the data is rows"; "Keep known-zero, empty, missing … distinct" — one-line empties.
- restructure/craft: "Align reading edges and shared numeric columns with one grid template" — status and plan lines moved from flex rows to tables; "Keep numeric columns right-aligned and tabular".
- screen-rules: "Exception colour appears ONCE per group" — Expired count pill + only the most urgent row red; "At most ONE help control per screen" — legend + unrecorded note in it; "Empty state: one line".
- impeccable: `detect` (via ux-proof) 0 findings on all 8 routes.
- taste: panel-void flagged the empty Documents band (81px) → fixed to one line.

## Journeys and gates (seen passing)

- `npm run check:guards` pass · `npm run typecheck` pass · eslint on 27 touched files pass · `vitest related` 184 files / 2304 tests pass (on the merged head).
- Journeys (24 specs, all passed): chromium JOB-E1, E3, E4, E5, E6, E8, CF-EQ-1, CF-EQ-4, CF-EQ-6, PC9-equipment-identity, H3, AC-EAV-013, EAV-014, HRE-004, EQU-019, EPS-006, GR-gap-rights, PCP-001; serial AC-EQP-017, JOB-E2, AC-EQU-SPLIT, AC-NATIVE-EQU, AC-PPL-010, JOB-F14-expiry. (affected-e2e listed 464 because the shell files fan out; I ran the ones that open these screens.)
- Journey steps updated (goals unchanged): JOB-E1 (terms entered in their dialog; toast "Rental terms saved"), JOB-CF-EQ-1, AC-EAV-013 (machine row is a table row, not a list item), JOB-E5, JOB-E3 (name the table they read; E3 reads 80% and "20 of 25 days" in two cells of the same row).
- Unit tests updated (steps only): rental terms open their dialogs; Mark owned confirms; targets/hours open the drawer; status row is `tr`; target label "target 90%". Added: breadcrumb resolves the machine from the paged register and the person from its own read; a role without settings sees no settings button.
- `scripts/ux-proof.sh` (8 routes): text size, inputs, targets, overflow, impeccable, axe all clean. Exit 1 on layout fingerprints not in the baseline and "missing shrink-only target baseline" (baseline not edited by me). Remaining measured gaps: (a) flush panel + table heading-to-content 31px on home status and Assets vendor table — RecordSection flush header + table head, a shared relation; (b) RecordSection `subline` 7px under heading on plan settings (pre-existing); (c) person page checklist 25px (pre-existing); (d) Assets "Showing 7 of 7" footer at x=261 (shared DataTable footer).

## Owner to confirm

- Machine page: rental terms form replaced by a table + "Add rental terms" dialog; "Change rate from date", "Save in-service date", "Mark owned" moved into the ⋯ menu; Mark owned now asks first.
- Availability: "What each status does to planning" and the unrecorded-days sentence moved into the page help (?); working hours and targets moved into a "Targets and hours" drawer.
- Availability month table: "x of y days" and "awaiting approval" are their own columns; target shown under the column header.
- Expiring: the separate "Open" link removed — the name opens the record; Person/Equipment shown under the name.
- Plan: intro sentence moved into the help; total shown only once there are lines.
- Person page: "Mark as left" moved into the header menu; pill "Active" added.
- New label "Escalation" for the down-too-long column; "Recorded" for the saved status.

## Needs a data change

- **Equipment Officer cannot read equipment documents.** Signed in as the Equipment Officer job role, `/equipment/expiring` reads "Nothing expires" and the machine's Documents panel is empty, while Admin sees 8 and the Manager 5. Cause: the read rule on expiry documents admits equipment documents for the Admin and Project Manager access levels only; the Equipment Officer job sits on the Engineer access level. Needs a policy change granting the officer job read (and renew, if intended) on equipment documents. Not worked around.

## Not done

- No chart added (availability per machine as sorted bars would fit; not built this round).
- Baselines for ux-proof not seeded; shared RecordSection/DataTable gaps (above) left for the component owner.
- The vendored-skills script fails on two moved upstream repos (`gstack/cso`, `jeffallan` skills); I vendored the rest with a temporary tolerant copy (not committed).
