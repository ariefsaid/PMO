# PMO Portal — Exhaustive JTBD Census & Coherence Review

> **Method note (why this exists).** The prior 4-lens review was a *narrative walkthrough* — it sampled what jumped out and so kept leaking real defects (the Gantt, the chevron drift, the inert project names). This census replaces the walk with an **enumerated denominator** (all 16 primary routes) × three fixed oracles applied to **every** rendered record — (1) action-completeness ("then what?": open / add / edit / advance / back), (2) cross-screen consistency invariants, (3) job-fit per role. A census cannot miss a screen because it counted them all first. Run: 2026-06-14, 16 parallel screen audits + 1 cross-screen consistency pass + synthesis (`jtbd-exhaustive-census` workflow).

## 1. Severity rollup & headline thesis

| Severity | Count |
|---|---|
| **Critical** | 0 |
| **Important** | 12 |
| **Minor** | 15 |
| **Total findings** | 27 |
| Cross-screen consistency violations | 7 (4 important · 3 minor; invariant A is VERIFIED-CLEAN) |

**Headline thesis.** The app is *structurally* coherent — record-display is uniform (every primary object routes to a detail page; the owner's "drawer vs detail" complaint is **stale/resolved**) and there are **zero critical** breakages. The real defect class is **dead-display & dead-end**: a record is richly *named* but stops short of the next obvious action. It shows up overwhelmingly as **an inert linked-record NAME** — the same `project.name` token is a routed `<Link>` on the dashboard and My-Tasks but plain text on **every** procurement, timesheet, and approval surface (consistency violation E, the single largest cluster). The second class is **missing in-context CRUD** — hub/parent records (CompanyDetail, the project Procurement tab) lack the `+ Add` affordance their own list screens carry. The deepest *job* gap is the **CRM hub**, which today is a read-only fact sheet, not a relationship workspace. Net: a **presentation-and-affordance** problem (links, buttons, one shared mapping), not an architecture problem — cheap to fix, high coherence payoff.

---

## 2. Exhaustive per-screen matrix

### Dashboard (Executive)
| Sev | Kind | Object | Location | Then-what | Fix |
|---|---|---|---|---|---|
| Important | dead-display | Procurement-by-Status bars + legend | StatusBarChart.tsx:79-101 (from ExecutiveDashboard.tsx:134) | Exec sees "Requested 7", wants to open that bucket; neither bar nor legend is a Link/button. | Live drill `/procurement?status=<Status>` already exists (Procurement.tsx:113). Make each legend entry/Cell a Link, mirroring the actionable KPI tile. |
| Minor | dead-display | ProjectedMarginBars per-open-stage rows | ProjectedMarginBars.tsx:51-74 | Exec reads "Proposal — $1.2M weighted", wants to open that stage; rows are plain span/progressbar; card has no path to /sales. | Card footer Link "Open the sales pipeline" → /sales. Per-stage deep links optional. |

### Projects list
| Sev | Kind | Object | Location | Then-what | Fix |
|---|---|---|---|---|---|
| Minor | missing-edit | Project rows / ProjectCard | Projects.tsx:509-532 (no rowMenu); contrast Companies.tsx:141-147 | PM wants rename/re-assign/archive in place; Companies/Contacts edit from the list, Projects doesn't. | Add `rowMenu` (Edit editHeader + Archive) + ProjectCard kebab. Low priority. |

### Project detail (/projects/:id/:tab)
| Sev | Kind | Object | Location | Then-what | Fix |
|---|---|---|---|---|---|
| Important | missing-add | ProcurementTab — project-scoped PR register | ProcurementTab.tsx:108-119 & :115-118 | PM opens the tab to raise a PR against THIS project; no New/Raise button. Must leave to global index and re-select the project FK. | Gated "New request" (header + empty-state) mounting NewProcurementModal with projectId pre-selected. |
| Minor | dead-display | ProjectGantt task bar/diamond (GanttBarRow) in Tasks→Timeline | ProjectGantt.tsx:212-267 | PM sees a named task bar, wants to click→open/edit; no Link/onClick. List/Board siblings DO open tasks. | Spec marks Gantt read-only (by-design at view level). To fix drift: GanttBarRow accepts onActivate(task) → same setFormTarget the List view uses. |

### Sales pipeline
| Sev | Kind | Object | Location | Then-what | Fix |
|---|---|---|---|---|---|
| Important | dead-display | Funnel stage cell (name, gross, weighted, win%) | SalesPipeline.tsx:347; interactivity gated on `onSelect` at Funnel.tsx:30-46 | PM reads "Negotiation — $X, 60%", wants to click to scope deals; Funnel supports it but SalesPipeline passes no onSelect. | Pass `onSelect`/`selectedIndex`; filter the table/board scope (reuse DEAL_SCOPES SegFilter at :364). |

### Procurement list (/procurement)
| Sev | Kind | Object | Location | Then-what | Fix |
|---|---|---|---|---|---|
| Minor | dead-display | Project name (table, list-row meta, board card) | Procurement.tsx:172, ProcurementListRow.tsx:162, ProcurementBoard.tsx:46 | Reads a PR's owning project but can't click to pivot to budget/timeline. | Wrap in `<Link to=/projects/${r.project_id}>` (all three), matching BvACard. |
| Minor | dead-end | DecisionSupportPanel heading + StatTiles (expanded preview) | DecisionSupportPanel.tsx:50-58,149 | "Remaining vs committed" negative → next move is open the project budget; no link. | Make heading projectName a Link (or add "Open project budget"). |

### Procurement detail
| Sev | Kind | Object | Location | Then-what | Fix |
|---|---|---|---|---|---|
| Important | dead-display | p.project.name — RecordHeader meta, StatTile sub-labels, DSP heading | ProcurementDetails.tsx:550,524,539; DecisionSupportPanel.tsx:56 | Reviewing spend, wants to open the owning project (the most important related object); unclickable → leave + search. Linked everywhere else. | Wrap in `<Link to=/projects/${p.project_id}>` (RecordHeader meta is the priority slot). Vendor stays plain (no vendor route). |

### Timesheets (incl. shared ApprovalsQueue on /approvals)
| Sev | Kind | Object | Location | Then-what | Fix |
|---|---|---|---|---|---|
| Minor | dead-display | Project row label in read-only TimesheetGrid (locked week) | TimesheetGrid.tsx:225 (desktop) & :396 (mobile) | Viewing a submitted/returned week, wants /projects/:id to check scope/budget; plain div. | Wrap read-only name in `<Link to=/projects/${row.id}>`. Keep editable branch plain. |
| Minor | dead-end | Project rows in the expanded read-only grid in the approval queue | ApprovalsQueue.tsx:407 → TimesheetGrid.tsx:225 | Approver expands a week to review hours-by-project but can't click any project. | Same single TimesheetGrid fix resolves both engineer + approver. |

### Approvals (/approvals)
| Sev | Kind | Object | Location | Then-what | Fix |
|---|---|---|---|---|---|
| Minor | dead-display | Project name on a procurement approval row | ProcurementApprovalRow.tsx:132 | Approver wants to open the project to inspect budget before deciding; plain text. | Link to /projects/:id; keep approve/reject inline. |
| Minor | dead-display | PR title + code on the procurement approval row | ProcurementApprovalRow.tsx:120-128 | After inline review, wants the full record (attachments, history); can't open it. | Add "Open request" → /procurement/:id in the expanded panel; keep inline fast path. |
| Minor | dead-display | Requester name | ProcurementApprovalRow.tsx:133 | Wants to reach the requester; plain text. | Link if a person route exists; else dismissable (lowest priority). |

### Companies list — *no findings.*

### Company detail (/companies/:id)
| Sev | Kind | Object | Location | Then-what | Fix |
|---|---|---|---|---|---|
| Important | error-state | CompanyContactsList async region | CompanyDetail.tsx:375-391 | Transient load failure → expects error+Retry; instead a confident "No contacts yet" → concludes none exist. **Verified: only isPending+data, no isError branch.** | Add isError branch → `<ListState variant="error" onRetry={refetch}/>` (useContacts.ts:38-46 returns isError/refetch). |
| Important | missing-add | Contacts card | CompanyDetail.tsx:200-205,375-410 | Wants to add a contact for this company; no add button. Must leave to /contacts, which can't pre-select the company. | CanWrite-gated "Add contact" in CardHead → contact create modal with company_id defaulted. |
| Important | job-mismatch | CompanyDetail body (no activity timeline) | CompanyDetail.tsx:181-205 | Framed as the CRM hub but only Name/Type + related delivery objects. The primary CRM job — log a call/meeting & see interaction history — has no entry point. | Account-level activity timeline + "Log activity" (aggregate contacts' CrmActivity or company-scoped query). |
| Minor | dead-display | "Company detail" definition-list (Name, Type) | CompanyDetail.tsx:182-190 | Exec expects account context (primary contact, won/pipeline value); two static fields, no pivot to pipeline. | Primary-contact link + "Related opportunities" RelatedList. |

### Contacts list — *no findings.*

### Contact detail
| Sev | Kind | Object | Location | Then-what | Fix |
|---|---|---|---|---|---|
| Important | dead-display | "Company" field (resolves a real company) | ContactDetail.tsx:187 | Wants contact→company; plain text. Graph is one-directional (company→contacts links, reverse doesn't) though /companies/:id is live. | Render Company as a Link → /companies/${company_id}. |
| Minor | dead-display | CRM activity timeline rows | ContactDetail.tsx:343-352 | Activity carries company_id/project_id; user expects to open it; static `<li>`. | Link rows to /projects/:id or /companies/:id; optional edit/delete gated by can(). |
| Minor | dead-display | "Email" / "Phone" fields | ContactDetail.tsx:189-190 | The obvious CRM action is to contact them; bare strings, no mailto:/tel:. | `<a href="mailto:…">` / `<a href="tel:…">` with em-dash fallback. |

### Incidents list — *no findings.*

### Incident detail (/incidents/:id)
| Sev | Kind | Object | Location | Then-what | Fix |
|---|---|---|---|---|---|
| Important | job-mismatch | Incident 'Investigating' — only a read-only Description | IncidentDetail.tsx:156-198 | After "Start investigating", the job is to record findings/corrective actions over time; no log, no append, no attachments — one overwriteable description. | Findings/notes region (append-only log) for Investigating\|Closed. **May need schema column/child table → Director scope.** |
| Minor | dead-display | Reporter (reported_by) — never displayed | IncidentDetail.tsx:179-185 | Opening an incident, expects WHO filed it; data exists but is never rendered. | "Reported by" Field (resolve profile name). Hook may need to join the profile. |

### My Tasks (/my-tasks)
| Sev | Kind | Object | Location | Then-what | Fix |
|---|---|---|---|---|---|
| Minor | job-mismatch | Task-name Link → lands on the whole project Tasks tab, not the task | MyTasks.tsx:138-144 | Clicks a task name to open that task; dropped on the full Tasks listing, re-finding by eye. | `/projects/:id/tasks/:taskId` or `#task-<id>` anchor + scroll/highlight. |

### Admin (/administration/users)
| Sev | Kind | Object | Location | Then-what | Fix |
|---|---|---|---|---|---|
| Important | job-mismatch | "New user" primary button — permanently disabled | AdminUsers.tsx:360-365 | The Admin's #1 job is invite a person; button hard-disabled, no fallback. | Ship the server-side invite path (Supabase admin API / edge fn) or an interim mailto/"copy invite" fallback. |
| Minor | dead-end | DataTable user rows | AdminUsers.tsx:288-296 | Row names a person; click does nothing. Write actions reachable via row kebab → action-complete for Admin. | Acceptable as-is (row menu covers verbs). |

---

## 3. Cross-screen consistency violations

- **E — Linked-record NAME is the universal click-to-open affordance *(important — dominant cluster)*.** POSITIVE: BvACard.tsx:47, MyTasks.tsx:120-142 wrap project name in `<Link>`. VIOLATIONS (all inert): Procurement.tsx:172; ProcurementListRow.tsx:162; ProcurementBoard.tsx:46; ProcurementDetails.tsx:550,524,539,386; DecisionSupportPanel.tsx:56 (in BOTH /procurement preview AND /approvals); ProcurementApprovalRow.tsx:132; TimesheetGrid.tsx:225 & :396 (on /timesheets AND in ApprovalsQueue.tsx:407). **Fix:** one shared `ProjectNameLink` primitive, swapped into every site. Route already exists — pure presentation.
- **B — Action-zone / disclosure position *(important — owner-confirmed)*.** Procurement approval row: chevron LEADING, hand-rolled (ProcurementApprovalRow.tsx:104-118), solid border. Timesheet row: chevron as a child of `<ApprovalRow>` → RIGHT-aligned after the status pill (ApprovalRow.tsx:52-54, ApprovalsQueue.tsx:363-373), dashed border + avatar. **Fix:** one position (leading-edge) + one border; give ApprovalRow a dedicated leading `disclosure` slot.
- **E — Funnel wired inconsistently *(important)*.** `<Funnel>` supports onSelect (Funnel.tsx:18,30-46) but SalesPipeline.tsx:347 passes no handler → inert, while the same screen's SegFilter + board DO scope by stage. **Fix:** pass onSelect/selectedIndex.
- **E — In-context ADD missing on hub/parent records *(important)*.** CompanyDetail Contacts card (no "Add contact") and ProcurementTab (no "Raise request") lack the create CTA their list-screen siblings carry. **Fix:** add the gated CTA with the parent FK pre-seeded.
- **D — Status colour *(minor, latent)*.** `pillVariantForProjectStatus` (→ 'draft') vs `pillVariantForStatus` (→ 'progress') assign different tokens to identical pre-win statuses; masked only because StatusPill renders both identically today. **Fix:** one authority + a guard test.
- **C — Noun (Opportunity vs Project) *(minor)*.** SalesPipeline.tsx:140 column header "Opportunity"; ExecutiveDashboard.tsx:219 help text. **Fix:** rename user-facing to "Project".
- **A — Drawer vs detail *(VERIFIED CLEAN — owner note stale)*.** Every primary object routes to a detail page; the only live `<Drawer>` is DocumentDrawer (a line object). **Fix:** no code change — record satisfied + add a grep guard to prevent regression.

---

## 4. Owner's 5 complaints → census mapping

| # | Complaint | Verdict | Findings |
|---|---|---|---|
| 1 | Gantt unusable | **CONFIRMED (narrowed, by-design)** | ProjectGantt bars read-only (ProjectGantt.tsx:212-267); List/Board open tasks. The "unusable" feel = rich bar, zero next-action. |
| 2 | Procurement unnatural | **CONFIRMED & EXPANDED (a class)** | (a) No in-context "Raise request" on the project Procurement tab. (b) Project name dead on every procurement surface — largest cluster of violation E. |
| 3 | Approval chevron inconsistent | **CONFIRMED exactly** | Violation B — opposite chevron edges + border styles between procurement & timesheet rows. |
| 4 | Where is CRM | **CONFIRMED & EXPANDED (deepest job gap)** | No activity timeline / Log-activity, no in-context Add-contact, false-empty contacts error-state, one-directional contact→company link. See §5. |
| 5 | Drawer vs detail | **DEBUNKED — stale/resolved** | Invariant A clean; all primary objects route; only DocumentDrawer uses a drawer. |

---

## 5. Job-fit per role + the CRM-as-hub gap

- **Executive** — mostly fits; several read-outs dead-end (Procurement-by-Status bars, margin bars, thin company card). Lens-D friction: "I see a number, I can't open it."
- **PM / Finance (approver)** — functional but high-friction; cannot pivot PR/timesheet/approval → owning project (violation E). Procurement "unnatural" = raising a PR forces leaving the project.
- **Sales** — partially unsupported; contact email/phone inert, company link missing, funnel inert, and **no CRM hub**.
- **Engineer** — adequate; task link lands on the whole tab not the task; read-only timesheet labels inert.
- **Admin** — core job blocked; "New user" permanently disabled with no fallback.

**CRM-as-hub gap (the standout).** There is **no real CRM hub** — only a master-data record for a Company. Missing, in priority order: (1) account activity timeline + "Log activity" — the *primary* CRM job; (2) in-context "Add contact" carrying company_id; (3) error/Retry on the contacts list (false "No contacts yet" on error); (4) reverse contact→company link; (5) related-opportunities / primary-contact surface. Until 1–4 land, the hub is a navigable directory node, not an account workspace.

---

## 6. Prioritized remediation backlog (waves)

**Wave 1 — Linked-record-name dead-display sweep** *(first: cheapest, highest coherence payoff, closes the largest cluster + owner #2).* One shared `ProjectNameLink` primitive swapped into every inert project-name site (Procurement list/board/detail, DecisionSupportPanel, ProcurementApprovalRow, TimesheetGrid read-only); then adjacent dead-displays in the same pass: Dashboard Procurement-by-Status → `/procurement?status=`; "Open request" → /procurement/:id; "Open project budget"; ContactDetail email/phone → mailto:/tel:; ContactDetail Company → /companies/:id + activity-row links; margin-card "Open the sales pipeline" footer. All presentation-only, no schema.

**Wave 2 — In-context CRUD on hub/parent records** *(owner #2 + #4 partial).* ProcurementTab "New request" (projectId pre-seeded); CompanyDetail "Add contact" (company_id default); optional Projects rowMenu/ProjectCard kebab.

**Wave 3 — CRM hub buildout** *(owner #4 — deepest job gap; some items touch the data layer).* Contacts-list error/Retry state (small, do early); account-level activity timeline + "Log activity"; related-opportunities / primary-contact surface.

**Wave 4 — Affordance & shared-component consistency** *(owner #3).* Unify approval-queue disclosure (violation B); wire Funnel onSelect (E); collapse status→variant to one authority + guard test (D); rename Sales "Opportunity" → "Project" (C); add the drawer-vs-detail grep guard (A).

**Wave 5 — Deeper job fixes** *(may need schema/server; scope with Director).* Admin invite path; Incident investigation/notes surface; Incident "Reported by"; My-Tasks precise task target; Gantt task activation (only if revisiting the read-only spec).

**Sequencing:** Waves 1, 2, 4 are presentation/affordance — cheap, no migrations, retire owner #2 and #3 + the dominant dead-display class. Wave 3 (CRM) is mixed-cost (error-state now, timeline after). Wave 5 carries the schema/server items and lowest-frequency jobs.
