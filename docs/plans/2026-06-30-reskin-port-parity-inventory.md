# Reskin Port — Feature/Widget Parity Inventory ("nothing left behind")

> **Why this exists (owner concern, 2026-06-30):** the reskin mockups are a *design language*
> demonstrated on 3 representative surfaces (Projects, a record, Approvals). They are **not** a
> feature spec, and several real widgets (S-curve, the vertical procurement-history timeline, Gantt,
> Kanban, the chart family, the role dashboards) were never exercised. This inventory enumerates the
> **whole current app** so the port preserves every widget, chart, and action.

## Binding port method — reskin-IN-PLACE, not rebuild-from-mockups
- **Re-tone the EXISTING `pages/` + `components/`** to the new design system (tokens + the
  monochrome-calm aesthetic). Keep all current logic, data, charts, and actions. The mockups define
  *how it looks*; **the codebase defines what exists.** Porting "from the mockups" is forbidden — it
  drops everything not mocked.
- **Parity gate (Director-enforced):** a surface is "ported" only when **every row below for that
  surface** has a reskinned, AA-verified home (light + dark). No route, widget, chart, or action may
  silently disappear. A reskin PR that removes a feature must call it out explicitly with owner sign-off.

## Legend
- ✅ = a reskin treatment is already demonstrated in the mockups (reuse it)
- ⚠️ = a **distinct widget type with NO reskin treatment yet** — must be designed during the port
- All surfaces also need their **mobile** variant reskinned (the app is mobile-gated in prod).

---

## A. Shell & cross-cutting (every screen)
| Element | Source | Treatment |
|---|---|---|
| Grouped rail + collapse | `components/shell/Rail`, `AppShell` | ✅ |
| Top bar: breadcrumb · ⌘K search · user chip | `shell/Breadcrumb`, `ContextBar`, `CommandPalette` | ✅ rail/topbar; ⚠️ **command palette** styling |
| Impersonation banner · EnvBadge · GateNotice · AccessDenied | `auth/ImpersonationBanner`, `components/EnvBadge`, `ui/GateNotice`, `ui/AccessDenied` | ⚠️ banners/notices |
| Toasts | `ui/Toast` | ⚠️ |
| View-toggle (table · cards · kanban · calendar) | `ui/ViewToggle`, `hooks/viewStorage` | ✅ table/board; ⚠️ **kanban**, **calendar** modes |
| Login / auth | `auth/LoginPage` | ✅ (login mocked in earlier round) |

## B. Dashboards — role-based home `/` (⚠️ none reskinned yet)
| Surface | Widgets | Treatment |
|---|---|---|
| Executive | `ExecutiveDashboard` + KPI tiles, `BvACard`, `WinRateCard`, `ProjectedMarginBars`, `StatusBarChart`, `AwaitingApprovalTile` | ✅ KPI tiles; ⚠️ **BvA bars**, **win-rate**, **margin bars**, **status bar chart** |
| PM | `PMDashboard` | ⚠️ |
| Finance | `FinanceDashboard` | ⚠️ |
| Engineer | `EngineerDashboard` | ⚠️ |
| Mobile Exec | `MobileExecutiveDashboard` | ⚠️ mobile dashboard |

## C. Projects
| Surface | Widgets / features | Treatment |
|---|---|---|
| Projects list `/projects` | table · **cards** · **kanban** · **calendar** views; filters; Export; Import; New project | ✅ table + board(kanban-ish); ⚠️ **calendar view**, **cards view**, **import wizard** |
| Project detail `/projects/:id/:tab` | `ProjectDetailHeader`, `MilestoneStrip`, `PipelineLens`, tabs ↓ | ✅ record header/tabs/sidebar |
| · Overview tab | `tabs/OverviewTab` | ✅ |
| · **Budget tab** | `ProjectBudget`, `BvACard` (Budget vs Actual) | ⚠️ **BvA chart**, budget table |
| · Procurement tab | `tabs/ProcurementTab` | ✅ mini-table |
| · Tasks tab | `tabs/TasksTab` + **`ProjectGantt`** | ⚠️ **Gantt timeline** (sticky col + bars) |
| · Documents tab | `tabs/DocumentsTab`, file cells/upload | ⚠️ **document/file rows + upload** |
| · **S-curve** | `ProjectSCurve`, `lib/delivery/sCurve` (planned vs actual line) | ⚠️ **S-curve line chart** |
| · Milestone strip / stepper | `MilestoneStrip`, `MilestoneFormModal`, `ui/LifecycleStepper` | ✅ stepper |

## D. Sales
| Surface | Widgets | Treatment |
|---|---|---|
| Sales pipeline `/sales` | `SalesPipeline` + **`ui/Funnel`** + pipeline/kanban view | ⚠️ **funnel chart**, pipeline board |
| Opportunity detail `/sales/:id` | record + `PipelineLens` | ✅ record; ⚠️ pipeline lens |

## E. Procurement
| Surface | Widgets / features | Treatment |
|---|---|---|
| Procurement list `/procurement` | `Procurement`, `ProcurementListRow`, filters, **procurement-cycle import wizard** | ✅ table; ⚠️ import wizard |
| Procurement detail `/procurement/:id/:tab` | `ProcurementDetails` + lifecycle bar-stepper | ✅ stepper/record |
| · Overview | `ProcurementOverviewTab` | ✅ |
| · Vendor quotes | `VendorQuotesTab` | ✅ table |
| · Line items | `LineItemsSection` | ✅ table |
| · Decision zone | `ProcurementDecisionZone`, `DecisionSupportPanel` | ⚠️ decision panel |
| · **Vertical history** | **`ProcurementProgressionTimeline`**, `lib/db/procurementHistory` | ⚠️ **vertical progression timeline** (the one you named) |
| · Ledger / files | `ProcurementLedger`, `LedgerCaptureRow`, `ProcurementFilesSubsection`, `LedgerFileCell` | ⚠️ ledger rows + file cells |
| · Capture / new | `RecordCaptureForm`, `NewProcurementModal`, `ProcurementHeaderEdit` | ⚠️ **forms / capture / modal** |

## F. Timesheets & Approvals
| Surface | Widgets | Treatment |
|---|---|---|
| Timesheets `/timesheets` | `Timesheets`, **`ui/TimesheetGrid`**, **`ui/HoursBar`** | ⚠️ **timesheet grid**, **hours bar** |
| Timesheet approvals | `timesheets/ApprovalsQueue` | ✅ two-pane triage |
| Approvals `/approvals` | `Approvals`, `ProcurementApprovalSection/Row` (preview-in-place) | ✅ two-pane triage |

## G. CRM, Incidents, Tasks, Reports, Admin
| Surface | Widgets / features | Treatment |
|---|---|---|
| Companies `/companies` + detail | list; `CompanyDetail` related objects (projects/procurement/contacts/activity) | ✅ table/record; ⚠️ **related-objects panels**, **activity log** |
| Contacts `/contacts` + detail | list; `ContactDetail` + activity log | ✅ table/record; ⚠️ activity log |
| Incidents `/incidents` + detail | list + detail | ✅ table/record |
| My Tasks `/my-tasks` | urgency-ordered list + log-time action | ⚠️ **task list + inline log-time** |
| Reports `/reports` | reports module (currently placeholder) | ⚠️ |
| Administration `/administration` | `AdminUsers` (RBAC config) | ✅ table/forms; ⚠️ role editor |

## H. Distinct widget TYPES still needing a monochrome-calm treatment (the design-system gap list)
Each must get a defined token-based treatment (light+dark, AA) before its surface ports:
1. **Charts (recharts)** — themed via `ui/chartTheme`, `dashboard/chartChrome`: S-curve line · BvA bars ·
   ProjectedMargin bars · StatusBar bars · WinRate. *Monochrome-calm chart theme is its own design task*
   (restrained palette, status-tinted fills, quiet axes/grid).
2. **Gantt** timeline (sticky column + bars). 3. **Vertical progression timeline** (procurement history).
4. **Funnel** (sales). 5. **Calendar / month grid.** 6. **Kanban** (distinct from the board mock).
7. **Cards view.** 8. **Timesheet grid + HoursBar.** 9. **Forms** — `EntityFormModal`, `FormFields`,
   `Combobox`, capture forms, role editor. 10. **Modals / Drawer / ConfirmDialog / mobile bottom-sheet.**
11. **Import wizard** (multi-step). 12. **Command palette.** 13. **Banners/notices/toasts.**
14. **Document/file rows + upload.** 15. **Activity log / related-objects panels.**
16. **All mobile variants** (the prod mobile gate).

---

## How we use this
- The reskin LANGUAGE (mockups) is proven for the records family (✅ rows). The ⚠️ rows are the real
  remaining **design** work — most importantly the **chart theme**, **Gantt**, **S-curve**, and the
  **vertical history timeline** you flagged.
- During the build, each surface's reskin PR checks its rows here; the Director verifies **no ✅/⚠️ row
  was dropped** before merge. This file is the parity source of truth.

## Extension round log

### Round 1 — chart/timeline widget treatments (pi + glm-5.2, 2026-07-01) → these ⚠️ now have a proven monochrome-calm treatment
Built as mockups under `docs/design-mockups/redesign/reskin/ext/` (light + dark, tokens-only, AA), Director-verified (render + purity):
- **`ext/dashboard.html`** — the whole **chart family**: KPI strip · Budget-vs-Actual bars · Win-rate gauge · Projected-margin bars · Procurement-by-status bars (§B dashboards, §H#1 charts). Locks the monochrome-calm chart theme: quiet neutral axes/grid, status-tinted or single-accent series (no rainbow).
- **`ext/delivery.html`** — **S-curve** (planned vs actual two-line) + **Gantt** (sticky column + status-tinted bars, one scroll) (§C, §H#2).
- **`ext/procurement-and-funnel.html`** — the **vertical procurement-history timeline** (§E, §H#3) + the **sales funnel** (§D, §H#4).

### Still ⚠️ (future extension rounds, before their surfaces port)
Calendar view · Kanban view (vs the board mock) · cards view · **timesheet grid + HoursBar** · **forms/modals/ConfirmDialog/mobile bottom-sheet** · **import wizard** · command palette · banners/notices/toasts · document/file rows + upload · activity log / related-objects panels · **all mobile variants** · the 4 non-exec role dashboards (PM/Finance/Engineer/Mobile).
