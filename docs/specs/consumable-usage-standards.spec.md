# Spec: Consumable needs from usage standards (#2577)

**Status:** proposed; owner decisions below need sign-off before build. IDs `FR-CUS-###`, `NFR-CUS-###`, `AC-CUS-###`. Plan: `docs/plans/2026-11-20-consumable-usage-standards.md`. Executor: Orca worker for the standards table, the screens and the plan generation; the change to the plan figure the approval check reads (`mrq_plan_quantity`) sits on the approval path and is Director-dispatched, shipping alone. Map #2516; extends `docs/specs/material-requests.spec.md` (#2524, plan figure) and the BoQ material allowances (0417); blocked by #2524 server slice (shipped 1000-1001). Does not replace allowances: they stay as the hand-entered plan.

## Job story

When a work order is planned, I want the consumables it needs (for example welding rod per dia-inch welded) worked out from its planned work using our usage standards, so that a material request is checked against a justified need instead of a guess.

## Context and boundary

- **Planned work** already exists: a work order carries allocations of contract (BoQ) lines (`work_order_lines`, 0337: `work_order_id`, `boq_item_id`, `quantity numeric(14,3) not null check (quantity > 0)`, unique per work order and contract line; `quantity` is the allocated quantity, there is no executed column on it); each `boq_items` row has a free-text `unit` and a quantity (0250). Consumables are stock items (`stock_items` with `stock_units`, 0412).
- **Plan today** (#2524): `mrq_plan_quantity` reads the BoQ material allowances (`boq_material_allowances`, 0417, hand-entered per BoQ line), prorated by the work order's share of the BoQ line; no allowance means plan 0, so every requested line is over plan and needs a reason (FR-MRQ-002, enforced in `mrq_submit`). That check is the "warn" this feature builds on; nothing here blocks a request (OD-CUS-3).
- **Shipped plan figure, exactly** (1001, unchanged on `dev`): `mrq_plan_quantity(p_work_order_id uuid, p_item_id uuid) returns numeric`, SQL, stable, security definer, executable by no client role (internal). It returns `round(coalesce(sum(allowance.planned_quantity x least(work_order_line.quantity / boq_item.quantity, 1)), 0), 3)` over the work order's lines joined to `boq_material_allowances` for the item (a `boq_items.quantity` of 0 counts as share 1); so today the precedence is allowance, else 0, and there is no source. `mrq_submit(p_request_id uuid, p_client_request_id uuid default null)` calls it per line under a per-work-order advisory lock, computes `v_prior` with `mrq_prior_quantity`, raises `MRQ_OVER_PLAN_REASON` (errcode 23514) when `prior + quantity > plan` and the line has no `over_plan_reason`, then **snapshots** `plan_qty` and `prior_qty` onto `material_request_lines` in that same loop. `mrq_plan_for(p_work_order_id uuid, p_item_ids uuid[], p_exclude_request uuid default null)` is the client-callable read of the same two internals and returns `table (item_id uuid, plan_qty numeric, prior_qty numeric)`; `material_request_lines` has `plan_qty`, `prior_qty`, `over_plan_reason` (1000) and no source column. Nothing but `mrq_submit` writes the snapshot, so a later change to a plan or allowance cannot reach a submitted line (FR-CUS-013).
- **New here:** (1) usage standards, an organisation list of "this consumable, this much per unit of work"; (2) a **consumable plan** per work order, generated from its work-order lines x matching standards, stored as a snapshot and adjustable with a reason; (3) the plan figure used by material requests reads the consumable plan first, then falls back to allowances (OD-CUS-2). The over-plan reason rule stays in `mrq_submit`, server-side, unchanged; only the figure it compares against changes.
- It computes quantities only. No cost, price, posting or stock movement is created. Standards and plans are internal data; no external system is involved. Bulk loading of standards belongs to the import templates (#2530), as one more descriptor; it is not built here.

## Definitions

- **Usage standard**: a consumable stock item, a **work unit** (the contract-line unit it applies to, matched case-insensitively and trimmed against `boq_items.unit`, e.g. `dia-inch`), an optional **contract-line code prefix** narrowing it to a family of lines (e.g. `WLD`), a **quantity per work unit** (up to 6 decimals, in the item's own unit) and a **margin %** (default 0, covers waste).
- **Matching**: a standard applies to a work-order line when its work unit equals the contract line's unit and, if a prefix is set, the line's code starts with it (case-insensitive). When several standards for the same item match one line, the one with the longest prefix wins; a tie is refused at save (FR-CUS-003).
- **Consumable plan line**: for one work order and one item, `generated_qty` = round(sum over matching lines of work-order-line quantity x quantity per unit x (1 + margin/100), 3), **rounded once per item**, never per line; `adjusted_qty` (optional, with reason); **planned qty** = `adjusted_qty` if set, else `generated_qty`.

## Requirements (EARS)

**Standards**
- FR-CUS-001 The system shall let an authorized user create, edit and archive usage standards with item, work unit, optional code prefix, quantity per work unit (> 0, 6 decimals) and margin % (0 to 100); archived rather than deleted (ADR-0018), and every change kept in record history with actor and time.
- FR-CUS-002 A standard shall name an active stock item of the same organisation; the item's own unit is the unit of the quantity and is shown beside it.
- FR-CUS-003 Two active standards for the same item with the same work unit and the same prefix (including both empty) shall be refused.
- FR-CUS-004 The standards screen shall list standards with filter by item and work unit and bounded pagination, and shall show for each how many work-order lines in live work orders it currently matches.

**Consumable plan generation**
- FR-CUS-005 When an authorized user asks to generate the consumable plan of a Draft or Issued work order, the system shall compute one plan line per item from the work order's lines and the active standards, store it with the basis (for each contributing line: contract line, work quantity, standard, quantity per unit, margin, result) and the time and user, in one transaction.
- FR-CUS-006 Generation of a Closed or Cancelled work order shall be refused.
- FR-CUS-007 When a plan already exists, regeneration shall recompute `generated_qty` and basis for every item and keep each `adjusted_qty` and its reason; an item whose standard no longer matches keeps its row only if adjusted, otherwise the row is removed. The screen shall show the old and new generated quantity before the user confirms.
- FR-CUS-008 When the work order's lines or the matching standards change after generation, the system shall mark the plan **out of date** (computed from a fingerprint of the inputs stored at generation, not from a client clock) and show it wherever the plan is shown. It never regenerates silently.
- FR-CUS-009 An authorized user may set an `adjusted_qty` (>= 0) on a plan line with a reason (1 to 500 characters), and may add a plan line for an item no standard covers, also with a reason; the server rejects either without a reason. Adjustment never changes the standards.
- FR-CUS-010 Contract lines of the work order that no standard matches shall be listed on the plan as "no standard", so a gap in the standards is visible rather than read as zero need.

**Use by material requests**
- FR-CUS-011 The plan figure for an item on a work order (`mrq_plan_quantity`, #2524) shall be, in order: the consumable plan line's planned qty if the work order has a plan line for that item; else the BoQ allowance figure of 0417 exactly as `mrq_plan_quantity` computes it today (prorated by share, rounded to 3 decimals); else 0. "Has a plan line" means the row exists, even when its planned qty is 0 (an explicit adjustment to 0 is a decision, not a gap). A work order with a consumable plan but no line for an item therefore falls back to allowances for that item. `mrq_plan_quantity` keeps its signature and stays internal.
- FR-CUS-012 The material request form and the submit snapshot (`material_request_lines.plan_qty`) shall carry the figure from FR-CUS-011 and name its **source** (`standard` when the plan line has no adjustment, `adjusted` when it has, `allowance`, `none`). `mrq_plan_for` returns the source with the figure and `mrq_submit` snapshots it in a new nullable `material_request_lines.plan_source` (null on requests submitted before this feature; no label is shown for null). A line over plan still requires a reason, checked by `mrq_submit` on the server (FR-MRQ-002); this feature adds no blocking rule (OD-CUS-3).
- FR-CUS-013 An in-flight or decided request keeps the plan figure it snapshotted; later regeneration or adjustment does not change it.
- FR-CUS-014 The work order's plan screen shall show per item: planned qty, already requested (FR-MRQ-002's prior quantity), remaining, and the source; items requested with no plan show "no plan".

**Access**
- FR-CUS-015 Actions (manage standards, generate plan, adjust plan, view) shall be registered in the role matrix (#902) and gated by `can()`; RLS/RPC enforce. Managing standards follows stock master data (`stock_master_writer()`, 0412: role rank >= 20, i.e. Project Manager, Finance, Executive, Admin; archive, never delete). Generating or adjusting a plan follows the write rule of BoQ allowances (0417 `boq_allowance_ok` -> `may_record_project_progress(project_id)`, 0245): Admin, Executive and Finance on any project of the organisation, and a Project Manager only on a project whose `project_manager_id` is them; Engineer is refused. The functions check it for the work order's project. In `can()` the plan actions reuse the existing `allowanceWriter` predicate (the work order's `project_manager_id` passed as `ctx.record`), so FE and server agree. All roles with an active membership may read.
- FR-CUS-016 Standards, plan lines and their basis carry `org_id` by default (never from the client), with RLS and FORCE RLS on every new table. Plan lines are written only by the security-definer functions; standards by RLS-checked direct writes with column grants (the 0417 pattern).

## Non-functional requirements
- NFR-CUS-001 Generation for a work order of up to 500 lines and 200 standards runs in one set-based statement, no per-line loop from the client.
- NFR-CUS-002 Quantities are exact decimals (`numeric`), rounded once per item per FR-CUS and only for storage at 3 decimals; basis rows keep full precision.
- NFR-CUS-003 Phone-usable plan screen, `DESIGN.md` tokens, keyboard accessible, English and Bahasa Indonesia.
- NFR-CUS-004 Indexes on (org_id, item_id) and (org_id, work_unit) for standards, (work_order_id) for plan lines.

## Acceptance criteria and owning layer

Hand calculation (work order of 2 lines; standard: welding rod, 0.05 kg per `dia-inch`, margin 10%, prefix `WLD`; a second standard for grinding disc, 0.2 pc per `dia-inch`, no margin, no prefix): line `WLD-01` 120 dia-inch, line `WLD-02` 40 dia-inch, line `CIV-01` 10 m3 (no standard). Rod: (120 + 40) x 0.05 x 1.10 = **8.800 kg**. Disc: matches `WLD-01`, `WLD-02` (and not `CIV-01`, unit differs) = 160 x 0.2 = **32.000 pc**. `CIV-01` is listed "no standard". A request of 9.000 kg of rod is 0.200 over plan and needs a reason; 8.000 does not.

| ID | Given / When / Then | Layer |
|---|---|---|
| AC-CUS-001 | Given the hand-worked work order above, when the plan is generated, then rod = 8.800 kg, disc = 32.000 pc, `CIV-01` listed "no standard", and the basis rows sum to the line quantities. | Unit (pure matching/quantity function) + pgTAP (generation function) |
| AC-CUS-002 | Given two lines of 0.3 each at 1.05 kg per unit, when generated, then rounding is once per item (0.630), not per line. | Unit |
| AC-CUS-003 | Given two standards for one item with unit `dia-inch` and prefixes `` and `WLD`, when a `WLD-01` line is planned, then the longer prefix wins; a duplicate (same item, unit, prefix) is refused. | pgTAP |
| AC-CUS-004 | Given a Closed or Cancelled work order, when generation is requested, then refused. | pgTAP |
| AC-CUS-005 | Given an adjusted line (rod 12.000 kg, reason), when the plan is regenerated after a line quantity change, then `generated_qty` updates and the adjustment and reason are kept; an unadjusted row whose standard was archived is removed. | pgTAP |
| AC-CUS-006 | Given a plan, when a work-order line quantity or a matching standard changes, then the plan reads "out of date" until regenerated; before the change it does not. | pgTAP |
| AC-CUS-007 | Given an adjustment or an added line without a reason, when saved, then refused; with a reason it is accepted and the standard is unchanged. | pgTAP |
| AC-CUS-008 | Given a plan line for rod (8.800) and an allowance of 5.000 on the same item, when a request line is submitted, then `plan_qty` = 8.800 and `plan_source` `standard`; with that line adjusted to 12.000, 12.000 and `adjusted`; with an adjustment to 0, 0 and `adjusted` (no fallback); with no plan line for the item, the allowance figure (5.000, prorated as today) and `allowance`; with neither, 0 and `none`. `mrq_plan_for` returns the same figure and source. | pgTAP |
| AC-CUS-009 | Given the plan above, when a request of 9.000 kg is submitted without a reason, then refused (`MRQ_OVER_PLAN_REASON`); with a reason accepted; 8.000 accepted without. Given instead no plan line and an allowance of 5.000 on the item, 5.500 without a reason is refused and 5.000 accepted: the rule is the same on the fallback figure. | pgTAP |
| AC-CUS-010 | Given a submitted request, when the plan is regenerated or adjusted, then the request's snapshotted `plan_qty` is unchanged. | pgTAP |
| AC-CUS-011 | Given an Engineer, when they write a standard, then refused; given an Engineer, or a Project Manager of a different project, when they generate or adjust a plan, then refused; Finance, Executive, Admin and the project's own PM succeed; a same-org active member can read. | pgTAP |
| AC-CUS-012 | Given a user in another organisation, when they read or write standards, plan lines or call generation, then refused. | pgTAP |
| AC-CUS-013 | Given the plan screen inputs, when remaining is computed, then remaining = planned - already requested, floored display only (never hiding a negative as zero). | Unit |
| AC-CUS-014 | Given an archived or other-organisation stock item, when a standard is saved, then refused. | pgTAP |
| AC-CUS-015 | Given a planner on a work order, when they add a standard, generate the plan, adjust one line with a reason, and a site user raises a request for 9.000 kg, then the form shows plan 8.800 source `standard`, the over-plan line asks for a reason, and the request submits. | E2E (one journey) |

## Errors
| Condition | Result |
|---|---|
| Duplicate standard (same item, unit, prefix) | Field error naming the existing standard |
| Item archived or not in the organisation | Field error |
| Generate on a Closed or Cancelled work order | Refused with reason |
| Adjustment or added line without reason | Field error on the line |
| No standard matches any line | Plan generates empty; screen lists every line as "no standard" |
| Plan out of date | Banner with "Regenerate"; requests still use the stored plan |

## Owner decisions (recommended defaults, not rulings)
| ID | Decision and default | If wrong, what breaks |
|---|---|---|
| OD-CUS-1 | A standard is matched by work unit (contract-line unit) with an optional contract-line code prefix; no per-line or per-discipline standard. | If standards must differ by contract line or trade, planners create near-duplicate prefixes or accept the wrong rate and over-request is justified against the wrong figure. |
| OD-CUS-2 | Plan figure precedence: consumable plan line, then BoQ allowance, then 0. | If allowances must win (they are the signed budget), a regenerated standard silently overrides a figure the PM entered by hand. |
| OD-CUS-3 | Over plan **warns and requires a reason** (as FR-MRQ-002), never blocks. An optional per-organisation hard block is out of scope. | If the organisation needs a hard stop, site crews can still over-request with any reason and the approvers are the only brake. |
| OD-CUS-4 | Standards carry a margin % for waste, applied in the plan (default 0). | Without it waste is hidden inside every adjustment; with a wrong value every plan is off by the same factor. |
| OD-CUS-5 | Who manages standards: stock master-data rank (>= 20); who generates/adjusts a plan: the project rule of allowances (Finance rank up, or the project PM). | Too wide lets any engineer inflate a plan; too narrow makes site planners wait on Finance. |
| OD-CUS-6 | Plans are snapshots, regenerated only on request, with an "out of date" flag (no silent regeneration). | Auto-regeneration would change the figure an approver judged a request against. |
| OQ-CUS-1 | Is the work unit a closed list the organisation maintains, or free text matched as written? Default: free text matched case-insensitively and trimmed; unmatched units show on the standards screen. | Typos (`dia inch` vs `dia-inch`) make a standard match nothing; the "no standard" listing (FR-CUS-010) is the only symptom. |
| OQ-CUS-2 | Are standards ever effective-dated (a rate that changed on a date)? Default no: plans are snapshots, history is in record history. | Re-running an old work order's plan after a rate change gives a different answer than it did. |
| OQ-CUS-3 | Do standards apply to the work order's allocated quantity (`work_order_lines.quantity`), or to quantity actually progressed/executed? Default allocated (planned work, per the ticket). The only executed-quantity source is the accepted quantity of the latest Confirmed acceptance (`work_order_acceptance_lines.quantity`, 0337, cumulative per contract line); there is no executed column on the allocation. | Plan is available at order time but ignores scope that changes during execution (see out-of-date flag). |

## Delivery checklist
- [ ] Owner signs OD-CUS-1..6, answers OQ-CUS-1..3.
- [ ] Standards + plan generation slice ships first; the `mrq_plan_quantity` precedence change ships alone (approval path).
- [ ] Glossary: usage standard, consumable plan.
