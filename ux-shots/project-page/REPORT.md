# Project page screen-owner report

## Purpose and structure

| Screen | First question and reading order |
| --- | --- |
| Billing | Project control: which claim can I advance? Claims → evidence and stages in drawer → billing position → quantities and reconciliation → time and materials. |
| Rates | Contract administrator: what rate applies? Contract item → area rates → setup action. |
| Overview | Project manager: what needs my attention? Attention → position and delivery → supporting performance → activity. |
| Budget | Project manager: can this budget carry the work? Active budget → line amounts and actuals → version and ERP details. |
| Tasks | Project manager: which project tasks are due? View and filters → task rows → drawer → grouping and integrations. |
| Documents | Project team: where is the document I need? Register and filters → record drawer → connected sources. |
| Materials | Project manager or storekeeper: what has been issued against allowance? Issue action → consumption → movement history. |
| My tasks | Assignee: which task is due next? Queue and filters → project → task, work order, deadline and status → comments or time. |

The existing reads, role gates, record links, mutation paths, money definitions, retry controls, filters, and dialogs are the feature floor. A change in reading order keeps the original owner of each fact. The batches use the existing project frame, bordered tables, and right drawer.

## Changes and feature floor

- **Overview** — Attention and the project position lead. The first attention rows use the heading’s inset and a shorter heading gap. Performance follows delivery and the S-curve. Work-order cost and schedule indices now share one linked table with one index per right-aligned column. The project totals, cut-off, population, omissions and basis stay with the table.
- **Billing** — The existing Contract route still owns billability checks, claims, reconciliation and time and materials. Billing check labels lead their rows with statuses at a common right edge. The claim register precedes position figures and the summary disclosure within its panel. The claim drawer keeps next-stage work, completion and skipping, checklist evidence, deadlines and retention. Long stage statuses can wrap.
- **Rates** — The catalogue drawer opens on item, location, exact rate and effective date. Adding a location, selecting the default and importing sit below the register. On narrow drawers, the item spans the row above three labelled details. The area-rate editor keeps each area, editable value and its own save action together.
- **Budget** — The project budget retains its draft decisions, active budget figures, category chart, budget-versus-actual view and versions. The in-scope Odoo provenance and category-lines sections use the section-heading size and consistent separation. The primary budget page component is outside the specified file scope.
- **Tasks** — The list, board and calendar stay in the register with their existing filters and task drawers. Integrations now have a separate section gap after that working surface. Phase and group headings place progress first on a full-width metadata row below their titles. Group and phase actions retain their entry points.
- **Documents** — The toolbar and document register stay together. The empty register states what is absent in one line and uses the toolbar's Add document action. Folder view, filters, selection, approval, uploads and the document drawer retain their entry points.
- **Materials** — Issue remains beside the title. Consumption and movements have distinct headings. The consumption table uses 16 px cell insets and consistent numeric alignment. Phone rows retain labelled quantities, amounts and allowance status.
- **My tasks** — Queue, work-order filter and search can wrap independently. Project headings and full task titles share the same inset within each group. Start, due and overdue fields share a stable track on wide screens and sit before row controls on narrow screens. Comments, time entry, task status, source and linked-record actions stay available.

The outline uses the project's existing tokens, calculations, money formatters, query hooks and role checks. The diff contains view components, one test update and two locale edits. The work-order plan-versus-actual screens and New work order form supplied the visual references.

## Skill lines used

- **Restructure** — “Freeze the feature floor before any edit; simplification cannot silently remove a figure, capability or safeguard.” The purpose and flow above identify the homes of each changed area before its layout.
- **Taste, app screens** — “Tables are rules and alignment.” The performance and rate registers use one figure per cell and consistent numeric edges. Project tokens and the established table style govern the surface.
- **Impeccable, craft floor** — “Spacing: tight groups, generous separation, more space above a heading than below it.” Claim checklist rows and the materials sections keep related controls together and use the existing section spacing between jobs.
- **UI UX Pro Max** — “Mobile-first breakpoints” guidance was applied to the filter bar, rate editor and status rows so long values can wrap or scroll inside their own region.

The vendor script stopped at the missing upstream `gstack/cso` directory. I loaded the tracked Restructure override and retrieved the relevant upstream skill sources separately.

## Owner to confirm

- The claim register sits above its money summary within the claims panel.
- The rate catalogue shows its register before setup. In a narrow drawer, each item has labelled location, rate and effective-date rows.
- The empty document register uses a single state line. The materials tab starts at its title and Issue action.
- Project Tasks places phase and group metadata below their titles. My Tasks places dates before the action strip. The title gets its own line when the row carries status tags.

## Needs a data change

None identified in the changes above.


## Rendered evidence

Docker delayed live rendering until after the first edits. The untouched batch checkout supplied the before captures. Local Chromium rendered both versions at 1920 × 1080, 1440 × 900, 1024 × 768 and 390 × 844 in English and Bahasa Indonesia. The project manager opened Overview, Budget, Tasks, Documents and Materials. Finance opened Contract, Billing and Rates. An Engineer opened My Tasks. The capture sessions applied locale per browser session and kept the account preferences intact.

The seeded catalogue was empty. In the app as Admin, I added a sample location, pasted one item and its effective-dated rate in the catalogue import wizard, and checked that the saved row appeared. Its long USD amount exercises the Bahasa separators and narrow rate layout. The seeded projects use USD and the project form inherits organization currency. This round has no live long-rupiah comparison.

The gallery uses `before/<screen>-<language>-<width>.png` and `after/<screen>-<language>-<width>.png` under this directory. The screen keys are `overview`, `contract`, `billing`, `rates`, `budget`, `tasks`, `documents`, `materials` and `my-tasks`. The populated catalogue uses `rates-populated`. Open states use `claim-form` and `document-add-menu`. Each phase has 72 default and 24 extra captures. The final gallery masks names and project headings that contain them. The first redaction pass missed some project group labels, so those views were recaptured.

The review crops put the batch view on the left and the revised view on the right. [Populated catalogue](review/rates-id-390.png) · [Personal task group](review/my-tasks-en-390.png)

The first overview attention row under the heading went from 22 px to 12 px at 1440, measured between DOM boxes. Both text boxes start at x=273 before and after. The fixed-rule retry cleared the phase progress and personal task group findings for Tasks and My Tasks at all three checked widths.

### Measured edges

Coordinates are viewport pixels. Values read before → after. The Rates row in this table measures the Contract page behind the drawer. A dash marks a field that the measurement did not return.

| Screen | Title left x, EN 1440 | Section left x, EN 1440 | First table header left x, EN 1440 | First number cell right x, EN 1440 | Section left x, ID 390 |
| --- | ---: | ---: | ---: | ---: | ---: |
| Overview | 273 → 273 | 273 → 273 | — → — | — → — | 33 → 33 |
| Contract | 273 → 273 | 273 → 273 | 273 → 273 | 922 → 922 | 33 → 33 |
| Billing | 273 → 273 | 273 → 273 | 273 → 273 | 922 → 922 | 33 → 33 |
| Rates | 273 → 273 | 273 → 273 | 273 → 273 | 922 → 922 | 33 → 33 |
| Budget | 273 → 273 | 248 → 248 | 273 → 273 | 703 → 703 | 16 → 16 |
| Tasks | 273 → 273 | 273 → 273 | 250 → 250 | — → — | 33 → 33 |
| Documents | 273 → 273 | 265 → 265 | 249 → 249 | — → — | 33 → 33 |
| Materials | 273 → 273 | 248 → 248 | — → — | — → — | 16 → 16 |
| My tasks | 248 → 248 | 248 → 249 | — → — | — → — | 16 → 17 |

In the populated rate drawer at 390, the item text starts at x=17 → 34 and the amount ends at x=288 → 357. The revised row puts the item on its own line and fits the three labelled details on the same page. The phone catalogue comparison uses the same saved rate in both versions.

All 192 captures went through a name check before staging. A second OCR review covered the final phone set and the two comparison crops. It flagged zero files.

## Verification and readiness

| Check | Result |
| --- | --- |
| Batch integration | Fetched and already up to date. |
| Dependency install and production build | `npm ci` installed from the existing lockfile. The final production build passed. |
| Guards, typecheck and ESLint | Passed. ESLint covered all touched TypeScript files with zero warnings. |
| Related unit tests | The broad retry passed 1,577 of 1,578. The My Tasks source-issue link case timed out waiting for its link. Both tests in the file passed in isolation. |
| Supabase | Full startup filled the Docker VFS disk. After removing the optional images downloaded by this task, startup passed with Studio, postgres-meta, Logflare and Vector excluded. The subsequent `supabase db reset` finished and seeded sign-in worked. |
| Playwright browser | The bundled Chromium download returned HTTP 403. System Chromium ran the journeys and captures. |
| Engineer My Tasks | `AC-W2-IXD-001` passed. The run reported 11 passed, including ten role sign-ins. |
| Focused journeys | Six passed on the local preview. They covered budget paste (`AC-009`), document CRUD (`AC-DOC-001`), stock issue (`AC-STK-001`), claim stages (`JOB-BQ3`), location rates (`JOB-PC10`) and task groups (`JOB-T9`). |
| Overview performance | `AC-CSP-016` passed in the serial preview run. |
| Journey selection | `affected-e2e.mjs` selected 150 specs. The broader attempt hit a sign-in timeout, and the focused dev-server attempt hit timeouts before the selected preview retries above. The original journeys supplied all acceptance checks. |
| Rendered proof | The full proof flagged the overview word budget at 144 words against 136 and timed out on a later navigation. The fixed-rule run covered seven routes at three widths and flagged frames, progress tracks or tag/figure edges in Overview, Contract, Budget and the original Tasks and My Tasks captures. The final fixed-rule retry on Tasks and My Tasks passed at 1440, 1024 and 390. |

The one stale test now checks that a writer can add a document from an empty register. It previously required the removed helper sentence. Pagination, filtering, money and role assertions remain. The two timed-out document pagination cases and one timed-out search case passed in targeted retries. The earlier related run also hit an Administration focus failure, which reproduced on the untouched batch checkout. The final focused checks passed for attention, project Tasks, My Tasks and the rate catalogue.

## Coverage gaps

The gallery includes the default views and the selected open states listed above. Loading and error variants, every nested menu and picker, dark mode across the matrix and long IDR amounts remain outside the captured proof. The full rendered proof remains red. The scope-limited budget work covers Odoo provenance and ledger lines. Main budget layout findings remain open.

## Branch and publication

All changes and this report are committed locally on `ui/1126-project-page`. The images and this report are together in the final `shots (not for merge)` commit. The local branch has no remote counterpart for the requested origin comparison.
