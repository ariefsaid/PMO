# UX area map

Execution order follows OD-VISUAL-RESET / #806. Routes are inventoried from `pmo-portal/App.tsx` at this branch's base; page bodies resolve role variants and record/capture distinctions. This is a map of current homes, not a claim of UX-standard compliance or a proposal to remove features. ADR-0068 tokens remain unchanged.

One type describes the route's main job; embedded forms, tables and review panels retain their surrounding record/settings context. `:parameter` denotes a route parameter. Feature-controlled routes remain in scope whenever enabled. Order numbers group whole areas, not individual component slices.

| Area | Routes | Page type per route | User's job in one clause | Order |
|---|---|---|---|---|
| Shell + navigation | `/*` authenticated shell wrapping the routes below | Shared frame, not a standalone page | PM/Finance/Admin/Executive locate their work and return with context | 1 |
| Projects list | `/projects` | collection | PM finds the project needing attention | 2 |
| Project creation | `/projects/new` | capture | PM records a project once with its business context | 2 |
| Project detail | `/projects/:projectId`; `/projects/:projectId/:tab` | record for both | PM/Finance understand a project's position and act in context | 3 |
| Executive dashboard | `/` for Executive/Admin | dashboard | Executive identifies portfolio decisions needing attention | 4 |
| Finance dashboard | `/` for Finance | dashboard | Finance prioritizes billing, spending and collection work | 4 |
| PM dashboard | `/` for Project Manager | dashboard | PM prioritizes delivery risks and pending work | 4 |
| Sales pipeline | `/sales` | collection | PM/Executive progress opportunities toward a signed contract | 5 |
| Sales record compatibility link | `/sales/:opportunityId` → `/projects/:projectId` | redirect → record | PM opens the same project from the pipeline | 5 |
| Sales invoices | `/sales-invoices`; `/sales-invoices/:invoiceId` | collection; record, respectively | Finance raises invoices and follows their outstanding balances | 6 |
| Incoming payments | `/incoming-payments`; `/incoming-payments/:receiptId` | collection; record, respectively | Finance records receipts against the right invoice | 6 |
| Revenue by project | `/revenue-by-project` | dashboard | Finance compares project revenue and billing position | 6 |
| ERP purchases | `/erp-purchases` | collection | Finance finds purchase evidence and its project attribution | 6 |
| Financial statements | `/financial-statements` | record (selected statement and period) | Finance reads and compares the selected financial statement | 6 |
| Management pack | `/reports` | dashboard | Executive reviews a period's consolidated project and financial position | 6 |
| Procurement list | `/procurement` | collection | PM/Finance find the purchase case requiring action | 6 |
| Procurement creation | `/procurement/new` | capture | PM prepares a purchase request with project and line items | 6 |
| Procurement detail | `/procurement/:procurementId`; `/procurement/:procurementId/:tab` | record for both | PM/Finance advance a purchase case with its supporting evidence | 6 |
| Expense claims | `/expenses`; `/expenses/new`; `/expenses/:claimId` | collection; capture; record, respectively | PM/Finance submit and settle project expenses or advances | 6 |
| Administration entry | `/administration` | redirect → settings | Admin/Finance reach the appropriate configuration section | 7 |
| People administration | `/administration/users` | settings | Admin manages workspace membership and roles | 7 |
| Organization integrations | `/administration/integrations` | settings | Admin configures shared business tools and resolves exceptions | 7 |
| Accounting configuration | `/administration/accounting` | settings | Finance/Admin maintain accounting mappings used by project work | 7 |
| Project configuration | `/administration/projects` | settings | Admin maintains project numbering conventions | 7 |
| Credits | `/administration/credits` | settings | Authorized administrator manages available Assistant credits | 7 |
| Exchange rates | `/administration/exchange-rates` | settings | Finance maintains rates for consistent currency conversion | 7 |
| Cost attribution | `/administration/cost-attribution` | settings | Finance assigns costs to the appropriate project basis | 7 |
| Usage | `/administration/usage` | settings (usage inspection) | Authorized administrator inspects workspace consumption | 7 |
| Features | `/administration/features` | settings | Authorized administrator manages available workspace capabilities | 7 |
| Administration fallback | `/administration/:section` | settings fallback → Users | Admin recovers from an obsolete section link | 7 |
| Personal integrations | `/integrations` | settings | PM/Finance connect their own external work account | 7 |
| Approvals | `/approvals` | review queue | PM/Finance decide requests with sufficient evidence | 8 |
| Timesheets | `/timesheets` | capture | PM/staff enter project hours for the selected week | 8 |
| My tasks | `/my-tasks` | collection | PM/Finance/staff find and complete their assigned work | 8 |
| Meetings | `/meetings`; `/meetings/new`; `/meetings/:meetingId` | collection; capture; record, respectively | PM records decisions and follows meeting actions | 8 |
| Companies | `/companies`; `/companies/:companyId` | collection; record, respectively | PM/Finance find customer or vendor context | 8 |
| Contacts | `/contacts`; `/contacts/:contactId` | collection; record, respectively | PM finds the right business contact for project work | 8 |
| Incidents | `/incidents`; `/incidents/:incidentId` | collection; record, respectively | PM records and follows delivery incidents | 8 |
| Staff dashboard | `/` for Engineer | dashboard | Staff prioritize assigned delivery work | 8 |
| Saved views | `/views`; `/views/:viewId` | collection; dashboard, respectively | PM/Finance/Executive reopen a saved view of their work | 8 |
| View builder | `/views/new`; `/views/:viewId/edit` | capture for both | PM/Finance/Executive compose a reusable view | 8 |
| Profile and preferences | `/settings/profile` | settings | User sets their interface language and preferences | 8 |
| Workspace entry and recovery | `/login`; `/reset-password`; `/update-password` | sign-in for each | User enters the workspace or recovers access | 8 |
| Application consent | `/oauth/consent` | sign-in (application authorization step) | User accepts or declines an application's sign-in request | 8 |
| Public legal reading | `/terms`; `/privacy` | **UNCLASSIFIED**: reading pages outside the seven operational types | User reads the terms and privacy information | 8 |
| Unknown URL | `*` | **UNCLASSIFIED**: recovery state outside the seven operational types | User returns to a known page after an invalid link | 8 |

Project `:tab` values currently resolve `overview`, `budget`, `procurement`, `tasks`, `work-orders`, `billing`, `documents`, `history`; procurement resolves `overview`, `items`, `documents`, `quotes`, `history`. These are existing record sections, not approval of their current tab-strip composition. Retain every section and deep link while applying N-03's navigation rule.

`/administration` selects its destination by role and recognized legacy hash; `/administration/:section` normalizes unknown sections to Users. Invoice/payment capture flows live inside their collection pages, not additional `/new` routes. Query and hash variants remain within the listed route's area, including filtered company/vendor doorways and report scope.

Classification follow-up: choose an explicit reading/recovery convention for the marked legal and unknown-URL surfaces when area 8 is composed; do not invent a collection or remove those routes to fit the vocabulary. All other declared page routes have a type; shell wrapping and redirects are labeled separately.

Guidance applied: Impeccable's Operate, layout and critique references prioritize job grouping, visible location, decision evidence and stable reading order; Taste supplies consistent alignment, labeled entry and complete loading/empty/error cycles. UI UX Pro Max searches for dashboard, data table, form, navigation and empty states support explicit headings, contained phone tables, persistent labels, predictable back and separate no-results guidance. These inform task structure; their optional visual recipes do not replace ADR-0068.
