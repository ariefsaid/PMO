export const meta = {
  name: 'jtbd-consumers',
  description: 'JTBD remediation consumer fan-out — 10 file-disjoint packages built TDD in parallel worktrees',
  phases: [{ title: 'Build', detail: '10 packages, each a worktree implementer committing its own branch' }],
}

// Each package owns a DISJOINT set of files (verified) so the 10 branches merge clean.
// Every package forks from the current HEAD = jtbd-remediation with P0 (ProjectNameLink,
// ApprovalRow disclosure slot, status registry authority, Gantt onActivate) already merged.
const PKGS = [
  {
    pkg: 'pa', branch: 'jtbd-pa', title: 'Procurement list/board project links',
    files: 'pmo-portal/pages/Procurement.tsx, pmo-portal/pages/procurement/ProcurementListRow.tsx, pmo-portal/components/ProcurementBoard.tsx (+ their tests)',
    work:
      'Census violation E (dead project names). Replace the inert project-name text with the shared <ProjectNameLink projectId={r.project_id} name={r.project?.name}/> primitive (import from `@/src/components/ui/ProjectNameLink`) at: Procurement.tsx:172 (table project column), ProcurementListRow.tsx:162 (row meta), ProcurementBoard.tsx:46 (board card). Keep the em-dash/null behavior (the primitive handles it). Plan tasks T02/T03/T04.',
  },
  {
    pkg: 'pb', branch: 'jtbd-pb', title: 'Procurement detail + DecisionSupportPanel links',
    files: 'pmo-portal/pages/ProcurementDetails.tsx, pmo-portal/pages/procurement/DecisionSupportPanel.tsx (+ tests)',
    work:
      'Census violation E + dead-end. In ProcurementDetails.tsx wrap p.project.name in <ProjectNameLink> at the RecordHeader meta strip (:550, the priority slot) and the StatTile sub-labels (:524, :539) and :386. In DecisionSupportPanel.tsx make the "Budget impact · {projectName}" heading (:56) a link to the project AND add an explicit "Open project budget" affordance (it already has projectId). Use the shared ProjectNameLink where it fits; for the DSP "Open project budget" use a plain <Link to={/projects/${projectId}}> styled per DESIGN.md. Plan task T06.',
  },
  {
    pkg: 'pc', branch: 'jtbd-pc', title: 'Approvals — links + unified disclosure',
    files: 'pmo-portal/pages/approvals/ProcurementApprovalRow.tsx, pmo-portal/pages/timesheets/ApprovalsQueue.tsx (+ tests). Do NOT edit TimesheetGrid.tsx (owned by package PD).',
    work:
      'Two things. (1) Census E/dead-display: in ProcurementApprovalRow.tsx wrap the project name (:132) in <ProjectNameLink>, and add an "Open request" link to /procurement/:id inside the expanded panel (alongside Approve/Reject) — keep the inline approve fast-path. (2) Consistency violation B (owner-confirmed chevron drift): route BOTH the procurement approval row and the timesheet approval row through the shared <ApprovalRow> using its new LEADING `disclosure` slot (added in P0) so the expand chevron sits on the SAME leading edge with the SAME border style. The timesheet row is rendered in ApprovalsQueue.tsx (~:363-373); the procurement row in ProcurementApprovalRow.tsx (currently hand-rolls a leading chevron at :104-118). Unify them on the leading-disclosure pattern; drop the divergent dashed-vs-solid border + decorative-avatar mismatch. Plan tasks T07 + T20.',
  },
  {
    pkg: 'pd', branch: 'jtbd-pd', title: 'Timesheet read-only project links',
    files: 'pmo-portal/src/components/ui/TimesheetGrid.tsx and the buildGrid source (wherever TimesheetGridRow is built) (+ tests). Do NOT edit ApprovalsQueue.tsx (owned by PC).',
    work:
      'Census E. TimesheetGridRow currently has no project id (TimesheetGrid.tsx:17-23). Add optional `projectId?: string` to the row type; buildGrid already has `e.project_id` so populate it (plan T09). In the READ-ONLY branches only (desktop :225, mobile :396) render the project name via <ProjectNameLink projectId={row.projectId} name={row.label-or-name}/>; keep the EDITABLE branch as plain text (no link while editing). Make this self-contained in TimesheetGrid — link whenever a read-only row has a projectId, so NO caller change is needed. Plan tasks T08/T09.',
  },
  {
    pkg: 'pe', branch: 'jtbd-pe', title: 'Dashboard status drill + noun',
    files: 'pmo-portal/src/components/dashboard/StatusBarChart.tsx, pmo-portal/pages/ExecutiveDashboard.tsx (+ tests)',
    work:
      'Census dead-display + noun C. (1) StatusBarChart is generic — add an optional `hrefFor?(status) => string` prop; when provided, render each legend entry (and/or bar Cell) as a Link. No behavior change for other callers when omitted (plan T05). (2) In ExecutiveDashboard wire the Procurement-by-Status chart with hrefFor = `/procurement?status=${encodeURIComponent(status)}` (that filter is already parsed at Procurement.tsx:113). (3) Noun fix: change the KPI help text "opportunity value" → "project value" (ExecutiveDashboard.tsx:219). Plan T05 + consistency C.',
  },
  {
    pkg: 'pf', branch: 'jtbd-pf', title: 'Sales funnel interactivity + noun',
    files: 'pmo-portal/pages/SalesPipeline.tsx, pmo-portal/src/components/ui/Funnel.tsx if needed (+ tests)',
    work:
      'Consistency E (inert Funnel) + noun C. (1) <Funnel> already supports onSelect/selectedIndex (Funnel.tsx:18,30-46) but SalesPipeline.tsx:347 passes none — pass an onSelect that sets the table/board stage scope (reuse the existing DEAL_SCOPES SegFilter mechanism at :364) and selectedIndex to highlight the active stage. (2) Rename the user-facing table column header "Opportunity" → "Project" (SalesPipeline.tsx:140). Internal symbol names (DealCard/DealScope) may stay. Plan: consistency E + C.',
  },
  {
    pkg: 'pg', branch: 'jtbd-pg', title: 'Contact detail action affordances',
    files: 'pmo-portal/pages/ContactDetail.tsx (+ test)',
    work:
      'Census dead-display cluster. (1) Reverse contact→company link: render the "Company" field (:187) as a <Link to={/companies/${contact.company_id}}> when company_id resolves (closes the one-directional graph). (2) Email/Phone (:189-190): render as <a href="mailto:…">/<a href="tel:…"> when present, keep em-dash fallback. (3) CRM activity rows (:343-352): when an activity carries project_id/company_id, render the row/subject as a Link to /projects/:id or /companies/:id. Plan T10.',
  },
  {
    pkg: 'ph', branch: 'jtbd-ph', title: 'CRM hub — CompanyDetail buildout',
    files: 'pmo-portal/pages/CompanyDetail.tsx, pmo-portal/src/hooks/useContacts.ts, pmo-portal/pages/Contacts.tsx (contact-create company prefill) (+ tests). This is the biggest package — owns the whole CRM hub.',
    work:
      'Owner complaint #4 (the deepest job gap). NO SCHEMA — aggregate over existing contact-scoped crm_activities client-side. Implement on CompanyDetail: (1) ERROR STATE (plan T15/T16w3): CompanyContactsList currently shows a false "No contacts yet" on fetch error — add an isError branch rendering <ListState variant="error" onRetry={refetch}/> (useContactsByCompany already returns isError/refetch, useContacts.ts:38-46). (2) IN-CONTEXT "Add contact" (plan T14): a CanWrite-gated "Add contact" button in the Contacts CardHead that opens the contact create modal with company_id defaulted to this company — extend the Contacts create form (Contacts.tsx) to honor a company prefill (it currently only prefills from an existing contact). (3) ACCOUNT ACTIVITY TIMELINE + "Log activity" (plan T17, the headline capability): aggregate this company\'s contacts\' crm_activities into one account-level timeline on CompanyDetail; add a gated "Log activity" that opens the existing activity form — since crm_activities.contact_id is NOT NULL, the form requires/defaults to a contact of this company (pick primary or a selector). Add a company-scoped aggregation in useContacts (client-side fan-in over the company\'s contacts; no DB change). (4) Related-opportunities / primary-contact surface on the account card (plan T18): show a primary-contact link and a "Related opportunities" RelatedList (reuse the existing RelatedList + the company\'s projects/deals data). Strictly DESIGN.md tokens.',
  },
  {
    pkg: 'pi', branch: 'jtbd-pi', title: 'Project-detail tabs + My-Tasks targeting',
    files: 'pmo-portal/pages/project-detail/tabs/ProcurementTab.tsx, pmo-portal/pages/project-detail/tabs/TasksTab.tsx, pmo-portal/pages/MyTasks.tsx, pmo-portal/App.tsx (+ tests)',
    work:
      '(1) In-context add (plan T13): ProcurementTab has no way to raise a PR against THIS project — add a gated "New request" button (header + empty-state) mounting NewProcurementModal with projectId pre-selected. (2) Gantt activation (plan T23): wire TasksTab\'s <ProjectGantt> to pass onActivate (added in P0) so a timeline bar opens/edits the task through the SAME setFormTarget the List view uses. (3) My-Tasks precise target (plan T25): clicking a task name should land on that specific task, not the whole Tasks tab — add a `#task-<id>` anchor with scroll-into-view + a transient highlight in TasksTab, and have MyTasks.tsx:138-144 link to `/projects/:projectId/tasks#task-<taskId>` (add the route/handling in App.tsx/TasksTab as needed). Plan T13/T23/T25.',
  },
  {
    pkg: 'pj', branch: 'jtbd-pj', title: 'Projects rowMenu + Admin mailto + drawer guard + ADRs',
    files: 'pmo-portal/pages/Projects.tsx, pmo-portal/components/ProjectCard.tsx, pmo-portal/pages/AdminUsers.tsx, a drawer grep-guard test, docs/adr/0028-*.md, docs/adr/0029-*.md (+ tests)',
    work:
      '(1) Projects in-list edit (plan T15opt): add a rowMenu (Edit → ProjectFormModal mode=editHeader, + Archive) to the Projects DataTable matching Companies.tsx:141-147, and a kebab/Edit to ProjectCard. Gate with the same can() the header edit uses. (2) Admin interim invite (plan T26 — Director delta): replace the permanently-disabled "New user" button (AdminUsers.tsx:360-365) with an HONEST working affordance — a "Copy invite instructions" button (copies a short onboarding message to clipboard) and/or a mailto link. NO edge function, NO auth/service-role, NO schema. (3) Drawer-vs-detail guard (plan T21): add a test (e.g. a vitest that greps source) failing if any pages/*Detail.tsx or the Company/Contact/Incident/Project/Procurement list pages import `<Drawer>` — codifies the invariant the census verified clean. (4) Write ADR-0028 (linked-record affordance via ProjectNameLink + drawer-vs-detail invariant) and ADR-0029 (single status→variant authority = registry workflowVariant) — short, in docs/adr/. Plan T15opt/T21/T26 + ADRs.',
  },
]

phase('Build')
const results = await parallel(PKGS.map((p) => () =>
  agent(
    `You are building consumer package **${p.pkg.toUpperCase()} — ${p.title}** of the JTBD remediation, strictly TDD (red→green→refactor). The shared P0 seams already exist on your base branch: ProjectNameLink (\`src/components/ui/ProjectNameLink.tsx\`), ApprovalRow leading \`disclosure\` slot, the registry status-variant authority, and ProjectGantt \`onActivate\`.\n\n` +
    `ENV (worktree): the app is in \`pmo-portal/\`. A fresh worktree has no node_modules — FIRST, from the worktree root: \`cd pmo-portal && [ -d node_modules ] || ln -s /Users/ariefsaid/Coding/PMO/pmo-portal/node_modules node_modules\`. Run all npm commands inside \`pmo-portal/\`.\n\n` +
    `YOUR FILES (touch ONLY these — other packages own everything else; staying in-bounds keeps the parallel merge clean): ${p.files}\n\n` +
    `WORK: ${p.work}\n\n` +
    `CONTEXT: the exhaustive findings with exact file:line are in \`docs/reviews/2026-06-14-jtbd-census.md\`; the plan task specs are in \`docs/plans/2026-06-15-jtbd-remediation.md\` (read ONLY the task blocks named above). Follow the architecture contract: repository seam (no DAL/org_id from the client), can()=UX gating on write affordances, strictly DESIGN.md tokens. Build the empty/loading/error states where you add async regions.\n\n` +
    `TDD: write the failing RTL/Vitest test FIRST for each behavior, then implement. Tag each test title with its AC id from the plan where one exists. Cover all states. Coverage ≥80% on your changed files.\n\n` +
    `GATES (from pmo-portal/): \`npm run typecheck\` zero errors; \`npm test -- <your changed test files>\` green; ESLint clean on touched files. (Do not run the full suite — that is the Director\'s central gate.)\n\n` +
    `COMMIT: \`git checkout -b ${p.branch}\` and commit your work there (message \`feat(jtbd-${p.pkg}): ${p.title}\`, trailer \`Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>\`). Do NOT push, do NOT open a PR, do NOT merge.\n\n` +
    `REPORT (structured): branch name, files changed, the verbatim typecheck + scoped-test result lines, the AC ids you covered, anything out of your file-bounds you discovered was needed (DO NOT edit it — report it), and anything you escalated rather than guessed.`,
    { label: `build:${p.pkg}`, phase: 'Build', agentType: 'implementer', isolation: 'worktree' }
  )
))

return PKGS.map((p, i) => ({ pkg: p.pkg, branch: p.branch, report: results[i] }))
