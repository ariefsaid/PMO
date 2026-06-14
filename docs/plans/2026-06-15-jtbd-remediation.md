# JTBD Remediation Program — Implementation Plan

> **Source of truth:** `docs/reviews/2026-06-14-jtbd-census.md` (exact file:line, then-what intent, fix hint per finding).
> **Scope owner directive:** full scope EXCEPT the two backend/schema items (Admin-invite, Incident-investigation-notes append-log) which are being grilled separately and get their own addendum. Everything else here.
> **Date:** 2026-06-15 · **Author:** eng-planner (Director-dispatched)
> **Architecture contract:** ADR-0016 (`can()` = UX, RLS = authority) · ADR-0017 (repository seam; never thread `org_id` or DAL from the client) · ADR-0018 (soft-archive) · ADR-0019 (server-enforced SoD / destructive deletes). Shared form primitives + `DESIGN.md` tokens only (root 16px → 32px controls).

> **Director scope deltas (2026-06-15, owner grill outcome):**
> - **Admin-invite** → ship the **interim "Copy invite instructions" / mailto** affordance NOW (replace the permanently-disabled "New user" button with an honest copy/mailto action — no edge function, no auth/service-role surface, no schema). Added as task **W5-T26**. The real edge-function invite flow is deferred to its own signed feature.
> - **Incident-investigation-notes AND Incident "Reported by" (W5-T24): REMOVED this pass** ("remove incident for now"). No incident-detail changes in this program.
> - **W2-T15opt (Projects rowMenu / ProjectCard kebab): IN-PROGRAM** (not backlogged).
> - **W3 company activity:** aggregate client-side over the company's existing contacts' `crm_activities` (contact-scoped) — **no schema**; migration 0033 / pgTAP 0075 stay reserved-unconsumed. "Log activity" from the company requires/【defaults to a contact.
> - **Status authority:** the **registry `workflowVariant`** is the single source of truth (W4-T16 re-points both `pillVariantForProjectStatus` + `pillVariantForStatus`); full `npm test` is the net for the import-graph-wide shift.

---

## 0. Design brief (one decision at a time)

### 0.1 Architecture & the keystone primitive
The dominant defect class (census §3, violation E) is **an inert linked-record NAME** — the same `project.name` token is a routed `<Link>` on `BvACard`/`MyTasks` but plain text on every procurement/timesheet/approval surface. The fix is **one shared presentational primitive**, not 11 ad-hoc `<Link>`s:

```tsx
// src/components/ui/ProjectNameLink.tsx
import React from 'react';
import { Link } from 'react-router-dom';
import { cn } from './cn';

export interface ProjectNameLinkProps {
  /** Project id; when null/undefined the name renders as inert text + em-dash fallback. */
  projectId: string | null | undefined;
  /** Display name; falls back to em-dash when empty. */
  name: string | null | undefined;
  className?: string;
  /** Override the default accessible label ("Open <name>"). */
  'aria-label'?: string;
}

/**
 * The ONE click-to-open affordance for a linked project name (census violation E).
 * Reuses the BvACard hover/focus signature (BvACard.tsx:46-49) so every procurement,
 * timesheet, and approval surface reads identically. Inert text + em-dash when no id.
 */
export const ProjectNameLink: React.FC<ProjectNameLinkProps> = ({
  projectId,
  name,
  className,
  'aria-label': ariaLabel,
}) => {
  const label = name?.trim() || '—';
  if (!projectId || !name?.trim()) {
    return <span className={cn('text-muted-foreground', className)}>{label}</span>;
  }
  return (
    <Link
      to={`/projects/${projectId}`}
      aria-label={ariaLabel ?? `Open ${label}`}
      className={cn(
        'hover:text-primary focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-ring',
        className,
      )}
    >
      {label}
    </Link>
  );
};
```

This primitive **must land first** (W1-T01) — every Wave-1 consumer imports it, so it is the parallel-safe seam.

### 0.2 Decisions recorded as ADRs
- **ADR-0028 — Linked-record affordance + drawer-vs-detail invariant.** Establishes `ProjectNameLink` as the single click-to-open affordance for a named related record, and codifies the grep-lint guard that fails if a `*Detail.tsx` / list page imports `<Drawer>` (census violation A is VERIFIED-CLEAN; the guard prevents regression). Recorded in W4-T18.
- **ADR-0029 — Single status→variant authority.** Collapse `pillVariantForProjectStatus` (`components/projects.ts`) and `pillVariantForStatus` (`components/salesPipeline.ts`) onto the CW-2 registry (`src/lib/status/statusVariants.ts` `workflowVariant`) so identical statuses can never drift tints (census violation D). Recorded in W4-T16.

### 0.3 Migrations / pgTAP reserved
- **Migration 0033** — RESERVED for Wave-3 IF a company-scoped activity query needs a DB view/RPC. **Decision (W3-T13):** the company activity timeline aggregates the company's contacts' `crm_activities` **client-side** over the existing repository seam (no new SQL) — RLS already scopes `crm_activities` by org, and `contacts.listByCompany` + `contacts.listActivities` already exist. **0033 is therefore NOT consumed by this plan**; it stays reserved for the separate CRM/schema addendum. No pgTAP from 0075 is consumed here. (If the addendum later prefers a `company_activity` view for performance, it claims 0033 + pgTAP 0075 then.)

### 0.4 Data-flow notes that shaped tasks
- `TimesheetGridRow` (`src/components/ui/TimesheetGrid.tsx:17-23`) has **no project id** — only `project: string` + `code`. W1-T08 adds an **optional `projectId?: string`** field; the read-only branch links only when present (editable branch stays plain). `buildGrid` in `ApprovalsQueue.tsx:53-77` already keys rows off `e.project_id`, so populating it is a one-line change (W1-T09).
- `StatusBarChart` (`src/components/dashboard/StatusBarChart.tsx`) is **generic** (used for Procurement-by-Status). W1-T05 adds an **optional `hrefFor?: (status: S) => string`** prop so the legend entries become `<Link>`s only when supplied — no behavior change for callers that omit it.
- `ProjectedMarginBars` card **already** has the `/sales` footer link (`ExecutiveDashboard.tsx:217-218` `linkLabel="Open the sales pipeline"`). Census §2 "Minor" is **already satisfied** — NO task; recorded as a no-op in the traceability table for audit closure.
- The Gantt task-activation fix (W5) **overrides the prior read-only spec decision per explicit owner direction** (census §2 Project-detail row: "Spec marks Gantt read-only (by-design)"). Noted in W5-T22/T23.
- Incident `reported_by` is a bare uuid; `getIncident` does `select('*')` with no profile join (`src/lib/db/incidents.ts:59-67`). W5-T24 extends the read to join the reporter profile (a `getIncidentWithReporter` shape), surfaced via a new `IncidentWithReporter` row type — DAL read only, no schema change.

---

## 1. Wave summary & parallel-safety

| Wave | Theme | Tasks | Shared-first task(s) | Migrations | Cross-wave collision risk |
|---|---|---|---|---|---|
| **1** | Linked-record dead-display sweep | T01–T11 (11) | **T01** `ProjectNameLink` (all W1 consumers import it) | none | `Procurement.tsx`, `ProcurementDetails.tsx`, `DecisionSupportPanel.tsx`, `ProcurementApprovalRow.tsx` touched again in W2/W4 |
| **2** | In-context CRUD on hub/parent records | T12–T14 (3) | — (consumes W1 modals) | none | `ProcurementTab.tsx` / `CompanyDetail.tsx` also touched in W3 |
| **3** | CRM hub buildout | T15–T17 (3) | **T15** `useContactsByCompany` error/Retry (small, isolated) | none (0033 reserved, NOT consumed) | `CompanyDetail.tsx` shared with W2-T13 |
| **4** | Affordance & shared-component consistency | T16b, T18–T21b (7) | **T16** `workflowVariant` re-export (W4-T16) + **T18** `ApprovalRow` disclosure slot | none | `ApprovalsQueue.tsx`/`ProcurementApprovalRow.tsx` shared with W1 |
| **5** | Deeper job fixes (non-schema only) | T22–T25 (4) | **T22** Gantt `onActivate` plumb in `ProjectGantt.tsx` before T23 TasksTab wiring | none (DAL read join only) | `ProjectGantt.tsx` ↔ `TasksTab.tsx` (T22 before T23) |

**Parallel-safe worktree guidance.**
1. **Land W1-T01 (`ProjectNameLink`) on `main` first** as its own micro-PR, OR if waves run concurrently, assign W1 to a worktree that merges before W2/W4 start their procurement-file edits. Every dependent imports the primitive.
2. **Shared files across waves:** `ProcurementDetails.tsx`, `ProcurementApprovalRow.tsx`, `DecisionSupportPanel.tsx`, `CompanyDetail.tsx`, `ApprovalsQueue.tsx`. Sequence: **W1 → W2 → W4** for those files; W3's `CompanyDetail` edits (T16-T17) must rebase on W2-T13. Run W3-T15 (`useContacts` hook) and W5 (Gantt/Incident/MyTasks) **fully in parallel** — disjoint files.
3. **W4-T16 (`projects.ts`/`salesPipeline.ts` re-export)** is import-graph-wide; land it early in the W4 worktree and rebuild before T16b consumers.

---

## 2. Traceability (AC-id → owning layer → test file)

Per ADR-0010 every AC is owned by exactly ONE test at the lowest sufficient layer. All here are component/render/logic → **Vitest/RTL (unit)**. No new pgTAP, no new e2e (no cross-stack journey changes; existing e2e for `/approvals` inline-approve and procurement remain valid).

| AC | Wave/Task | Owning layer | Test file |
|---|---|---|---|
| AC-JR-W1-01 ProjectNameLink links when id present, em-dash + inert when null | W1-T01 | unit | `src/components/ui/__tests__/ProjectNameLink.test.tsx` |
| AC-JR-W1-02 Procurement list project cell links to /projects/:id | W1-T02 | unit | `pages/__tests__/Procurement.projectlink.test.tsx` |
| AC-JR-W1-03 Procurement list-row meta project name links | W1-T03 | unit | `pages/procurement/__tests__/ProcurementListRow.test.tsx` |
| AC-JR-W1-04 Procurement board card project name links | W1-T04 | unit | `components/__tests__/ProcurementBoard.test.tsx` |
| AC-JR-W1-05 Procurement detail (RecordHeader meta + StatTile sub + moneyContext) project name links | W1-T06 | unit | `pages/__tests__/ProcurementDetails.projectlink.test.tsx` |
| AC-JR-W1-06 DecisionSupportPanel heading project name links | W1-T07 | unit | `pages/procurement/__tests__/DecisionSupportPanel.test.tsx` |
| AC-JR-W1-07 Procurement approval row project name links | W1-T10 | unit | `pages/approvals/__tests__/ProcurementApprovalRow.projectlink.test.tsx` |
| AC-JR-W1-08 TimesheetGrid read-only project name links (desktop + mobile); editable stays plain | W1-T08 | unit | `src/components/ui/__tests__/TimesheetGrid.projectlink.test.tsx` |
| AC-JR-W1-09 ApprovalsQueue expanded grid rows carry projectId → link | W1-T09 | unit | `pages/timesheets/__tests__/ApprovalsQueue.projectlink.test.tsx` |
| AC-JR-W1-10 Dashboard Procurement-by-Status legend entries link to /procurement?status= | W1-T05 | unit | `src/components/dashboard/__tests__/StatusBarChart.link.test.tsx` |
| AC-JR-W1-11 Procurement approval "Open request" → /procurement/:id in expanded panel | W1-T11 | unit | `pages/approvals/__tests__/ProcurementApprovalRow.openrequest.test.tsx` |
| AC-JR-W1-12 ContactDetail email→mailto:, phone→tel:, em-dash fallback | W1-T12a | unit | `pages/__tests__/ContactDetail.contactlinks.test.tsx` |
| AC-JR-W1-13 ContactDetail Company field → /companies/:id link | W1-T12b | unit | `pages/__tests__/ContactDetail.companylink.test.tsx` |
| AC-JR-W1-14 ContactDetail activity rows link to related object (project/company) | W1-T12c | unit | `pages/__tests__/ContactDetail.activitylink.test.tsx` |
| AC-JR-W1-15 ProjectedMarginBars card has "Open the sales pipeline" footer | (no-op) | unit (already passing) | existing `ExecutiveDashboard` render — **already satisfied** |
| AC-JR-W2-01 ProcurementTab gated "New request" (header + empty-state) opens modal with projectId pre-seeded | W2-T13a | unit | `pages/project-detail/tabs/__tests__/ProcurementTab.newrequest.test.tsx` |
| AC-JR-W2-02 NewProcurementModal honors a `defaultProjectId` prefill | W2-T13b | unit | `pages/procurement/__tests__/NewProcurementModal.prefill.test.tsx` |
| AC-JR-W2-03 CompanyDetail gated "Add contact" in Contacts CardHead opens create modal with company_id defaulted | W2-T14 | unit | `pages/__tests__/CompanyDetail.addcontact.test.tsx` |
| AC-JR-W2-04 Projects list rowMenu (Edit + Archive) + ProjectCard kebab | W2-T15opt | unit | `pages/__tests__/Projects.rowmenu.test.tsx` |
| AC-JR-W3-01 CompanyContactsList renders error + Retry on isError | W3-T16a | unit | `pages/__tests__/CompanyDetail.contactserror.test.tsx` |
| AC-JR-W3-02 useContactsByCompany exposes isError/refetch (hook contract) | W3-T15 | unit | `src/hooks/__tests__/useContacts.byCompany.test.tsx` |
| AC-JR-W3-03 CompanyDetail account-level activity timeline aggregates contacts' activity + "Log activity" | W3-T17 | unit | `pages/__tests__/CompanyDetail.activity.test.tsx` |
| AC-JR-W3-04 CompanyDetail surfaces primary-contact + related-opportunities | W3-T18 | unit | `pages/__tests__/CompanyDetail.accountcard.test.tsx` |
| AC-JR-W4-01 ApprovalRow renders a leading `disclosure` slot (one border style) | W4-T19 | unit | `src/components/ui/__tests__/ApprovalRow.disclosure.test.tsx` |
| AC-JR-W4-02 Timesheet approval row routes its chevron through the disclosure slot (leading) | W4-T20 | unit | `pages/timesheets/__tests__/ApprovalsQueue.disclosure.test.tsx` |
| AC-JR-W4-03 SalesPipeline Funnel scopes table/board by selected stage (onSelect/selectedIndex) | W4-T21 | unit | `pages/__tests__/SalesPipeline.funnel.test.tsx` |
| AC-JR-W4-04 status→variant single authority: projects.ts + salesPipeline.ts re-export workflowVariant; guard asserts agreement on every enum value | W4-T16 | unit | `components/__tests__/statusVariant.authority.test.ts` |
| AC-JR-W4-05 user-facing "Opportunity" renamed to "Project" (SalesPipeline col header + ExecutiveDashboard help) | W4-T17 | unit | `pages/__tests__/SalesPipeline.noun.test.tsx` |
| AC-JR-W4-06 drawer-vs-detail grep guard fails if a *Detail/list page imports `<Drawer>` | W4-T18 | unit (node script test) | `src/lib/__tests__/drawerGuard.test.ts` |
| AC-JR-W5-01 GanttBarRow activates a task (onActivate) routing through setFormTarget | W5-T22/T23 | unit | `pages/project-detail/__tests__/ProjectGantt.activate.test.tsx` |
| AC-JR-W5-02 IncidentDetail renders a "Reported by" field with the reporter name | W5-T24 | unit | `pages/__tests__/IncidentDetail.reportedby.test.tsx` |
| AC-JR-W5-03 MyTasks task name targets the precise task (#task-<id> anchor) + TasksTab scroll/highlight | W5-T25 | unit | `pages/__tests__/MyTasks.tasktarget.test.tsx` |

---

## WAVE 1 — Linked-record-name dead-display sweep

### W1-T01 — Create the `ProjectNameLink` primitive (SHARED-FIRST) — AC-JR-W1-01
**Red.** Write `pmo-portal/src/components/ui/__tests__/ProjectNameLink.test.tsx` (wrap renders in `<MemoryRouter>`):
- `it('AC-JR-W1-01: links to /projects/:id when id present')` → render `<ProjectNameLink projectId="p1" name="Bridge"/>`; assert `screen.getByRole('link', { name: 'Open Bridge' })` has `href="/projects/p1"`.
- `it('AC-JR-W1-01: renders inert em-dash text when id is null')` → `<ProjectNameLink projectId={null} name="Bridge"/>`; assert `queryByRole('link')` is null and text `Bridge` present.
- `it('AC-JR-W1-01: renders em-dash when name empty')` → `<ProjectNameLink projectId="p1" name={null}/>`; assert text `—`.
Run `npm test -- ProjectNameLink` → fails (module missing).
**Green.** Create `pmo-portal/src/components/ui/ProjectNameLink.tsx` with the code in §0.1. Export it from `src/components/ui/index.ts` (add `export { ProjectNameLink } from './ProjectNameLink'; export type { ProjectNameLinkProps } from './ProjectNameLink';` next to the other exports).
**Verify.** `cd pmo-portal && npm test -- ProjectNameLink && npm run typecheck`

### W1-T02 — Procurement list table: project cell → ProjectNameLink — AC-JR-W1-02
**Red.** `pages/__tests__/Procurement.projectlink.test.tsx`: render the `project` column cell for a row with `project: { name:'Bridge' }, project_id:'p1'`; assert a link to `/projects/p1`. Fails (current `<span>` at `Procurement.tsx:172`).
**Green.** In `pmo-portal/pages/Procurement.tsx:170-174`, replace the cell with:
```tsx
cell: (r) => <ProjectNameLink projectId={r.project_id} name={r.project?.name} className="text-muted-foreground" />,
```
Add `ProjectNameLink` to the `@/src/components/ui` import.
**Verify.** `cd pmo-portal && npm test -- Procurement.projectlink && npm run typecheck`

### W1-T03 — Procurement list-row meta: project name → ProjectNameLink — AC-JR-W1-03
**Red.** `pages/procurement/__tests__/ProcurementListRow.test.tsx`: render a row; assert the project name is a link to `/projects/:project_id`. Fails (`ProcurementListRow.tsx:162` `<span>{row.project.name}</span>`).
**Green.** In `pmo-portal/pages/procurement/ProcurementListRow.tsx:162`, replace `{row.project?.name && <span>{row.project.name}</span>}` with:
```tsx
{row.project?.name && <ProjectNameLink projectId={row.project_id} name={row.project.name} />}
```
Add the import.
**Verify.** `cd pmo-portal && npm test -- ProcurementListRow && npm run typecheck`

### W1-T04 — Procurement board card: project name → ProjectNameLink — AC-JR-W1-04
**Red.** `components/__tests__/ProcurementBoard.test.tsx`: render `PrCard`; assert project name links to `/projects/:project_id`. Fails (`ProcurementBoard.tsx:46-48` plain `<span>`).
**Green.** In `pmo-portal/components/ProcurementBoard.tsx:46-48`, replace the `<span>` wrapping `pr.project?.name` with:
```tsx
<ProjectNameLink projectId={pr.project_id} name={pr.project?.name}
  className="truncate text-[11px] text-muted-foreground" />
```
Add the import. (Card-level `onActivate` still fires on the card; the inner link stops propagation by being a real anchor — keep the card's keyboard activation; the link is an additional affordance, acceptable per BvACard precedent.)
**Verify.** `cd pmo-portal && npm test -- ProcurementBoard && npm run typecheck`

### W1-T05 — Dashboard Procurement-by-Status legend → /procurement?status= links — AC-JR-W1-10
**Red.** `src/components/dashboard/__tests__/StatusBarChart.link.test.tsx`: render `<StatusBarChart data=[{status:'Requested',count:7}] toneFor={() => '#000'} hrefFor={(s) => \`/procurement?status=${s}\`} ... />` in `<MemoryRouter>`; assert a link `Requested 7` (accessible) to `/procurement?status=Requested`. Also assert when `hrefFor` omitted the legend is plain text (no link) — regression guard for other callers. Fails (legend is `<span>` only).
**Green.**
1. `src/components/dashboard/StatusBarChart.tsx`: add `hrefFor?: (status: S) => string;` to props; import `Link` from `react-router-dom`. In the `figcaption` map (lines 90-101), when `hrefFor` is provided wrap the entry in `<Link to={hrefFor(d.status)} className="hover:text-primary focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-ring">…</Link>`, else keep the current `<span>`.
2. `pages/ExecutiveDashboard.tsx:134-135`: pass `hrefFor={(s) => \`/procurement?status=${encodeURIComponent(s)}\`}` to the `<StatusBarChart>`. (Drill target already exists: `Procurement.tsx:113` reads the `status` query param.)
**Verify.** `cd pmo-portal && npm test -- StatusBarChart.link && npm run typecheck`

### W1-T06 — Procurement detail: project name → ProjectNameLink (RecordHeader meta + StatTile + moneyContext) — AC-JR-W1-05
**Red.** `pages/__tests__/ProcurementDetails.projectlink.test.tsx`: render with a PR whose `project_id:'p1', project:{name:'Bridge'}`; assert the RecordHeader meta project name is a link to `/projects/p1`. Fails (`ProcurementDetails.tsx:550` plain span; also 524/539/386).
**Green.** In `pmo-portal/pages/ProcurementDetails.tsx`:
- `meta` array line 550: replace `<span key="proj"> · {p.project.name}</span>` with `<span key="proj"> · <ProjectNameLink projectId={p.project_id} name={p.project.name} /></span>`.
- StatTile `sub` at 524 (`sub: p.project?.name ?? undefined`): leave the StatTile string sub as-is (StatTile sub is a plain string contract — linking it would break the type). Census names RecordHeader meta as the **priority slot** — satisfied by the line-550 change. Document this in the test as the chosen slot.
- `moneyContext` line 386 (`<i>{p.project.name}</i>`): replace with `<ProjectNameLink projectId={p.project_id} name={p.project.name} />` (it's already JSX inside the confirm copy).
Add the import. Vendor stays plain (no vendor route — census).
**Verify.** `cd pmo-portal && npm test -- ProcurementDetails.projectlink && npm run typecheck`

### W1-T07 — DecisionSupportPanel heading project name → ProjectNameLink — AC-JR-W1-06
**Red.** `pages/procurement/__tests__/DecisionSupportPanel.test.tsx`: render expanded with `projectId='p1' projectName='Bridge'`; assert heading project name links to `/projects/p1`. Fails (`DecisionSupportPanel.tsx:56` `<span>· {projectName}</span>`).
**Green.** In `pmo-portal/pages/procurement/DecisionSupportPanel.tsx:55-57`, replace the `projectName` span with:
```tsx
{projectName ? (
  <ProjectNameLink projectId={projectId} name={projectName}
    className="text-[12.5px] font-medium text-foreground" />
) : null}
```
Add the import. (`projectId` is already in scope.)
**Verify.** `cd pmo-portal && npm test -- DecisionSupportPanel && npm run typecheck`

### W1-T08 — TimesheetGrid read-only project name → link (desktop + mobile) — AC-JR-W1-08
**Red.** `src/components/ui/__tests__/TimesheetGrid.projectlink.test.tsx`:
- read-only desktop: render `<TimesheetGrid days rows={[{id:'p1',project:'Bridge',code:null,hours:[…],projectId:'p1'}]} />` (force desktop via the `useIsDesktop` mock used elsewhere); assert project name is a link to `/projects/p1`.
- editable: render with `editable` and assert NO link (plain text).
Fails (`TimesheetGrid.tsx:225` + `:396` plain divs; row type has no `projectId`).
**Green.** In `pmo-portal/src/components/ui/TimesheetGrid.tsx`:
1. Add to `TimesheetGridRow` (line 17-23): `/** Owning project id — present only in read-only contexts; enables click-to-open. */ projectId?: string;`
2. Desktop read-only branch (line 224-227): replace `<div className="truncate text-sm font-medium" title={r.project}>{r.project}</div>` with `<ProjectNameLink projectId={r.projectId} name={r.project} className="truncate text-sm font-medium" />`.
3. Mobile read-only branch (line 396-398): same swap.
Editable branch (line 224 `<div className="min-w-0">…inputs`) stays plain — unchanged. Import `ProjectNameLink` from `./ProjectNameLink`.
**Verify.** `cd pmo-portal && npm test -- TimesheetGrid.projectlink && npm run typecheck`

### W1-T09 — ApprovalsQueue: populate projectId in buildGrid rows — AC-JR-W1-09
**Red.** `pages/timesheets/__tests__/ApprovalsQueue.projectlink.test.tsx`: expand a sheet; assert the read-only grid renders a project-name link to `/projects/:project_id`. Fails (buildGrid rows omit `projectId`).
**Green.** In `pmo-portal/pages/timesheets/ApprovalsQueue.tsx` `buildGrid` (lines 72-77), when creating each `TimesheetGridRow` add `projectId: e.project_id` to the map value (the `project_id` is the map key, already in hand). No other change — W1-T08 already renders the link.
**Verify.** `cd pmo-portal && npm test -- ApprovalsQueue.projectlink && npm run typecheck`

### W1-T10 — Procurement approval row: project name → ProjectNameLink — AC-JR-W1-07
**Red.** `pages/approvals/__tests__/ProcurementApprovalRow.projectlink.test.tsx`: render the row; assert project name links to `/projects/:project_id`. Fails (`ProcurementApprovalRow.tsx:132` plain span).
**Green.** In `pmo-portal/pages/approvals/ProcurementApprovalRow.tsx:132`, replace `{row.project?.name && <span>{row.project.name}</span>}` with `{row.project?.name && <ProjectNameLink projectId={row.project_id} name={row.project.name} />}`. Add the import.
**Verify.** `cd pmo-portal && npm test -- ProcurementApprovalRow.projectlink && npm run typecheck`

### W1-T11 — Procurement approval expanded panel: "Open request" → /procurement/:id — AC-JR-W1-11
**Red.** `pages/approvals/__tests__/ProcurementApprovalRow.openrequest.test.tsx`: expand the row; assert an "Open request" link/button navigates to `/procurement/:id`. Fails (no such control).
**Green.** In `pmo-portal/pages/approvals/ProcurementApprovalRow.tsx` expanded panel (after line 142, inside the `{expanded && …}` block, near the line-items region), add at the foot of the panel:
```tsx
<Link
  to={`/procurement/${row.id}`}
  className="inline-flex items-center gap-1 text-[12px] font-medium text-primary hover:underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
>
  Open request
  <Icon name="chev" className="size-3.5" />
</Link>
```
Import `Link` from `react-router-dom`. Keep the inline Approve/Reject fast path untouched.
**Verify.** `cd pmo-portal && npm test -- ProcurementApprovalRow.openrequest && npm run typecheck`

### W1-T12a — ContactDetail email→mailto:, phone→tel: — AC-JR-W1-12
**Red.** `pages/__tests__/ContactDetail.contactlinks.test.tsx`: render a contact with `email:'a@b.co', phone:'+1 555'`; assert `getByRole('link', { name: /a@b.co/ })` has `href="mailto:a@b.co"` and phone → `tel:+15551` (digits/+ only). Assert em-dash plain text when null. Fails (`ContactDetail.tsx:189-190` bare strings).
**Green.** In `pmo-portal/pages/ContactDetail.tsx:189-190`, replace the two `<Field>`s with link-valued fields:
```tsx
<Field label="Email" value={contact.email
  ? <a href={`mailto:${contact.email}`} className="text-primary hover:underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring">{contact.email}</a>
  : '—'} />
<Field label="Phone" value={contact.phone
  ? <a href={`tel:${contact.phone.replace(/[^+\d]/g, '')}`} className="text-primary hover:underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring">{contact.phone}</a>
  : '—'} />
```
**Verify.** `cd pmo-portal && npm test -- ContactDetail.contactlinks && npm run typecheck`

### W1-T12b — ContactDetail Company field → /companies/:id link — AC-JR-W1-13
**Red.** `pages/__tests__/ContactDetail.companylink.test.tsx`: render; assert the Company field value is a link to `/companies/:company_id`. Fails (`ContactDetail.tsx:187` plain `companyName`).
**Green.** In `pmo-portal/pages/ContactDetail.tsx:187`, replace `<Field label="Company" value={companyName} />` with:
```tsx
<Field label="Company" value={
  contact.company_id
    ? <Link to={`/companies/${contact.company_id}`} className="text-primary hover:underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring">{companyName}</Link>
    : companyName
} />
```
Add `Link` to the `react-router-dom` import (currently only `useParams, useNavigate`).
**Verify.** `cd pmo-portal && npm test -- ContactDetail.companylink && npm run typecheck`

### W1-T12c — ContactDetail activity rows → related-object links — AC-JR-W1-14
**Red.** `pages/__tests__/ContactDetail.activitylink.test.tsx`: render a timeline with one activity carrying `project_id:'p1'` and one carrying `company_id:'c1'`; assert each row links to `/projects/p1` and `/companies/c1` respectively; an activity with neither stays non-link. Fails (`ContactDetail.tsx:343-352` static `<li>`).
**Green.** In `pmo-portal/pages/ContactDetail.tsx` `ContactActivityPanel` timeline (343-352), wrap each `<li>` content: when `a.project_id` link the row to `/projects/${a.project_id}`, else when `a.company_id` link to `/companies/${a.company_id}`, else render the current static block. Extract a tiny `hrefForActivity(a)` helper returning `string | null`; render `<Link to={href} …>` only when non-null, preserving the existing inner markup. Add `Link` import (shared with T12b).
**Verify.** `cd pmo-portal && npm test -- ContactDetail.activitylink && npm run typecheck`

> **AC-JR-W1-15 (ProjectedMarginBars "Open the sales pipeline" footer)** — NO TASK. Already present at `ExecutiveDashboard.tsx:217-218` (`linkLabel="Open the sales pipeline"` → `/sales`). Recorded for audit closure.

---

## WAVE 2 — In-context CRUD on hub/parent records

### W2-T13a — ProcurementTab gated "New request" (header + empty-state) — AC-JR-W2-01
**Red.** `pages/project-detail/tabs/__tests__/ProcurementTab.newrequest.test.tsx`: with `can('create','procurement')` true, assert a "New request" button in the tab header; clicking it mounts `NewProcurementModal`; assert the empty-state also exposes the action. With the permission false, assert no button. Fails (no CTA today).
**Green.** In `pmo-portal/pages/project-detail/tabs/ProcurementTab.tsx`:
1. Import `Button`, `Icon`, `usePermission`, `useCreateProcurement`, `classifyMutationError`, `useToast`, and `NewProcurementModal`.
2. `const canCreate = usePermission()('create','procurement'); const [showNew, setShowNew] = useState(false); const create = useCreateProcurement(); const { toast } = useToast();`
3. Add a header above the table (mirrors TasksTab.tsx:205-218): an `<h2>Procurement</h2>` + when `canCreate`, `<Button variant="primary" size="sm" onClick={() => setShowNew(true)}><Icon name="plus"/>New request</Button>`.
4. Pass `emptyAction` (or wrap the empty state) so the empty `DataTable` offers the same New-request action when `canCreate`.
5. Mount the modal (copy the wiring from `Procurement.tsx:360-370`), passing the prefill from T13b: `<NewProcurementModal defaultProjectId={projectId} onClose={…} onCreate={(input) => create.mutateAsync(input)} onCreated={(id) => { setShowNew(false); navigate(\`/procurement/${id}\`); }} onError={(err) => { const {headline,detail}=classifyMutationError(err); toast(headline,detail,'warning'); }} />`.
**Verify.** `cd pmo-portal && npm test -- ProcurementTab.newrequest && npm run typecheck`

### W2-T13b — NewProcurementModal honors a `defaultProjectId` prefill — AC-JR-W2-02
**Red.** `pages/procurement/__tests__/NewProcurementModal.prefill.test.tsx`: render `<NewProcurementModal defaultProjectId="p1" …/>`; assert the project Combobox initial value is `p1` (seeded) and the field is still editable. Fails (no prop; `initialValues.projectId` is `null`).
**Green.** In `pmo-portal/pages/procurement/NewProcurementModal.tsx`:
- Add `defaultProjectId?: string | null;` to `NewProcurementModalProps`.
- Seed it: `initialValues: { title: '', projectId: defaultProjectId ?? null, vendorId: null }`.
- Ensure the project Combobox `selectedOption` resolves from `projectOptions` when the value matches (so the seeded id shows its label once options load) — mirror the existing selectedAssignee pattern.
**Verify.** `cd pmo-portal && npm test -- NewProcurementModal.prefill && npm run typecheck`

### W2-T14 — CompanyDetail gated "Add contact" with company_id defaulted — AC-JR-W2-03
**Red.** `pages/__tests__/CompanyDetail.addcontact.test.tsx`: with `can('create','contact')` true, assert an "Add contact" button in the Contacts `CardHead`; clicking opens a contact create modal whose Company field is pre-set to this company (and disabled or pre-selected); submitting calls the contact create mutation with `company_id` = this company. With the permission false, no button. Fails (no CTA).
**Green.** In `pmo-portal/pages/CompanyDetail.tsx`:
1. Import `useContactMutations` (`src/hooks/useContacts`), `usePermission`, and a reusable contact create form. **Reuse the existing `ContactEditModal` shape from `ContactDetail.tsx`** by extracting it into a shared module is out of scope; instead add a local `AddContactModal` in `CompanyDetail.tsx` built from the same shared form primitives, with `company_id` pre-seeded and the Company `SelectField` pre-selected to `company.id` (kept editable — the contacts_write RLS still gates the row).
2. Replace the `<CardHead>Contacts</CardHead>` (line 201) with a CardHead that carries a trailing gated action: `{may('create','contact') && <Button variant="ghost" size="sm" onClick={() => setAddContactOpen(true)}><Icon name="plus"/>Add contact</Button>}`. (Use the CardHead's action affordance pattern; if CardHead has no slot, wrap heading + button in a `flex items-center justify-between`.)
3. On success: `await create.mutateAsync(input); toast('Contact added', input.full_name,'success'); setAddContactOpen(false);` — the `['contacts',…]` invalidation in `useContactMutations` already refetches `useContactsByCompany`.
**Verify.** `cd pmo-portal && npm test -- CompanyDetail.addcontact && npm run typecheck`

### W2-T15opt — (Optional) Projects list rowMenu + ProjectCard kebab — AC-JR-W2-04
**Red.** `pages/__tests__/Projects.rowmenu.test.tsx`: with edit/archive perms, assert the projects table exposes a row menu with "Edit" (opens edit header/modal) and "Archive"; ProjectCard exposes a kebab with the same. Fails (no rowMenu; `Projects.tsx:509-532`).
**Green.** In `pmo-portal/pages/Projects.tsx`: add a `rowMenu(p)` mirroring `Companies.tsx:141-147` (Edit → open the project edit modal / `editHeader` route; Archive → archive confirm via `useProjectMutations().archive`). Pass `rowMenu={canRowWrite ? rowMenu : undefined}` to the table `DataTable`. Add the matching kebab to `components/ProjectCard.tsx` (pass the same items). **Marked optional/low-priority (census "Minor") — implement only if the wave has budget; otherwise defer to backlog with AC-JR-W2-04 unclaimed.**
**Verify.** `cd pmo-portal && npm test -- Projects.rowmenu && npm run typecheck`

---

## WAVE 3 — CRM hub buildout

### W3-T15 — `useContactsByCompany` error/refetch contract (SHARED-FIRST for W3) — AC-JR-W3-02
**Red.** `src/hooks/__tests__/useContacts.byCompany.test.tsx`: assert `useContactsByCompany` returns `{ data, isPending, isError, refetch }` and that on a failing `repositories.contact.listByCompany` `isError` becomes true. Fails only if the hook doesn't surface them — **verify first**: the hook (useContacts.ts:38-46) returns the full `useQuery` result, so `isError`/`refetch` ARE already present. If the test passes immediately, this task is a **contract-lock test only** (no code change) — keep it (regression guard) and proceed.
**Green.** No code change expected; the deliverable is the locked contract test.
**Verify.** `cd pmo-portal && npm test -- useContacts.byCompany`

### W3-T16a — CompanyContactsList error + Retry state — AC-JR-W3-01
**Red.** `pages/__tests__/CompanyDetail.contactserror.test.tsx`: mock `useContactsByCompany` to return `{ isError:true, isPending:false, refetch }`; assert a `ListState variant="error"` with a Retry that calls `refetch` — NOT "No contacts yet". Fails (`CompanyDetail.tsx:375-391` has only isPending + data; isError falls through to the false-empty).
**Green.** In `pmo-portal/pages/CompanyDetail.tsx` `CompanyContactsList` (375-391): destructure `const { data, isPending, isError, refetch } = useContactsByCompany(companyId);` and add, before the empty check:
```tsx
if (isError) {
  return (
    <ListState variant="error" title="Couldn't load contacts"
      sub="The request failed. Try again." onRetry={() => refetch()} />
  );
}
```
**Verify.** `cd pmo-portal && npm test -- CompanyDetail.contactserror && npm run typecheck`

### W3-T17 — CompanyDetail account-level activity timeline + "Log activity" — AC-JR-W3-03
**Red.** `pages/__tests__/CompanyDetail.activity.test.tsx`: render a company whose two contacts have CRM activities; assert an "Activity" card shows the aggregated timeline (newest-first, each row naming the source contact), and a gated "Log activity" form (visible when `can('create','contactActivity')`). Logging requires choosing a contact (company-scoped activity attaches to a contact under the hood). Fails (no account activity today).
**Green (no schema — client aggregation over the existing repository seam):**
1. Add a hook `useCompanyActivity(companyId)` in `pmo-portal/src/hooks/useContacts.ts`: it depends on `useContactsByCompany(companyId)`, then for the resolved contact ids issues `repositories.contact.listActivities(contactId)` per contact via `useQueries`, merges + sorts by `occurred_at` desc, and annotates each row with its contact's `full_name`. queryKey `['company-activity', orgId, companyId]`. RLS already scopes `crm_activities` by org (ADR-0017) — no DB change.
2. Add a `CompanyActivityPanel` to `CompanyDetail.tsx` (sibling of the Contacts card) reusing the `ContactActivityPanel` log-form pattern from `ContactDetail.tsx:252-356`, but the log form requires a contact `SelectField` (options = the company's contacts) since `crm_activities.contact_id` is required (`crmActivities.ts:10-18`). On submit call `useContactMutations().logActivity` with `{ contact_id, company_id: companyId, … }`.
3. Render `<Card><CardHead>Activity</CardHead><CardPad><CompanyActivityPanel companyId={company.id}/></CardPad></Card>` above or below the Contacts card.
**Verify.** `cd pmo-portal && npm test -- CompanyDetail.activity && npm run typecheck`

> **NOTE on migration 0033:** the aggregation is client-side (above), so **0033 is NOT consumed here**. If the separate CRM addendum later wants a `company_activity` view/RPC for performance at scale, it claims migration 0033 + pgTAP 0075 then (reversible migration + RLS + `org_id` seam per charter). This plan reserves the numbers and does not use them.

### W3-T18 — CompanyDetail account card: primary contact + related opportunities — AC-JR-W3-04
**Red.** `pages/__tests__/CompanyDetail.accountcard.test.tsx`: render a Client company with contacts + related projects; assert the "Company detail" card surfaces a **primary contact** link (first contact, or a flagged one) → `/contacts/:id`, and that "Related projects" already lists opportunities (the `RelatedProjects` already exists). Assert the primary-contact link present; if no contacts, a calm "No primary contact". Fails (the definition list shows only Name/Type — `CompanyDetail.tsx:182-190`).
**Green.** In `pmo-portal/pages/CompanyDetail.tsx`, extend the "Company detail" `dl` (182-190) with a "Primary contact" `<Field>` whose value is a `<Link to={\`/contacts/${first.id}\`}>` derived from `useContactsByCompany(company.id)` (first by name), or `—`. "Related opportunities" is already satisfied by the existing `RelatedProjects` card (line 193) — assert it in the test; no duplication.
**Verify.** `cd pmo-portal && npm test -- CompanyDetail.accountcard && npm run typecheck`

---

## WAVE 4 — Affordance & shared-component consistency

### W4-T16 — Single status→variant authority + guard (SHARED-FIRST for W4) — AC-JR-W4-04 · ADR-0029
**Red.** `components/__tests__/statusVariant.authority.test.ts`: import `pillVariantForProjectStatus` (`components/projects.ts`), `pillVariantForStatus` (`components/salesPipeline.ts`), and `workflowVariant` (`src/lib/status/statusVariants.ts`). For every project status enum value (Leads, PQ Submitted, Quotation Submitted, Tender Submitted, Negotiation, Ongoing Project, Won/Pending KoM, Close Out, On Hold, Loss Tender, Internal Project), assert `pillVariantForProjectStatus(s) === pillVariantForStatus(s) === workflowVariant(s)`. Fails today (projects.ts maps `On Hold→overdue`/Leads→`draft`; salesPipeline maps pre-win→`progress`; registry maps `On Hold→warn`).
**Green.** Re-point both helpers at the CW-2 registry so there is ONE authority:
- `components/projects.ts`: replace the local `VARIANT_BY_STATUS` + body with `export { workflowVariant as pillVariantForProjectStatus } from '@/src/lib/status/statusVariants';` (keep `projectIconColor` as-is). Verify the registry covers every projects.status enum value; if `Internal Project`/`Ongoing Project` aren't mapped, they already are (registry lines 73-76).
- `components/salesPipeline.ts`: replace `pillVariantForStatus`'s body to delegate: `return workflowVariant(status);` (import `workflowVariant`). `dealJourneySteps`/`openOpportunity` unchanged.
- The registry is the single map; the guard test now passes by construction.
**Verify.** `cd pmo-portal && npm test -- statusVariant.authority && npm run typecheck && npm test` (full suite — this is import-graph-wide; rebuild all consumers).

### W4-T17 — Rename user-facing "Opportunity" → "Project" — AC-JR-W4-05
**Red.** `pages/__tests__/SalesPipeline.noun.test.tsx`: render SalesPipeline table; assert the column header reads "Project" (not "Opportunity"). Add an assertion in an ExecutiveDashboard render test that the margin-tile help text no longer says "opportunity value". Fails (`SalesPipeline.tsx:140` "Opportunity"; `ExecutiveDashboard.tsx:219` help text).
**Green.**
- `SalesPipeline.tsx:140`: `header: 'Opportunity'` → `header: 'Project'` (keep the `key:'opp'` id stable to avoid e2e breakage).
- `ExecutiveDashboard.tsx:219`: `help="Sum of (opportunity value × stage win-probability)…"` → `help="Sum of (project value × stage win-probability)…"`.
**Verify.** `cd pmo-portal && npm test -- SalesPipeline.noun && npm run typecheck`

### W4-T18 — Drawer-vs-detail grep guard — AC-JR-W4-06 · ADR-0028
**Red.** `src/lib/__tests__/drawerGuard.test.ts`: a Vitest test that reads the repo file list and asserts NO file matching `pages/**/*Detail.tsx` nor the list pages (`Companies.tsx`, `Contacts.tsx`, `Incidents.tsx`, `Projects.tsx`, `Procurement.tsx`) imports `<Drawer>` / from a `Drawer` module (allow `DocumentDrawer`, the one legitimate line-object drawer). Implement by globbing those files and asserting none contains `from '@/src/components/ui'` … `Drawer` as a named import other than `DocumentDrawer`. Assert it PASSES today (invariant A is clean) — the test is the regression guard. To prove the guard bites, include a unit on the matcher function with a synthetic positive string.
**Green.** Add `pmo-portal/src/lib/drawerGuard.ts` exporting `isForbiddenDrawerImport(source: string): boolean` (the matcher); the test consumes it over the globbed files. No production wiring — guard is test-only.
**Verify.** `cd pmo-portal && npm test -- drawerGuard && npm run typecheck`

### W4-T19 — ApprovalRow leading `disclosure` slot (one border style) — AC-JR-W4-01
**Red.** `src/components/ui/__tests__/ApprovalRow.disclosure.test.tsx`: render `<ApprovalRow name week hours disclosure={<button data-testid="disc"/>}>actions</ApprovalRow>`; assert the disclosure node renders at the **leading edge** (before the avatar/name) and the actions still render trailing. Fails (no `disclosure` prop; chevron currently arrives via children → trailing).
**Green.** In `pmo-portal/src/components/ui/ApprovalRow.tsx`: add `disclosure?: React.ReactNode;` to props; render it as the first child of the row flex (before the avatar `<span>`). Keep the dashed→**solid** border decision consistent with the procurement row: change `border-dashed` to a single shared border token to match `ProcurementApprovalRow` (`border-b border-border`) so both queues read identically (owner-confirmed chevron-position + border bug, census violation B).
**Verify.** `cd pmo-portal && npm test -- ApprovalRow.disclosure && npm run typecheck`

### W4-T20 — Route the timesheet approval chevron through the disclosure slot — AC-JR-W4-02
**Red.** `pages/timesheets/__tests__/ApprovalsQueue.disclosure.test.tsx`: render a sheet row; assert the expand chevron is at the leading edge (the disclosure slot), not after the status pill. Fails (currently passed as a child → trailing, `ApprovalsQueue.tsx:362-373`).
**Green.** In `pmo-portal/pages/timesheets/ApprovalsQueue.tsx`, move the disclosure `<Button>` (363-373) out of `ApprovalRow`'s children into its new `disclosure={…}` prop. Keep the approve/select children trailing. The leading-edge position + solid border now match the procurement queue.
**Verify.** `cd pmo-portal && npm test -- ApprovalsQueue.disclosure && npm run typecheck`

### W4-T21 — Wire SalesPipeline Funnel onSelect/selectedIndex to scope — AC-JR-W4-03
**Red.** `pages/__tests__/SalesPipeline.funnel.test.tsx`: render the pipeline; click the Negotiation funnel cell; assert the table/board scope narrows to that stage (only Negotiation rows shown) and the cell shows selected styling. Clicking it again clears the stage filter. Fails (`SalesPipeline.tsx:347` `<Funnel>` passes no `onSelect`).
**Green.** In `pmo-portal/pages/SalesPipeline.tsx`:
1. Add `const [stageIndex, setStageIndex] = useState<number | null>(null);` and a derived `selectedStatus = stageIndex != null ? OPEN_COLUMNS[stageIndex].statuses[0] : null;`.
2. Extend the `filtered` memo (lines 89-104) to also filter by `selectedStatus` when set (reusing the existing `DEAL_SCOPES`/`scope` machinery — the stage filter intersects the Open scope; selecting a stage implies Open).
3. Apply the same stage scope to the kanban filtered set if applicable.
4. Pass `selectedIndex={stageIndex ?? undefined}` and `onSelect={(i) => setStageIndex(prev => prev === i ? null : i)}` to `<Funnel stages={funnelStages} … />` at line 347.
**Verify.** `cd pmo-portal && npm test -- SalesPipeline.funnel && npm run typecheck`

> **AC-JR-W4 (no-op):** ADR-0028 also covers violation A which is VERIFIED-CLEAN — no code beyond the T18 guard.

---

## WAVE 5 — Deeper job fixes (non-schema only; Admin-invite + Incident-notes EXCLUDED → separate addendum)

### W5-T22 — ProjectGantt: `GanttBarRow` accepts `onActivate` (SHARED-FIRST for W5) — AC-JR-W5-01 (part 1)
> **Spec override (owner directive):** the prior spec marked the Gantt **read-only by design** (`ProjectGantt.tsx` header doc; census §2). The owner explicitly directs making Gantt bars activate a task. This task OVERRIDES that read-only decision; record it in the build commit body and reference this plan.

**Red.** `pages/project-detail/__tests__/ProjectGantt.activate.test.tsx`: render `<ProjectGantt tasks milestones onActivateTask={spy} />`; click a bar (and a diamond point); assert `spy` is called with the corresponding `TaskWithRefs` (resolved by `bar.id`). Activate via keyboard (Enter) too. Fails (no prop; bars are static divs).
**Green.** In `pmo-portal/pages/project-detail/ProjectGantt.tsx`:
1. Add `onActivateTask?: (task: TaskWithRefs) => void;` to `ProjectGanttProps`; thread it to each `<GanttBarRow … />` (line 198) plus the task lookup map `new Map(tasks.map(t => [t.id, t]))`.
2. `GanttBarRowProps` gains `onActivate?: () => void;`. When provided, make the bar/diamond a `role="button" tabIndex={0}` with `onClick`/`onKeyDown` (Enter/Space) → `onActivate()`, plus hover/focus affordance (`hover:brightness` is off-token; use `focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-ring` + `cursor-pointer`). Milestone-lane bars only (not the milestone header).
3. The parent resolves `bar.id`→task and calls `onActivateTask(task)`.
**Verify.** `cd pmo-portal && npm test -- ProjectGantt.activate && npm run typecheck`

### W5-T23 — TasksTab wires Gantt activation to `setFormTarget` — AC-JR-W5-01 (part 2)
**Red.** Extend `ProjectGantt.activate.test.tsx` OR add `pages/project-detail/tabs/__tests__/TasksTab.gantt.test.tsx`: render TasksTab in timeline view with edit perms; activating a Gantt bar opens the task edit modal (the same `setFormTarget({ task })` the List view uses). Fails (line 298 passes no handler).
**Green.** In `pmo-portal/pages/project-detail/tabs/TasksTab.tsx:298`, pass `onActivateTask={canEdit ? (t) => setFormTarget({ task: t }) : undefined}` to `<ProjectGantt …/>` — identical to the List view's `onActivate` (line 270/283).
**Verify.** `cd pmo-portal && npm test -- TasksTab.gantt && npm run typecheck`

### W5-T24 — IncidentDetail "Reported by" field (DAL read join) — AC-JR-W5-02
**Red.** `pages/__tests__/IncidentDetail.reportedby.test.tsx`: mock `useIncident` to return an incident with a joined `reporter: { full_name: 'Dana PM' }`; assert a "Reported by" `<Field>` shows "Dana PM"; with no reporter, shows "—". Fails (field not rendered; row type has no reporter).
**Green.**
1. `pmo-portal/src/lib/db/incidents.ts`: add `export type IncidentWithReporter = IncidentRow & { reporter: { full_name: string } | null };` and change `getIncident` to select the reporter join: `.select('*, reporter:profiles!incident_reports_reported_by_fkey(full_name)')` returning `IncidentWithReporter | null`. (FK name: confirm via `database.types`; if the constraint name differs, use the embedded-resource alias the generated types expose. No schema change — read shape only.)
2. The repository/hook return type flows through (`repositories.incident.get`); update the hook generic to `IncidentWithReporter | null`.
3. `pmo-portal/pages/IncidentDetail.tsx:179-185`: add `<Field label="Reported by" value={incident.reporter?.full_name ?? '—'} />` to the detail `dl`.
**Verify.** `cd pmo-portal && npm test -- IncidentDetail.reportedby && npm run typecheck`

### W5-T25 — MyTasks precise task target + TasksTab scroll/highlight — AC-JR-W5-03
**Red.** `pages/__tests__/MyTasks.tasktarget.test.tsx`: assert the task-name link targets `/projects/:projectId/tasks#task-<id>` (not just `/tasks`). Add a TasksTab assertion: when mounted with a location hash `#task-<id>`, the matching row receives a transient highlight + `scrollIntoView`. Fails (`MyTasks.tsx:138-144` links to `/projects/:id/tasks` with no task anchor).
**Green.**
1. `pmo-portal/pages/MyTasks.tsx:138-144`: change `to={\`/projects/${task.project_id}/tasks\`}` → `to={\`/projects/${task.project_id}/tasks#task-${task.id}\`}`.
2. `pmo-portal/pages/project-detail/tabs/TasksTab.tsx`: read `useLocation().hash`; when it matches `#task-<id>`, set a `data-task-id` on each rendered task row (add `data-task-id={t.id}` to the DataTable row or the grouped list row) and on mount/hash-change `document.getElementById`/query the row, call `scrollIntoView({ block:'center' })` and toggle a transient ring class (`ring-2 ring-ring` for ~2s via a state flag). Keep it dependency-light (a `useEffect` keyed on hash + `all`). No new route — the existing `/projects/:id/tasks` route already renders TasksTab; the hash is read client-side (lower risk than a new `/tasks/:taskId` route).
**Verify.** `cd pmo-portal && npm test -- MyTasks.tasktarget && npm run typecheck`

---

## 3. Definition of Done (per task + program)
- Each task: failing test written first (named with its `AC-JR-…` id in the `it(...)` title per ADR-0010 tagging), then minimal green, then `npm run typecheck` clean.
- Program gates before merge: `cd pmo-portal && npm run typecheck && npm run lint && npm test && npm run build` all green; coverage ≥80% on changed files (the new components/branches are directly tested).
- No source/test edits outside the cited files. No schema migration consumed (0033 stays reserved). No e2e changes (no journey altered; `/approvals` inline-approve + procurement journeys unchanged).
- ADRs authored: `docs/adr/0028-linked-record-affordance-drawer-invariant.md`, `docs/adr/0029-single-status-variant-authority.md`.

## 4. ADR stubs to author (content outline)
**ADR-0028 — Linked-record affordance + drawer-vs-detail invariant.** Context: census violation E (inert linked names) + A (drawer-vs-detail, verified clean). Decision: one `ProjectNameLink` primitive is the click-to-open affordance for a named project on every transactional surface; a test-only grep guard prevents `*Detail`/list pages from reintroducing `<Drawer>` (except `DocumentDrawer`). Consequences: uniform affordance, cheap regression protection, no runtime cost.
**ADR-0029 — Single status→variant authority.** Context: census violation D (`pillVariantForProjectStatus` vs `pillVariantForStatus` drift, masked by identical render). Decision: the CW-2 registry (`workflowVariant`) is the sole authority; both legacy helpers re-export/delegate to it; a guard test asserts agreement across every project-status enum value. Consequences: status tint can never drift; one place to change; the guard fails CI on divergence.

---

## 5. Open questions for the Director
1. **W2-T15opt (Projects rowMenu/ProjectCard kebab)** is census "Minor / low priority". Include in this program or push to backlog? (Plan defaults: implement only if wave budget allows; AC-JR-W2-04 otherwise unclaimed.)
2. **W3-T17 company activity log form** requires choosing a contact (because `crm_activities.contact_id` is NOT NULL — `crmActivities.ts`). Acceptable that an "account-level" log still attaches to a contact, or does the owner want a true company-level activity (no contact) — which WOULD need schema (a nullable `contact_id` + a company FK) and belongs in the CRM/schema addendum, consuming migration 0033 + pgTAP 0075? Plan assumes the former (no schema).
3. **W5-T24 reporter join** — confirm the FK constraint name for the `profiles` embed (`incident_reports_reported_by_fkey` assumed). If the generated types expose a different alias, the implementer uses that; flag if the `reported_by` FK to `profiles` doesn't exist (would push this to the schema addendum).
4. **W4-T16 status authority** is import-graph-wide (re-pointing two helpers used across Projects/Pipeline/Kanban/PMDashboard). It changes some *latent* tints (e.g. projects.ts `On Hold→overdue` becomes registry `warn`; Leads `draft` stays). Confirm the registry's mapping is the desired single truth (it is, per CW-2) and that the visible-today renders don't regress — the full `npm test` after T16 is the safety net.
5. The two EXCLUDED items (Admin "New user" invite, Incident investigation append-log) — confirm they remain out of this plan pending their grill/addendum (census §2 Admin row + Incident 'Investigating' row).
