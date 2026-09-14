# ERPNext crossing — standalone → connected (spec)

**Status:** owner of `AC-XING-001..004` (written alongside plan task T1, per the plan's premise P-6). Rulings it
encodes: `OD-XING-1` (the crossing is a connect-time choice, default "start at connect"), `DD-XING-2` (the epoch is
the binding's activation), `DD-XING-5` (prove it before go-live, over a deliberate gap), ADR-0059 §4–§5 (derived
keys, the SoT-inversion guard) and Posture B invariant 7. Plan: `docs/plans/2026-09-14-erpnext-crossing-dryrun.md`.

## Requirements (EARS)

- **FR-XING-001** — While an org's ERPNext binding is active, when the sweep's timesheet backstop runs, the system
  SHALL push only weeks whose `approved_at` is at or after the binding's `activated_at`; weeks approved before it
  SHALL produce no ERPNext document, no side-mirror row and no outbox command. *(State-driven + event-driven.)*
- **FR-XING-002** — When the backstop catches up a stranded post-activation week, repeated sweep ticks SHALL leave
  exactly one submitted ERPNext Timesheet and exactly one confirmed outbox command for it (derived key + the `0134`
  single-use index). *(Event-driven.)*
- **FR-XING-003** — When the ERPNext feed presents a Timesheet that PMO did not originate, the system SHALL never
  mint a PMO timesheet, entry or mirror row for it, regardless of the document's date relative to `activated_at`,
  and SHALL raise an action-required notification naming the document. *(Event-driven; the date is not the mechanism.)*
- **FR-XING-004** — The Posture-B side mirror SHALL be exactly `timesheet_erp_mirror` and `budget_version_erp_mirror`,
  and dropping both with RESTRICT SHALL succeed without changing any PMO source-of-truth row count. *(Ubiquitous.)*

## Acceptance criteria (Given / When / Then) — one owning test each

| AC | Given | When | Then | Owning test (layer) |
|---|---|---|---|---|
| **AC-XING-001** | an active binding with `activated_at` back-dated one day; one week approved 12 h *before* it and one approved after | one sweep tick | the post-activation week has one ERP document and a `pushed` mirror; the pre-activation week has no ERP document, no mirror row, no outbox row | `e2e/serial/AC-XING-001-pre-binding-not-pushed.spec.ts` (served e2e) |
| **AC-XING-002** | one approved post-activation week with no mirror and no outbox row | three consecutive sweep ticks | after every tick exactly one submitted ERP document exists; exactly one outbox row, carrying the derived key, in state `confirmed` | `e2e/serial/AC-XING-002-catchup-rerun-no-duplicate.spec.ts` (served e2e) |
| **AC-XING-003** | an active binding with `activated_at` back-dated one day; a Desk-created, submitted Timesheet dated before it | the feed delivers it and a sweep tick runs | PMO timesheet / entry / mirror counts are unchanged; no `external_refs` mapping is claimed; an action-required notification names the document | `e2e/serial/AC-XING-003-pre-epoch-not-adopted.spec.ts` (served e2e) |
| **AC-XING-004** | the local schema at head, seeded | both side-mirror tables are dropped with RESTRICT inside a rolled-back transaction | the drops succeed; `timesheets`, `timesheet_entries`, `budget_versions`, `budget_line_items`, `projects` keep every row; the seed is non-empty (anti-vacuity) | `supabase/tests/0136_posture_b_side_mirror_droppable.test.sql` (pgTAP) |

## Notes

- The served specs run against any ERPNext bench (local v15 or the RIS v16 test site's `PMO Smoke Co`); the
  dry-run runbook in the plan confines them to that company and re-checks the Employee's company before any write.
- Nothing here asserts `pmo_epoch_at` — that column does not exist yet (plan premise P-4); the only epoch shipped
  code reads is `external_org_bindings.activated_at`.
