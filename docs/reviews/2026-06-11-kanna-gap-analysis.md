# Gap Analysis: PMO Project vs. Kanna Project Management Platform

> **Last enriched:** 2026-06-11. Originally drafted from citation research; enriched after full codebase inspection
> (routes, pages, hooks, migrations, `docs/backlog.md`, `review/epc-gap-analysis.md`).
> **Second pass (2026-06-11):** added §1.6 pricing/packaging/platform intel (from lp.kanna4u.com /features /pricing
> /solutions + Capterra), new gap rows #17–19 (project templates, i18n, guest access), corrections (S-Curve is now
> shipped, not "coming soon"; roles are Admin/Finance/PM/Engineer/**Executive**, not Viewer; Storage is disabled),
> and updated S-Curve sequencing now that Spine 3 delivery-% is landing.
>
> **Cross-references:**
> - `review/epc-gap-analysis.md` — deeper contractor/EPC-specific gap analysis (delivery backbone, billing, cost codes, subcontracts)
> - `docs/backlog.md` — living backlog with tracked deferrals (OD-* seams) and the UX-naturalness program history
> - `docs/specs/delivery-milestones.spec.md` — Spine 3 (delivery backbone) spec, currently in progress

## 1. Summary of Kanna Features

Kanna is marketed as a cloud-based project management platform designed for construction, real-estate and industrial projects.  Its features can be combined to address different businesses and include modules for visibility, scheduling, reporting, collaboration, security and AI.  Key features described on the site include:

### Real-Time Visibility

* **Project dashboard:** provides a centralized, real-time view of project progress, statuses and key details accessible to all stakeholders【186121258199527†L29-L39】.
* **Project calendar:** shows all ongoing and upcoming projects in a calendar view so teams stay on schedule【186121258199527†L43-L47】.
* **Project list:** lists projects in a filterable view to confirm site status, timelines and responsible persons【186121258199527†L52-L55】.
* **Company dashboard:** consolidates the entire project portfolio to track revenue, costs and progress across all projects【186121258199527†L79-L83】.

### Project Management and Scheduling

* **Task management:** assign tasks, set deadlines and track progress across projects【186121258199527†L61-L65】.  A second description emphasises creation, assignment and notifications to keep work moving on schedule【186121258199527†L113-L117】.
* **Project board:** drag-and-drop board to move projects across custom status columns that reflect workflow【186121258199527†L70-L75】【186121258199527†L131-L135】.
* **Gantt chart:** create and update schedules with drag-and-drop ease and automatic dependency updates, with cloud access for all stakeholders【186121258199527†L140-L145】.
* **Sub-project:** break large projects into sub-projects and control access for different teams or subcontractors【186121258199527†L104-L108】.
* **S-Curve (coming soon):** track planned versus actual progress over time【186121258199527†L95-L102】.

### Reporting and Documentation

* **Custom report:** build custom report templates with fields for text, numbers, signatures and timestamps【186121258199527†L156-L160】.
* **Reporting:** digitise daily site reporting with a mobile-first app that replaces paper and eliminates delays【186121258199527†L165-L169】.
* **Photo report:** create professional photo reports from saved images and export to PDF or Excel【186121258199527†L174-L179】.
* **Approval flow:** manage approvals and produce reports with ease【186121258199527†L183-L189】.

### Collaboration

* **Calendar (collaboration module):** shared calendar for real-time visibility of commitments【186121258199527†L200-L204】.
* **Photo & document management:** store, organise and share photos and documents in one secure place【186121258199527†L209-L213】.
* **In-house chat:** dedicated project chat to replace scattered emails and messaging apps and keep conversations organised【186121258199527†L227-L230】.

### Security & AI

* **Security:** enterprise-grade security with two-factor authentication, audit logs, device restrictions and IP address controls【186121258199527†L240-L247】.
* **AI assistance:** built-in AI surfaces project insights, automates routine tasks and assists decision-making【186121258199527†L254-L263】.
* **AI voice reporting:** hands-free voice input for site reporting【186121258199527†L269-L272】. Positioned as "Say it. Submit it. Done." — dictation auto-transcribes and populates report fields.

> **Correction (2026-06-11):** the §1 list above was drafted when S-Curve was marked "coming soon". KANNA's
> /features page now lists **S-Curve as shipped** (planned-vs-actual progress curve). Treat it as a live competitor
> feature, not roadmap.

### 1.6 Pricing, Packaging & Platform (added 2026-06-11, from /pricing + /features + Capterra)

Competitive context the feature list alone doesn't show — what KANNA monetizes and how it tiers:

| Plan | USD/user/mo | Min users | Storage | Key adds |
|---|---|---|---|---|
| Light | $19 | 3 | 100 GB | 1 project template, chat, photo/doc mgmt, standard report, import/export |
| Pro | $25 | 5 | 200 GB | 5 project templates + all Light |
| Pro Plus | $32 | 5 | 1,000 GB | custom reports, format settings, approval flow, **offline mode** |
| Enterprise | custom | 15 | — | 100 templates, company dashboard, backup, IP restriction, 2FA, device restrictions, AE support |

Packaging insights relevant to PMO:

* **Offline-first is a headline differentiator but gated to Pro Plus+** — KANNA charges a premium for field
  resilience (underground/remote sites, auto-sync on reconnect). It is not table stakes even for them.
* **Project templates are the plan-tier axis** (1 → 5 → 100). Template count is how KANNA segments SMB vs
  enterprise. PMO has no project-template concept at all (see gap #17).
* **"Unlimited users per project"** alongside per-user pricing ⇒ unlimited *guest/viewer* participants per
  project — the subcontractor/external-stakeholder hook (see gap #19).
* **Approval flow and custom reports are Pro Plus+ features** — PMO ships SoD-enforced approvals on every plan
  equivalent; this is a PMO strength to market, not just a parity item.
* **Platform:** web (Chrome recommended) + native iOS/Android apps; 99.99% uptime claim; ISO 27001 certified.
* **Languages:** Japanese, English, Spanish, Thai, Vietnamese — PMO is English-only (see gap #18).
* **Integrations (Capterra-listed, low confidence):** Gmail, Microsoft Excel, Outlook. Plus time/expense tracking
  and resource-availability checkbox features not promoted on the landing site.
* **Positioning/scale claims:** 70,000+ companies, 100+ countries, 155,000 projects, "80% cut in report-creation
  time", 90%+ CSAT. Persona pages target installation managers (solar/CCTV), construction/facilities managers.
  Notably, KANNA markets that **1 in 4 of its users is 50+** — the low-training field-worker UI is an explicit
  design constraint, not an accident.

## 2. Verified Features in the PMO Project Codebase

> **Updated 2026-06-11** — full inspection of `App.tsx` (routes), `pages/`, `hooks/`, `src/components/`, `supabase/migrations/`,
> and `docs/backlog.md`. The PMO portal is **production-deployed** (Supabase Cloud + Cloudflare Pages, live at
> `pmo-bfb.pages.dev`). Tech stack: React 19 + Vite 6 + TypeScript 5.8 + Supabase (Postgres/Auth/RLS/Storage) +
> TanStack Query + Recharts + Tailwind CSS 4.

### 2a. Pages & Routes (verified from `App.tsx`)

| Route | Page Component | Purpose |
|---|---|---|
| `/` | `ExecutiveDashboard` | Role-adaptive dashboard (exec margin dual-lens, finance ready-to-pay/variance, PM risk-sort, engineer) |
| `/projects` | `Projects` | Filterable project list with DataTable + Kanban view toggle |
| `/projects/:id` / `/:tab` | `ProjectDetail` | Unified detail: Overview / Budget / Procurement / Tasks / Documents tabs (ADR-0021) |
| `/sales` | `SalesPipeline` | Pre-win pipeline: Kanban board, weighted value, win-rate, aging, attention filter |
| `/procurement` | `ProcurementPage` | Procurement list |
| `/procurement/:id` | `ProcurementDetails` | Full procurement lifecycle: PR→VQ→PO→GR→VI with SoD approvals |
| `/timesheets` | `TimesheetsPage` | Weekly grid entry |
| `/approvals` | `ApprovalsPage` | Role-aware inbox: procurement approvals + timesheet approvals |
| `/companies` | `CompaniesPage` | Company register (name + type only) |
| `/incidents` | `IncidentsPage` | Incident/safety register |
| `/my-tasks` | `MyTasksPage` | IC-scoped cross-project task list |
| `/administration` | `AdminUsersPage` | User/role admin |
| `/reports` | `PlaceholderPage` | Stub (owner-deferred) |

### 2b. What PMO Has That Kanna Does NOT

These are PMO's unique strengths — Kanna lacks them entirely:

| Feature | Details |
|---|---|
| **Sales Pipeline with BvA & Win Rate** | Weighted pipeline value, dual win-rate RPCs, funnel chart, deal aging/attention (migration 0020). Kanna has no pre-win commercial pipeline. |
| **Budget Management** | Versioned budgets (one Active), 7 categories, committed-spend basis, portfolio variance ranking RPC (`get_finance_budget_review`), at-risk threshold. Kanna's "Company Dashboard" is less granular. |
| **Procurement Lifecycle (full P2P)** | Draft→PR→VQ→PO→GR→VI with SoD-enforced transitions (requester≠approver≠payer), line items, quotations, decision-support panel, evidence-first approval. Kanna's "Approval Flow" is generic by comparison. |
| **Timesheets & Timesheet Approval** | Weekly grid, line-manager approval, SoD, bulk approve. Kanna has no time tracking. |
| **Incident Tracking** | Safety/incident register with severity. Kanna has no HSE module. |
| **Role-Based Access (5 roles)** | Admin / Finance / PM / Engineer / Executive with RLS everywhere, org_id seam. Kanna mentions roles but no public detail. |
| **Impersonation** | Admin can impersonate other roles for debugging. |
| **Command Palette (⌘K)** | Global quick-nav + record search across projects/procurement/pipeline. |
| **Mobile-Responsive Shell** | Wave 4 shipped: DataTable table↔cards at 768px, focus-trap drawer, safe-area insets, touch targets. |

### 2c. What PMO Has That Overlaps with Kanna

| Kanna Feature | PMO Equivalent | Status |
|---|---|---|
| Project Dashboard | `ExecutiveDashboard` + role dashboards | ✅ PMO has this |
| Project List | `Projects` page with DataTable + filters | ✅ PMO has this |
| Project Board (Kanban) | `Kanban` component + `PipelineLens` on pipeline | ✅ PMO has this |
| Task Management | `TasksTab` per project + `MyTasksPage` + `task_dependencies` | ✅ PMO has this |
| Approval Flow | Procurement SoD + timesheet approval (migration 0007/0018) | ✅ PMO has this |
| Photo & Document Management | `DocumentsTab` (metadata register w/ SoD status workflow) | ⚠️ Partial — metadata only, no file upload (Storage disabled) |
| Lifecycle/Stage Management | `LifecycleStepper` + procurement stepper + project status | ✅ PMO has this |

### 2d. What PMO is Missing vs. Kanna

Confirmed absent from codebase (no files, routes, hooks, or migrations):

* **Project Calendar View** — no calendar component or route
* **Gantt Chart** — no scheduling/timeline component; `task_dependencies` table exists but is never consumed
* **In-House Chat** — no chat/messaging files anywhere
* **Custom Report Builder** — `/reports` is a placeholder; no template engine
* **Photo Reports** — no photo capture/report generation; Storage disabled
* **Sub-Projects** — no hierarchical project structure
* **S-Curve** — no planned-vs-actual progress over time chart
* **Offline / PWA** — no service worker or IndexedDB
* **Bulk Import/Export** — no Excel/CSV import/export
* **AI Assistance / AI Voice Reporting** — no AI integration
* **Mobile App (native)** — responsive web only, no Capacitor/PWA wrapper
* **2FA / Device Restrictions / IP Controls** — Supabase Auth handles basics; no enterprise security controls
* **CRM Contacts / Activity Log** — `companies` table has name+type only; no contacts, no activity timeline, no follow-up loop
* **Shared Calendar** — no calendar component
* **Customizable Forms** — no form builder; forms are hard-coded per entity

## 3. Gap Analysis and Improvement Opportunities

> **Updated 2026-06-11.** PMO status column now reflects verified codebase state (not inference). Rows that were
> previously marked as gaps but are actually implemented have been corrected.

### 3a. Features PMO Already Has (No Gap)

| Kanna Feature | PMO Status | Notes |
|---|---|---|
| Project Dashboard | ✅ Implemented | `ExecutiveDashboard` + role-specific dashboards (PM, Finance, Engineer) with KPI tiles, drill-through, at-risk alerts |
| Project List (filterable) | ✅ Implemented | `Projects` page with DataTable, column filters, sort |
| Project Board (Kanban) | ✅ Implemented | `Kanban` component on Sales Pipeline; `PipelineLens` for deal progression; drag-and-drop stage columns |
| Task Management | ✅ Implemented | `TasksTab` per project (assignee, dates, status, dependencies) + `/my-tasks` IC cross-project view |
| Approval Flow | ✅ Implemented | Full procurement SoD approval (requester≠approver≠payer, migration 0018) + timesheet approval (migration 0007) + `/approvals` role-aware inbox |
| Lifecycle/Stage Management | ✅ Implemented | `LifecycleStepper`, procurement stepper, project status machine with transitions |
| Mobile-Responsive UI | ✅ Implemented | Wave 4 shipped: DataTable table↔cards, focus-trap drawer, safe-area insets, touch targets ≥44px |
| Role-Based Access Control | ✅ Implemented | 5 roles (Admin/Finance/PM/Engineer/Executive), RLS on every table, org_id seam, FE-view-gating |

### 3b. Genuine Gaps (PMO Missing vs. Kanna)

| # | Kanna Feature | PMO Status | Delta | Priority | Recommendation |
|---|---|---|---|---|---|
| 1 | **In-House Chat** | ❌ Absent | M | **High** | Project-scoped real-time chat. Best fit: `@chatscope/chat-ui-kit-react` (MIT) + Supabase Realtime (already in stack). See §4. |
| 2 | **Gantt Chart** | ❌ Absent (`task_dependencies` table exists but unconsumed) | L | **High** | Integrate a Gantt library. The existing `task_dependencies` migration makes this structurally ready. Libraries: `@syncfusion/ej2-react-gantt`, `frappe-gantt`, or `dhtmlxGantt`. |
| 3 | **Project Calendar View** | ❌ Absent | M | **High** | Add a calendar view to `Projects` (toggle alongside table/kanban). Libraries: `@fullcalendar/react` or `react-big-calendar`. |
| 4 | **Bulk Import/Export (Excel)** | ❌ Absent | S | **High** | Add `xlsx` library; export any DataTable view to Excel; import wizard for projects/companies/tasks. Low effort, high value for enterprise adoption. |
| 5 | **Photo & Document Storage** | ⚠️ Partial | M | **Medium** | `DocumentsTab` has metadata + SoD status workflow; **blocked on Supabase Storage re-enable** (tracked in backlog). Add file upload + preview + photo reports after Storage is on. |
| 6 | **Custom Report Builder** | ❌ Absent (`/reports` is placeholder) | L | **Medium** | Template-based reports with controlled inputs, signatures, PDF/Excel export. Kanna's most praised feature per testimonials. |
| 7 | **Sub-Projects** | ❌ Absent | M | **Medium** | Hierarchical project structure for subcontractor/team scoping. Requires `projects.parent_id` + access control. |
| 8 | **S-Curve / Planned vs Actual** | ❌ Absent | M | **Medium→High** | *(Updated 2026-06-11)* KANNA ships this now (no longer "coming soon"). With Spine 3 delivery-% landing, the only missing piece is a **delivery-% snapshot table over time** (on-write or scheduled) + a Recharts line vs milestone target dates. Does **not** require Gantt — natural fast-follow to the `delivery-milestones` branch. |
| 9 | **CRM: Contacts & Activity Log** | ❌ Absent | S/M | **Medium** | `companies` = name+type only. Need: `contacts` table, `activities` polymorphic log, follow-up loop. See EPC gap #6. |
| 10 | **Shared Calendar (collaboration)** | ❌ Absent | M | **Medium** | Overlaps with #3; same calendar component can serve both project-list and shared-team views. |
| 11 | **Offline / PWA** | ❌ Absent | M | **Low** | Service worker + IndexedDB for field use. Kanna highlights this heavily for construction. Consider Capacitor for app-store presence too. |
| 12 | **AI Assistance** | ❌ Absent | M | **Low** | Start with basic: project summary AI, anomaly detection on budget/timeline. Can use OpenAI/Anthropic APIs. |
| 13 | **AI Voice Reporting** | ❌ Absent | M | **Low** | Whisper API for transcription + form auto-fill. Niche but impressive demo feature. |
| 14 | **2FA / Device Restrictions / IP Controls** | ⚠️ Basic only | M | **Low** | Supabase Auth provides auth; enterprise controls (IP whitelist, device management, 2FA enforcement) are absent. *(2026-06-11)* Split out the **audit log**: KANNA bundles it here as an Enterprise-plan item, but PMO needs an append-only `audit_events` table (+ triggers on transitions) for compliance posture regardless — cheap, and PMO only has scattered stamps (`approved_by`, `decided_at`, `vendor_invoiced_at`) today. Supabase MFA is nearly free when wanted. |
| 15 | **Customizable Workflows (user-configurable)** | ⚠️ Partial | L | **Low** | Stages/statuses are developer-configured. Kanna lets users define their own. The backlog's OD-PROC-6 admin config engine partially addresses this. |
| 16 | **Mobile App (native)** | ❌ Absent | M | **Low** | Responsive web only. Capacitor wrapper for iOS/Android app-store presence. |
| 17 | **Project Templates** *(added 2026-06-11)* | ❌ Absent | M | **Medium** | KANNA's plan-tier axis (1/5/100 templates per plan) — templates = pre-defined milestone/task/folder structures cloned at project creation. PMO creates every project from scratch. With milestones landed, a "create project from template" (template = named milestone+task set) is a natural, monetizable extension; pairs with the OD-PROC-6 org-config seam. |
| 18 | **i18n / Multi-language** *(added 2026-06-11)* | ❌ Absent | M | **Low** | KANNA ships JA/EN/ES/TH/VN. PMO is hard-coded English, no i18n framework. Only matters when target market does — but retrofitting strings later is costlier than seeding `react-i18next` early on new surfaces. |
| 19 | **Guest / External Subcontractor Access** *(added 2026-06-11)* | ❌ Absent | L | **Medium** | KANNA's pricing hook: "unlimited users per project" = unlimited guest participants. PMO's 5 roles are all internal; no project-scoped external role. Significant RLS work (project-scoped, not org-scoped, read grants); belongs with the OD-PROC-6 RBAC config engine track and overlaps gap #7 (Sub-Projects). |

### 3c. Additional Gaps Found in EPC Analysis (not Kanna-specific, but contractor-oriented)

These come from `review/epc-gap-analysis.md` and represent gaps that Kanna partially addresses (especially for
field/contractor use-cases) but that the Kanna landing page doesn't prominently feature:

| # | Gap | Kanna Coverage | PMO Status | EPC Priority |
|---|---|---|---|---|
| A | **Execution Phases / Stage-Gates** | Implicit in custom workflows | ❌ Absent (Spine 3 = milestones, not gates) | T1 (highest) |
| B | **Progress Billing / AR** | Not prominent | ❌ Absent (AP-complete, AR-absent) | T2 |
| C | **Change Orders / Variations** | Not prominent | ❌ Absent | T2 |
| D | **Cost Codes (vs 7 fixed categories)** | Not prominent | ❌ Locked 7 categories (OD-BUDGET-4 seam exists) | T3 |
| E | **Field Daily Logs / Site Reports** | ✅ "Reporting" module | ❌ Absent (can fake via incidents) | T5 |
| F | **RFI / Submittal Workflows** | Not prominent | ❌ Absent (DocumentsTab SoD is 70% there) | T5 |
| G | **Subcontract Management** | Not prominent | ❌ Absent (workaround: vendor company + procurement) | Later |
| H | **Resource Planning / Capacity** | Not prominent | ❌ Absent (static `profiles.utilization`) | Later |
| I | **Earned Value / Progress Analytics** | S-Curve (coming soon) | ❌ Absent (blocked on A+B+D) | Later |

### 3d. Observations on User Experience

Kanna's landing page emphasises simplicity and accessibility (mobile‑friendly, works offline) and clearly
communicates benefits such as eliminating scattered emails and chats. As of 2026-06-11, PMO has shipped its
UX-naturalness program (Waves 1–6, PRs #36–#65) including mobile responsiveness — so several prior gaps are closed:

* ✅ **Mobile-friendly views** — Wave 4 shipped: DataTable table↔cards, focus-trap drawer, safe-area insets.
* ✅ **Role-adaptive navigation** — Wave 2: RBAC view-gating, role-shaped nav, Engineer "My Projects".
* ✅ **Command palette (⌘K)** — global quick-nav + record search.

Remaining UX gaps vs. Kanna:

* **In-app notifications / activity feed** — no notification bell or activity stream. Kanna's chat implicitly provides this.
* **Onboarding polish** — no first-run experience, tooltips, or product tour. Kanna's marketing emphasises "anyone can pick up quickly".
* **Offline capability** — PMO requires connectivity; Kanna works offline (critical for field/construction).

## 4. Chat Feature: Kanna and Open‑Source Options

Kanna includes an **in‑house chat** feature that replaces email threads and group chats; it keeps project conversations organised and on record【186121258199527†L227‑L230】.  From Kanna's /features page:

> *"Replace scattered emails and messaging apps with one dedicated project chat that keeps every conversation organised and on record."*

The chat is **project-scoped** (channels tied to projects), **persistent** (audit trail), and replaces external tools
like WhatsApp/Telegram for project communication.

### 4a. Recommended: Chatscope Chat UI Kit + Supabase Realtime (MIT)

**This is the best fit for the PMO stack.** Rationale:

1. **`@chatscope/chat-ui-kit-react`** (~1.4k GitHub stars, MIT) — polished React chat components: message list, input,
   typing indicator, conversation sidebar, read receipts. You bring your own backend.
2. **Supabase Realtime** (already in the PMO stack via `@supabase/supabase-js`) — provides WebSocket-based pub/sub.
   No new infrastructure needed. Subscribe to `chat_messages` via `supabase.channel().on('postgres_changes', ...)`.
3. **Supabase Storage** (currently **disabled** — sandbox health-check issue, re-enable tracked in backlog) — once
   re-enabled with private org-pathed buckets, handles file/attachment uploads in chat messages.
4. **RLS enforcement** — users only see channels for their projects; no cross-org leak.

#### Proposed Schema

```sql
-- Per-project chat channels
CREATE TABLE chat_channels (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id  uuid NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  name        text NOT NULL,
  type        text NOT NULL DEFAULT 'project' CHECK (type IN ('project','team','direct')),
  created_by  uuid REFERENCES auth.users(id),
  created_at  timestamptz DEFAULT now(),
  org_id      uuid NOT NULL  -- tenancy seam
);

-- Messages within channels
CREATE TABLE chat_messages (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  channel_id  uuid NOT NULL REFERENCES chat_channels(id) ON DELETE CASCADE,
  sender_id   uuid NOT NULL REFERENCES auth.users(id),
  content     text NOT NULL,
  attachments jsonb,  -- [{storage_path, filename, content_type}]
  created_at  timestamptz DEFAULT now(),
  org_id      uuid NOT NULL
);

-- Read receipts
CREATE TABLE chat_read_receipts (
  user_id     uuid NOT NULL REFERENCES auth.users(id),
  channel_id  uuid NOT NULL REFERENCES chat_channels(id),
  last_read_at timestamptz DEFAULT now(),
  PRIMARY KEY (user_id, channel_id)
);
```

#### Estimated Effort

| Phase | Scope | Sprint |
|---|---|---|
| Schema + RLS + Realtime | `chat_channels`, `chat_messages`, `chat_read_receipts` + RLS policies + Realtime channel wiring | 1 |
| Chat UI | Chatscope components, channel list, message thread, input | 1–2 |
| Integration | New "Chat" tab on ProjectDetail, add to Rail nav | 1 |
| Attachments | Supabase Storage upload + inline previews | 1 |
| Polish | Unread badges, notifications, message search | 1 |
| **Total** | | **~4–5 sprints** |

### 4b. MUI X Chat (MIT‑licensed) — ⚠️ Not Recommended for PMO

The **MUI X Chat** library provides a fully styled chat interface for React applications【757623580632470†L204‑L222】. MIT licensed【757623580632470†L228‑L236】.

**Why it's NOT a good fit for PMO:**

1. **Wrong interaction model.** MUI X Chat is designed for AI/LLM chatbot interfaces — one user talking to a bot with token-by-token streaming responses. PMO needs multi-user team messaging (channels, typing indicators from humans, read receipts, online presence). These concepts don't exist in MUI X Chat.

2. **Conflicts with the design system.** PMO uses Tailwind CSS 4 with custom semantic tokens (`DESIGN.md`). MUI X Chat requires **Material UI** as a peer dependency (ThemeProvider, emotion/styled-engine). Adding MUI would introduce a second, conflicting design system — every PMO component (Button, Card, DataTable) is Tailwind; the chat would look foreign.

3. **No path to native Supabase Realtime.** While technically you can wire any transport, MUI X Chat's streaming model assumes a single SSE/WebSocket response stream, not the multi-participant pub/sub pattern Supabase Realtime provides.

**When it WOULD be the right choice:** if PMO later adds an AI assistant feature ("Ask about your project") where a single user chats with an LLM. That's a different feature from Kanna's In-House Chat.

### 4c. Rocket.Chat (open‑source platform)

**Rocket.Chat** is a mature messaging platform that offers on‑premises or self‑hosted deployments.  Available under MIT license【835021697662496†L345‑L455】.  Provides messaging, voice, video, file sharing and extensive APIs.  However, it is a complete platform rather than a simple component, so integration into PMO may require running it as a separate service and embedding its client via iframes or SDKs.  **Heavy but complete** — consider only if a standalone chat server is desired.

### 4d. Additional Options

| Library | License | React? | Notes |
|---|---|---|---|
| `react-chat-ui` | MIT | ✅ | Lightweight, simple. Good starting point but may not be actively maintained. |
| TalkJS | Proprietary (paid) | ✅ | Chat-as-a-service. Not open-source — listed for awareness only. |
| Stream Chat React | MIT (SDK) | ✅ | Full-featured but requires Stream's backend service (vendor lock-in). |

## 5. Recommendations

### 5a. Tiered Priority (Kanna-specific gaps)

Updated to reflect verified PMO state. Items already implemented are removed.

> **Second-pass sequencing note (2026-06-11):**
> 1. **Storage re-enable is the highest-leverage single unlock** — it gates document/photo upload (#5), photo
>    reports (#12), report-builder attachments (#6), and chat attachments (#1). Consider promoting it ahead of Chat.
> 2. **S-Curve + Gantt should ride the `delivery-milestones` branch landing** — milestone/task data is now real;
>    S-Curve needs only a delivery-% snapshot table (see updated gap #8), Gantt only a timeline view over existing
>    `tasks` dates + the unconsumed `task_dependencies` table.
> 3. **Don't only chase parity — exploit asymmetry.** KANNA has no pre-win pipeline, no AR/progress billing, no
>    versioned budgets, no P2P SoD. Spine 4 (Revenue/AR) ties directly into the milestones just built
>    (progress billing per milestone) and is a differentiation play KANNA cannot match today.

**Tier 1 — High Impact, Feasible for Next Quarter**

| # | Feature | Why | Effort | Dependency |
|---|---|---|---|---|
| 1 | **In-House Chat** | Kanna's key collaboration differentiator; keeps team in-app. Best fit: Chatscope + Supabase Realtime (§4a). | 4–5 sprints | None |
| 2 | **Gantt Chart** | Every PM tool has one; `task_dependencies` table is structurally ready. | 2–3 sprints | Spine 3 milestones (in progress) |
| 3 | **Project Calendar View** | Kanna's #2 visibility feature. Reuses existing project date data. | 1–2 sprints | None |
| 4 | **Bulk Import/Export** | Enterprise adoption blocker. `xlsx` library + export from any DataTable. | 1 sprint | None |

**Tier 2 — Strong Differentiators**

| # | Feature | Why | Effort | Dependency |
|---|---|---|---|---|
| 5 | **Document File Upload** (re-enable Storage) | Already tracked in backlog; unlocks photo reports, chat attachments, daily logs. | 1–2 sprints | Supabase Storage config |
| 6 | **Custom Report Builder** | Kanna's most praised feature per testimonials. | 3–4 sprints | Storage (#5) |
| 7 | **Sub-Projects** | Hierarchical project breakdown for subcontractors. | 2 sprints | None |
| 8 | **CRM: Contacts + Activity Log** | `companies` is name-only; pipeline aging detects neglect but no remedy loop. | 2 sprints | None |
| 9 | **S-Curve / Planned vs Actual** | Standard contractor health metric. | 1–2 sprints | Gantt (#2) + Spine 3 |

**Tier 3 — Nice to Have**

| # | Feature | Why | Effort | Dependency |
|---|---|---|---|---|
| 10 | **Offline / PWA** | Field/construction use case. | 2–3 sprints | Service worker architecture |
| 11 | **AI Assistance (basic)** | Industry trend; even simple summarization differentiates. | 1–2 sprints | LLM API integration |
| 12 | **Photo Reports** | Construction/field vertical need. | 2 sprints | Storage (#5) |
| 13 | **Mobile App (native)** | App-store presence via Capacitor wrapper. | 1 sprint | PWA (#10) recommended first |
| 14 | **AI Voice Reporting** | Impressive demo feature. | 1–2 sprints | AI Assistance (#11) |
| 15 | **Enterprise Security** (2FA, IP, device) | Enterprise client requirement. | 2 sprints | Supabase Auth configuration |
| 16 | **User-configurable Workflows** | Kanna's "fully customisable" selling point. | 3–4 sprints | OD-PROC-6 admin config engine |

### 5b. Relationship to EPC Gap Analysis

The EPC gap analysis (`review/epc-gap-analysis.md`) addresses a different axis — not "what Kanna has that PMO doesn't"
but "what a project contractor needs that PMO doesn't have". There is significant overlap:

| EPC T-Priority | EPC Gap | Overlaps with Kanna Gap # |
|---|---|---|
| T1 (Delivery backbone) | Execution phases + WBS/% complete + schedule view | Kanna #2 (Gantt), #8 (S-Curve) |
| T2 (Revenue side) | Progress billing + retention + change orders | Not a Kanna gap (Kanna doesn't feature AR) |
| T3 (Cost codes) | Cost-code granularity + actuals rollup | Not a Kanna gap |
| T4 (CRM) | Contacts + activity timeline + follow-ups | Kanna #9 (CRM) |
| T5 (Field ops) | Daily logs + RFI/submittals | Kanna #5 (Photo/Docs), #6 (Custom Reports) |

**Recommendation:** sequence T1 delivery backbone (already in progress as Spine 3: `delivery-milestones` branch)
first, then pursue Tier 1 Kanna gaps (Chat, Gantt, Calendar, Import/Export) in parallel with T2/T3/T4.

### 5c. General Principles

1. **Build on existing seams.** The backlog's OD-* seams (OD-BUDGET-2/4, OD-PROC-6, OD-MARGIN-2) are already designed for extensibility. Go through them, not around them.
2. **Don't re-litigate settled decisions.** Model B (ADR-0020/0021), 7-category lock (OD-BUDGET-4), flat roles (OD-PROC-6) — these have owner decisions. Enrich within those constraints.
3. **Leverage Supabase for new features.** Chat → Realtime. File uploads → Storage. Search → pg_trgm. Offline → Supabase's offline-first patterns.
4. **Maintain the quality gates.** ≥80% coverage, typecheck/lint zero errors, one PR per issue, RLS on every new table.

By closing these gaps and adopting an MIT‑licensed chat component, the PMO project can move closer to feature parity with Kanna while maintaining full control over its codebase and user experience.
