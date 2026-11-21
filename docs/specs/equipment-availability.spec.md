# Spec: Equipment availability, ownership and rental downtime (#2526)

**Status:** accepted; Director rulings adopt the recommended defaults below (2026-11-20). IDs `FR-EAV-###`, `NFR-EAV-###`, `AC-EAV-###`. Plan: `docs/plans/2026-11-20-equipment-availability.md`. Executor: Orca worker for status/metrics; the rental-invoice deduction is a money path and is Director-dispatched, shipping alone. Map #2516; blocked by #2517. Extends `docs/specs/equipment-usage.spec.md` (#1519) and `equipment_assets` (0447); does not replace the usage log or its costing settings.

## Job story

When a machine is down, I want to mark its status each day with proof and see how available and how busy each machine was, so that broken machines get escalated and a rented machine's downtime comes off the vendor's invoice.

## Context and boundary

- `equipment_assets` (0447) has code, name, default unit and archive; usage entries (`equipment_usage_entries`) carry approved work/standby quantities per asset, project and day.
- **Status** (what condition the machine is in) is separate from **usage** (what it did). Availability comes from status; utilisation from status plus approved usage.
- The rental invoice check is a read-and-compare against the vendor bill; it never posts, pays or edits the bill.
- Rented-asset rate is a vendor term recorded here. It is not the internal hire rate or costing setting of #1519; the two are independent (OQ-EAV-3).

## Definitions (used by the acceptance criteria)

For an asset and a period of N calendar days (inclusive):
- **Status day**: one status per asset per day. Statuses: `ready`, `standby`, `broken`, `at_vendor`, `waiting_parts`.
- **Available day**: status `ready` or `standby`. **Down day**: `broken`, `at_vendor`, `waiting_parts`.
- **Physical availability** = available days / days in the period that the asset was in service (owned or rented and not archived or not yet received) — a percentage to one decimal.
- **Utilisation** = approved `work` hours / (available days x working hours per day), working hours per day being an organisation setting (default 8, OQ-EAV-2). Unit `days` entries convert at one day = working hours per day.
- A day with no status recorded is **unrecorded**: it is excluded from both numerator and denominator and the period shows "n days unrecorded" (OD-EAV-2).

## Requirements (EARS)

**Ownership and rental terms**
- FR-EAV-001 The system shall let an authorized user mark each asset `owned` or `rented`. A rented asset shall have a vendor (existing company record), a rate and rate basis (per day or per month), a currency, and a rental start and optional end date.
- FR-EAV-002 The system shall keep rental terms effective-dated (rate changes do not rewrite history) and audited in record history.
- FR-EAV-003 An asset may be rented for several disjoint periods; periods of one asset shall not overlap.

**Daily status**
- FR-EAV-004 The system shall let an authorized user record one status for an asset on a date, with an optional note, and shall let them change it; every change is kept in history with actor and time.
- FR-EAV-005 A status date shall not be in the future and shall not precede the asset's in-service date.
- FR-EAV-006 When an asset becomes `broken`, `at_vendor` or `waiting_parts`, the system shall record the start of a **downtime period**; the period ends on the first following `ready` or `standby` status.
- FR-EAV-007 Downtime shall accept proof: one or more attachments (photo, vendor ticket) and a note, via the shared private attachment mechanism; a downtime period is **proven** when it has at least one attachment (OD-EAV-3).
- FR-EAV-008 The system shall provide a bulk "set today's status" screen listing assets with their last status, usable on a phone.

**Escalation**
- FR-EAV-009 When an asset has been in a down status more than 2 consecutive days (OD-EAV-1), the system shall notify the equipment managers once per downtime period (and again at a stated interval if still down, OQ-EAV-4) through the existing notification mechanism, and flag the asset on its screen.
- FR-EAV-010 Escalation shall be computed from status data by a scheduled job or at read time, not from a client clock; an asset with no status for the last day is not escalated, only shown as unrecorded.

**Metrics**
- FR-EAV-011 The system shall show physical availability and utilisation per asset per day, week (Monday start) and month, and for a selected set of assets, using the Definitions above.
- FR-EAV-012 Metrics shall use only `Approved` usage entries and shall name the count of unrecorded days. A figure with unapproved usage pending shall say so.
- FR-EAV-013 Metrics shall be exact decimals rounded only for display, and shall be reproducible from the underlying rows (the screen offers the day-by-day table).

**Rental invoice check**
- FR-EAV-014 The system shall let a Finance user open a rented asset's rental period and see its **downtime deduction**: proven down days in the invoice period x the daily rate (monthly rate / days in that month; OQ-EAV-1), listed day by day with proof links.
- FR-EAV-015 The check shall compare the vendor invoice amount entered or linked by the user to rate x in-service days minus the deduction and show the difference; it shall not edit, post or pay the bill.
- FR-EAV-016 Unproven down days shall be shown separately and excluded from the deduction by default; the user may include them only with a stated reason, recorded (OD-EAV-3).
- FR-EAV-017 A deduction shall never exceed the invoice period's rental amount.

**Access**
- FR-EAV-018 Actions (set status, edit rental terms, view metrics, view rental check) shall be registered in the role matrix (#902) and gated by `can()`; RLS/RPC enforce. A field controller may set status, not rental terms or the check.
- FR-EAV-019 Status, downtime and rental rows carry `org_id` by default, with RLS on every new table.

## Non-functional requirements
- NFR-EAV-001 Metrics for one month of 200 assets read in one indexed query per page, bounded pagination.
- NFR-EAV-002 Phone-usable bulk status; `DESIGN.md` tokens; English and Bahasa Indonesia.
- NFR-EAV-003 Money exact decimals; dates are project-or-organisation calendar dates, never browser time.

## Acceptance criteria and owning layer

Hand calculation for the test month (30 days, 8 working hours/day): days 1-20 ready, 21-23 broken, 24-30 ready; approved work hours 80. Available 27 of 30 = **90.0%**; utilisation 80 / (27 x 8 = 216) = **37.0%**.

| ID | Given / When / Then | Layer |
|---|---|---|
| AC-EAV-001 | Given the test month above, when metrics are read, then availability is 90.0% and utilisation 37.0%, and the day table sums to the same. | Unit (pure function) + pgTAP (read model) |
| AC-EAV-002 | Given 3 unrecorded days, when metrics are read, then they are excluded from both terms and shown as "3 days unrecorded". | Unit |
| AC-EAV-003 | Given an asset marked broken on day 21 with no `ready` afterward, when day 24 is reached, then one escalation notice exists for that downtime period and none is repeated the same day. | pgTAP |
| AC-EAV-004 | Given an asset down only 2 days, when evaluated, then no escalation. | pgTAP |
| AC-EAV-005 | Given a status for a future date or before in-service date, when saved, then refused. | pgTAP |
| AC-EAV-006 | Given a rented asset with periods that overlap, when saved, then refused; disjoint periods are accepted. | pgTAP |
| AC-EAV-007 | Given a rate change on a date, when history is read, then earlier periods keep the earlier rate. | pgTAP |
| AC-EAV-008 | Given 3 proven down days in a 30-day month at a monthly rate of 30,000, when the invoice check opens, then deduction is 3,000 and expected amount 27,000; the entered invoice is compared and the difference shown. | Unit + pgTAP |
| AC-EAV-009 | Given an unproven down day, when the check opens, then it is listed separately and not deducted; including it requires a reason that is stored. | pgTAP |
| AC-EAV-010 | Given down days exceeding the period's rental amount, when computed, then the deduction is capped at the amount. | Unit |
| AC-EAV-011 | Given unapproved usage in the month, when metrics are read, then it is excluded and the figure is labelled. | Unit |
| AC-EAV-012 | Given a user in another organisation or without permission, when they read or write, then refused. | pgTAP |
| AC-EAV-013 | Given a field controller on a phone, when they set today's status for several assets and attach a photo to a broken one, then statuses save and the downtime shows proven. | E2E (one journey) |
| AC-EAV-014 | Given a Finance user, when they open a rented asset's invoice check for the test month, then the deduction and day-by-day proof list match AC-EAV-008. | E2E (one journey) |

## Errors
| Condition | Result |
|---|---|
| Overlapping rental periods; rented without vendor/rate | Field error |
| Status in the future / before in-service | Refused with reason |
| No proof on a down period | Shown "unproven"; excluded from deduction |
| Invoice amount missing | Check shows expected amount only |

## Director rulings (2026-11-20)

The Director adopts all OD-EAV-1..4 and OQ-EAV-1..4 recommendations below. Rental downtime deduction is a comparison only and does not add a cost line to usage costing.
| ID | Decision and default | If wrong, what breaks |
|---|---|---|
| OD-EAV-1 | Escalate when down more than 2 consecutive days, to users holding an equipment-manager permission. | Too eager buries real alerts; too late leaves rented machines billed while down. |
| OD-EAV-2 | An unrecorded day is excluded from availability, not counted as available. | Counting it available hides gaps; counting it down penalises late entry. |
| OD-EAV-3 | Only proven down days are deducted by default; unproven days need a reason to include. | Deducting without proof invites a vendor dispute. |
| OD-EAV-4 | `standby` counts as available (physically ready) but not as utilised. | Treating standby as down understates availability. |
| OQ-EAV-1 | Is a monthly rate prorated by calendar days of that month or by a fixed 30? Default calendar days. | Deduction differs from the vendor contract. |
| OQ-EAV-2 | Working hours per day per organisation (default 8) or per asset? | Utilisation differs from the hand calculation. |
| OQ-EAV-3 | Does a rented asset's rate here also feed the #1519 hire-rate costing, or stay separate? Default separate. | Double or missing equipment cost on projects. |
| OQ-EAV-4 | Repeat escalation interval (default daily after the first). | Silence or noise. |

## Delivery checklist
- [x] Director adopted OD-EAV-1..4 and OQ-EAV-1..4 defaults.
- [ ] Status/metrics slice and the invoice-check slice ship separately; the latter alone (money).
- [ ] Glossary: physical availability, utilisation, downtime period, proven downtime.
