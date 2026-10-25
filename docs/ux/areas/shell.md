# Shell + navigation — #806, phase 2 / area 1

Builder proposal; mode: Operate. Authority: [OD-VISUAL-RESET / OD-REDESIGN-SCOPE](../../decisions.md), [UX-STANDARD](../UX-STANDARD.md). Keep ADR-0068 colours, fonts and radii; retain every feature and route. Jobs follow [PRODUCT](../../../PRODUCT.md) and the dashboard bodies cited in the inventory. Rendered screens require owner approval.
Current facts, EN/ID labels, all five role columns, phone equivalents, route homes and exact test paths: [shell inventory](shell-inventory.md). Baseline: `2c74a13f`; code, not previous composition notes, decides the inventory.
## Role jobs

| Role | Jobs on opening the app (one clause each) |
|---|---|
| Admin | Find portfolio exceptions; decide pending requests; maintain membership and workspace setup; connect business tools and resolve exceptions. |
| Executive | Identify projects needing attention; judge portfolio spending and margin; follow opportunities toward contract; decide pending requests. |
| Finance | Find work still to invoice; follow receipts and vendor payables; review purchase requests and budget variances; inspect statements and revenue; complete assigned tasks. |
| PM | Find delivery risks; inspect project budget and progress; complete assigned work; review requests; record time and expenses. |
| Engineer | Complete assigned tasks; record this week's hours; check timesheet outcomes; record expenses; follow project meetings and evidence. |

## Target information architecture

Dashboard stays first for everyone. Group names EN/ID: **My work / Pekerjaan saya**, **Deliver projects / Pelaksanaan proyek**, **Manage money / Kelola keuangan**, **Work with partners / Mitra kerja**, **Workspace setup / Pengaturan organisasi**. Keep current item labels (L-01/L-02).
Within-group orders: Work = Approvals → My Tasks → Timesheets → Expenses; Deliver = Projects → Meetings → Incidents; Money = Sales Invoices → Incoming Payments → Procurement → Revenue by Project → Financial statements → Management pack; Partners = Sales Pipeline → Companies → Contacts (Vendors replaces Companies/Contacts when CRM is off, for its existing roles); Setup = Administration.
After Dashboard, group order is Admin/Executive: Work → Deliver → Money → Partners → Setup; Finance: Work → Money → Deliver → Partners → Setup; PM: Work → Deliver → Partners → Money; Engineer: Work → Deliver. PM/Engineer get Setup only as verified Operators. Omit only role/feature-ineligible items from the inventory.
Move Approvals out of Workforce into Work's first position: decisions before browsing. Move My Tasks before time/expenses: do → record. Move Procurement from Delivery to Money: request → purchase → pay. Merge Overview into Dashboard, Workforce into Work and CRM into Partners: recognizable jobs. Keep Companies/Contacts separate destinations: different searches; do not merge their features.
Views gets a permanent `/views` link after job groups when enabled, including zero saved views; keep up to eight saved shortcuts beneath it. Assistant, Setup and build version remain utilities at the foot; account owns personal preferences/integrations/legal/sign-out. Dashboard, then the Work heading and single Approvals row (eligible roles only) stay above the destination scroll; no duplicate shortcut.
Use the inventory's full role order and route-home tables: creation stays with its collection; record sections use named section navigation (N-03); `/sales/:id` still resolves to `/projects/:id`; ERP purchases stays a Procurement child; all Administration sections, legal, entry/recovery and unknown-URL routes retain homes.

## Page frame anatomy — PA-02, N-01, N-02

Top bar names the current area and carries search, notifications and Account; move breadcrumb/return into the content track above the title. One h1 identifies the job or record; scope line names project/customer/period before results. Record scope links its parent project/customer; creation inherits origin scope (E-01).
Desktop: collection primary ends its toolbar; record primary ends title row; capture/review primary follows evidence in the action bar. Phone: record primary has its own full-width row after title/scope; collection creation ends the wrapped toolbar; capture/review submit follows evidence, with safe-area space and no content-covering sticky bar (A-01/A-02).
```text
1440 +----------------------+-----------------------------------------------+
     | Dashboard/job groups | area | Search | Bell | Account                |
     |                      | Back to <source> | parent breadcrumb          |
     |                      | h1 record/job                [record primary] |
     |                      | scope: project / customer / period            |
     | utilities / collapse | toolbar ... [collection primary]              |
     +----------------------+ content ... [capture/review action bar] ------+
```
```text
390  + Menu | area | Search | Bell | Account +
     | Back to <source>; parent link         |
     | h1 record/job                         |
     | scope: project / customer / period    |
     | [record primary]                      |
     | toolbar ... [collection primary]      |
     + content/evidence; [submit] -----------+
```
Action slots above are alternatives by page type, never simultaneous primaries. Desktop breadcrumb gives canonical ancestry; phone shows a named return plus nearest parent when different. Return restores source filters/sort/period/scroll; direct entry falls back to the owning collection. Browser Back remains native; dirty-edit guards remain (N-02/N-04).
## Shell states

Collapsed desktop rail: explicit Collapse/Expand; same ordered destinations, icons with accessible names and focus/hover labels, active marker and counts; expanding preserves route. At ≤920px use a drawer, with full labels and the same groups/order; no compact icons-only phone navigation.
Drawer: focus enters and stays inside; background inert and scroll locked; close, Escape and scrim restore trigger focus; selecting a route closes it and focuses main. All entries/utilities reachable by scrolling; ≥44×44 phone targets and safe-area clearance.
Active item: exactly one owning destination with `aria-current`; use existing active tokens plus a non-colour cue. Every project stage highlights Projects on `/projects/:id`; Sales Pipeline is the collection lens. Change stage-active expectations deliberately, retaining location/return tests (N-01/N-04).
Counts: unread bell remains separate from pending Approvals; localized accessible names, quiet existing tokens, no alarm styling for counts. Bell zero hides badge; Approvals shows known zero, omits unavailable/partial/stale totals; shell does not fetch whole queues to manufacture counts (S-01/S-03).
Permissions: hide destinations unavailable to the role or disabled feature; omit empty groups. Keep permitted read destinations visible. Disable an applicable action only with its reason beside it, never a hover-only explanation; preserve consequential confirmations and existing access-check retry entry (A-04). Role preview remains view-only with its banner.
Language: put EN/ID choices in Account under Language / Bahasa at both widths, using the existing saved preference; Profile & preferences retains number/timezone settings. Theme, personal integrations, legal/support and sign-out stay in the same menu; changing language keeps route/scope (L-01/L-02).
## Builder acceptance

- [ ] Produce the [route × role × state capture manifest](shell-inventory.md#screenshot-checklist): each listed route pattern instantiated × 390/1440 × light/dark × EN/ID; use synthetic records, record URL/role/state, and before/after navigation/action pairs.
- [ ] Capture expanded/collapsed rail, open/closed drawer, account language/theme/preview, palette results/loading/no-results/error, notification empty/unread/error and approvals known-zero/pending/unavailable; verify all feature-on/off and Operator variants without orphaning a route.
- [ ] On captures verify PA-01/02/04, N-01–04, A-01–04, E-01, C-01, S-01/03 and L-01/02; prove return context and parent links by interaction. Machine evidence: one h1, no document overflow, phone targets ≥44×44, axe serious/critical = 0, empty Impeccable findings, existing semantic tokens only; obtain owner approval of rendered screens.
- [ ] Follow [test disposition](shell-inventory.md#test-disposition): delete only identified look assertions on recomposition; keep behaviour/a11y/role/count/locale oracles, adapting steps for this deliberate IA change. This docs task changes no tests or product code.
