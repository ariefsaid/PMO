# Glossary

Canonical domain language for the PMO Portal. Terms here are binding across specs, code, and
conversation — when everyday usage conflicts with a definition below, the definition wins.
Implementation details do not belong in this file.

---

**Delivery** — the post-win, pre-handover execution of a project. Finite: it ends at
handover/commissioning. One of the nine business spines (see `docs/roadmap-spines.md`).

**Milestone** — a named, ordered chunk of delivery work within a single project (e.g.
"Engineering design", "Procurement", "Site construction"). Carries a percent-complete, a
target date, and a weight. Created free-form per project — there is no org-level milestone
taxonomy. Progress is held in two columns: a *calculated* percent (derived from its tasks'
completion; empty when it has no tasks) and an *input* percent (typed by the PM, optional).
The effective percent is the input value when present, otherwise the calculated one; both
are shown side by side, so any divergence between the PM's figure and task-derived progress
is self-evident. A project's overall delivery progress is the weight-weighted rollup of its
milestones' effective percent.
⚠ Deliberate deviation from strict PM vocabulary: here a milestone is a *work chunk that
progresses*, not a zero-duration checkpoint event.

**Task** — the smallest unit of tracked work. Belongs to a project; may optionally be grouped
under exactly one milestone. The delivery hierarchy is two levels only: milestone → tasks
(decided 2026-06-11; deeper nesting deferred until a real customer needs it).

**Document** — a controlled record in a project's document register (drawing, specification,
report, contract …). Carries a category, a revision mark, and a lifecycle status with
separation-of-duties approval (approver ≠ author). A document may carry **one file**; the
file may change only while the document is Draft — once issued, content changes require a
new revision (decided 2026-06-12).

**Revision** — a successive issue of the same document (Rev A → Rev B …). Each revision is
its own register entry and walks the full lifecycle itself. A revision is always created
*from* its predecessor — that explicit act is what links the lineage (no name/code matching).
Prior revisions are never deleted or hidden: when a newer revision is Approved, the older
one becomes Superseded but stays readable (audit trail).

**Superseded** — terminal document status meaning "replaced by a newer Approved revision of
the same document". Read-only, reached automatically, never hand-picked.

**O&M (Service)** — recurring post-handover service performed under its own contract
(maintenance schedules, breakdown response, installed-asset care). NOT part of Delivery:
delivery is finite, O&M is recurring. The handover of a delivered project is the birth event
of an O&M contract. Spine 9 in the spine model.

**Spine** — one of the nine top-level business-capability domains a project contractor runs on
(Commercial, Cost/AP, Delivery, Revenue/AR, CRM, HSE/Quality, Documents, Resources/Assets,
Service/O&M). Defined in `docs/roadmap-spines.md`.

**Active contract value** — the sum of signed contract values across projects currently in delivery (status = Ongoing). Excludes closed-out and won-but-not-started projects. Smaller than *Revenue on hand* because revenue also accrues on completed work; the two figures are intentionally compared side by side to make the scope difference self-evident.

**Committed spend** (canonical: OD-BUDGET-2) — Σ `total_value` of all procurement records in statuses `Ordered`, `Received`, `Vendor Invoiced`, `Paid` for a given project. This is the single live spend basis used throughout the app: project header "Committed" tile, the Finance dashboard, the Delivery summary, and the at-risk threshold. The stored `projects.spent` column (seeded to 0, never auto-populated) is **not** this value and is not read by any tile. Code reference: `COMMITTED_STATUSES` in `pmo-portal/src/lib/db/procurements.ts`.

**Actual / Realized spend** — a UI label for **Committed spend** (same number, same basis). In the project header stat-strip and the Finance dashboard "BvA" card, the tile labeled "Actual" displays the committed-PO sum (Ordered..Paid), not a separately tracked actual-cost figure. The two words are deliberately synonymous here because the committed-PO basis IS the realized-cost proxy until a time-and-materials actuals system is added. If a future feature introduces a separate "actuals" ledger distinct from PO commitments, rename the UI tile at that point and add a new glossary entry.
