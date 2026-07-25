# Competitive refresh — PMO vs RIS-portal-2, KANNA (recheck), Cicle (2026-07-22)

> **Status: analysis complete; program GRILLED 2026-07-22** — locked decisions (OD-CR-1…6: quick
> wins → CRM-first order, D1 manual capture v1, FULL id-ID + per-org locale + single-currency-per-org)
> and the live queue are in `docs/backlog.md` → "CANDIDATE PROGRAM (2026-07-22)". Sibling of
> [`2026-06-11-kanna-gap-analysis.md`](2026-06-11-kanna-gap-analysis.md) (whose waves 0–3 shipped;
> this doc re-checks KANNA post-close and adds two new comparators).

**Comparators:**
- **RIS-portal-2** (`ariefsaid/RIS-portal-2`) — our own prior product: a Vue 3/shadcn UI layer on
  ERPNext v15 for a project-based consultancy (id-ID/IDR). Inventoried from source (shallow clone).
- **KANNA** (Aldagram) — construction/field management; Bahasa Indonesia version launched Dec 2025,
  Indonesia its 2nd-fastest-growing market. Web-researched refresh.
- **Cicle** (cicle.app) — Indonesian all-in-one team collaboration (kanban + chat + video + docs +
  check-ins), 100% Bahasa. Web-researched.

## 1. Verdict — where the moat is

A moat is what competitors *can't* copy cheaply. RIS-portal-2 proves a competent team can rebuild
dashboards/approvals/procurement on ERPNext in months — so no single module is the moat. PMO's
defensible position is the **combination**:

1. **The governed vertical thread** — deal → project → procurement → money with RLS + SoD + audit
   enforced at the database layer. Horizontal tools (ClickUp, Cicle) can't follow a deal into
   invoicing; ERP skins (RIS-portal-2) can't go upstream into CRM/pipeline.
2. **The integration-hub posture** (the `dev` adapter program: ClickUp 2-way, ERPNext money
   write-through, M365 token custody, binding maps, kill-switch) — flips "rip and replace" into
   "coordinates what you already use." Hard to replicate (the 9-round-audited money outbox is the
   evidence) and compounds per adapter.
3. **The governed AI agent** — reads the full business surface RLS-scoped, writes only through
   approve/deny SoD. No comparator has the governance substrate to do trusted writes.

Thesis: **"the system of record for contract-based businesses that plugs into what you already
use, with an AI deputy you can trust with writes."** CRM work should serve this thesis (front of
the thread), not chase horizontal CRM.

This matches the spine map (`docs/roadmap-spines.md`): Spine-4 Revenue/AR — already flagged there
as the asymmetry play — is being built by the ERPNext P3 write-through; Spine-5 CRM is the
partial one this program strengthens.

## 2. RIS-portal-2 → PMO gap list (features it has that PMO lacks)

Verified against PMO source (`main` + `origin/dev`), not just the inventory:

| # | Gap | Verified how | Effort |
|---|---|---|---|
| R1 | **Approval limits** — value thresholds routing high-value approvals to Executive; Admin-configurable (`Approval Limit` doctype + exec approval inbox) | No PMO analog; approvals inbox is flat | M |
| R2 | **Mandatory rejection comment** → notification to submitter | `ApprovalsQueue.tsx` + `ProcurementApprovalRow.tsx`: reject is ConfirmDialog-only, no reason capture | S |
| R3 | **Bulk approve/reject for procurement** (PMO timesheets already have bulk approve) | `ProcurementApprovalSection.tsx`: no bulk | S |
| R4 | **Edit-and-approve** — reviewer fixes editable fields before approving, audited | No PMO analog | S–M |
| R5 | **AP aging** (AR aging lands with `dev` P3a read-back; AP is the symmetric read) | dev P3a scope is SI/PE + AR only | M |
| R6 | **Cash-flow forecast** card | No cash domain (also flagged as OD-W5-5 gap) | M |
| R7 | **Budget version comparison** — variance vs original baseline | PMO has BvA vs current budget only | M |
| R8 | **Copy-last-week + recent-projects quick-add** on timesheets | `Timesheets.tsx`: prefill exists, no copy-week | S |
| R9 | **id-ID localization + IDR** | PMO is English-only | M–L, **owner market call** |

Not gaps (parity or better on PMO): unified inbox, quote comparison, project hub/tabs, role
dashboards, kanban, Gantt, global search, KPI drill-through, document handling, RBAC config.

## 3. CRM-v2 candidates (strengthen spine 5 as the front of the thread)

| # | Candidate | Note | Effort |
|---|---|---|---|
| C1 | **M365 email/meeting capture → CRM activities** | Flagship: rides the audited `dev` Graph token custody; deepens both CRM and the hub moat | M–L |
| C2 | **Next-action / follow-up reminders** on deals+contacts → notification inbox + agent automations | Makes stalled-deal signals actionable | M |
| C3 | **Weighted pipeline forecast** (stage-probability × contract value) on Exec dashboard | No probability field today (verified) | S |
| C4 | **Win/loss reasons + analytics** — reason on Lost/Won transition, win-rate by source/client | No loss-reason capture today (verified) | S–M |
| C5 | **Tender/bid tracking** on the pipeline lens (submission deadlines, bid docs, outcomes) | What contract orgs actually do pre-win; no comparator has it | M–L |
| C6 | **Agent CRM assists** — draft follow-ups, account-history summary | After C1/C2; rides the agent action framework | S |

## 4. KANNA + Cicle deltas (context, mostly deprioritized)

- **KANNA** strengths = PMO non-goals for now: site photo/drawing docs, digital field report forms
  with signatures, offline native mobile, project chat. Competes for the field seat, not the back
  office. Post-gap-close, PMO's parity items (Gantt, kanban, calendar, S-curve, import/export,
  CRM) all shipped — the remaining KANNA deltas are field-execution features, deliberately out of
  thesis. New since the June analysis: KANNA ships an "AI MCP" feature and Bahasa Indonesia.
- **Cicle** = communication expectations signal (chat, check-ins, blast announcements, video) —
  integrate/ignore rather than build; its check-in ritual overlaps loosely with timesheets. Also
  Bahasa-first, reinforcing R9 as a market question, not a product one.
- **Deprioritized explicitly:** in-house chat/video (Cicle turf; chat already a "Big track" on the
  kanna program — keep parked), field photos/forms (KANNA turf), offline/native mobile.

## 5. Recommended sequencing

1. **Land the `dev` integrations program on `main` first** (~360 commits of moat backbone;
   unreleased moat is no moat). No new program starts before it ships.
2. **RIS-parity batch** (R1–R8; R9 owner-gated): small, independent, series-friendly issues —
   approvals governance (R1–R4) first (on-thesis governance), then finance depth (R5–R7, riding
   the ERPNext read-backs), then R8.
3. **CRM-v2 batch** (C1–C6): C3/C4 as quick wins any time; C1 immediately after M365 custody is on
   `main`; C2 then C6; C5 as its own spec (touches the pre-win lens model).

Full four-way feature matrix and sources: session comparison 2026-07-22 (Director session);
KANNA: global-en.kanna4u.com, lp.kanna4u.com/en/features, aldagram.com/en/news/08122025;
Cicle: cicle.app, blog.cicle.app (7-fitur, RBAC, PM-tools-Indonesia posts).
