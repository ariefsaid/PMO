# Home and lists UX round

- Approvals protects the approver's next decision. `Count and scope → waiting rows | evidence and actions → corrections and follow-up`.
- Field and foreman My work starts the workday. `Clock in → notices → assigned tasks and work orders → attendance, deliveries and issues`.
- Admin home leads to interventions the administrator can act on. `Waiting actions → portfolio exceptions → position and operations`.
- Executive home leads to decisions and exposure. `Waiting decisions → projects at risk → financial position and sales`.
- Finance home leads to financial work awaiting action. `Queues → exceptions → portfolio and cash figures`.
- Project Manager home identifies the project that needs attention. `Waiting work → project exceptions → delivery position`.
- Engineer home leads into assigned work. `Tasks and returns → project context → related shortcuts`.
- Projects, Sales and Companies lead to the right record. `Search/scope → rows or board → preview/full record → supporting figures`.
- Calendar answers when something happens. `View and period → events → event record`.
- Meetings answers which meeting to open. `Search/scope → meeting rows → minutes and actions`.

## Changes

| Screen | Structure and reason |
| --- | --- |
| Approvals | All pending keeps its shared count. When only another decision kind has work, its section follows the summary directly. Procurement and timesheets keep their preview and bulk decisions when they have rows. Full values share the trailing edge of queue rows. The oldest case carries the wait colour. Other case ages stay readable in neutral text. Added waiting sections align their headings and links inside one panel. |
| Field and foreman My work | Clock-in and notices lead the phone. Tasks, assigned work orders, absence, the foreman's crew roster, deliveries and reported issues follow using their existing sections. |
| Admin, Executive and Finance home | The overview puts waiting actions in the first column and project health beside them. Position figures follow those blocks. Billing, purchasing, sales, portfolios and work orders still have their existing homes. |
| Project Manager home | The waiting section and contract figure keep their natural heights. My projects remains the full-width working table and leads the later delivery material. |
| Engineer home | Returned claims move alongside other attention work, ahead of timesheet and charts. Existing task and timesheet ordering still responds to whether there are open tasks. |
| Projects | Search and view controls feed straight into the chosen project list. Work in hand follows the results. The card grid can shrink below its previous 320px track minimum. |
| Sales Pipeline | Needs attention leads at desktop widths and ends with its rows. The funnel still filters by stage. Weighted forecast and open value read label, figure, then caption, with the complete values still available. Phone retains the working list first. |
| Companies | Search and company-type filters lead into the directory and its pager. On a new directory, the create control moves into the empty state and opens the existing dialog. |
| Calendar | Period and view controls lead into the calendar. The scope text is available from page help. The phase warning, retries and task/date actions keep their places. |
| Meetings | Project and archive filters and search lead into the meeting rows. On an empty register, the create control moves into the empty state and follows the same route. |

## Skill lines applied

- Restructure — “Freeze the feature floor before any edit” guided keeping the pre-existing actions, permissions and read paths.
- Impeccable — “Spacing: tight groups, generous separation, more space above a heading than below it.” The approval queue and role-home changes concentrate related rows and remove unused height.
- Taste — “Tables are rules and alignment.” Approval totals share a trailing edge and keep the full value.
- UI UX Pro Max — “No horizontal scroll.” Project cards use a bounded minimum width and approval filters can wrap.
- PMO screen rules supplied the typography, spacing and color tokens where external defaults differ.

## Owner to confirm

- The clock and notices precede tasks on field home. Returned claims precede the engineer's ordinary work.
- Admin, Executive and Finance overview position figures move below waiting work and project health. Projects' Work in hand section moves below its result set.
- Sales attention precedes the funnel. Calendar scope moves from toolbar text into page help.
- Empty Companies and Meetings put creation beside the empty-state message.
- All pending omits the legacy preview prompt when the actionable records are in another approval section.
- Compare `my-work-id-390.png`, `admin-home-id-390.png`, `projects-en-1440.png`, `sales-en-1440.png` and the named work-in-hand crops between the two gallery folders.

## Needs a data change

None identified in the changes made. Same reads, mutations and role checks.

## Checks

| Gate | Result |
| --- | --- |
| Dependency install | `npm ci` passed with the cloud cache and Node 22. The lockfile stayed unchanged. |
| Production build | `npm run build` passed. |
| Guards | `npm run check:guards` passed through the layout-baseline guard. |
| Types and lint | `npm run typecheck` and ESLint with zero warnings passed. |
| Focused Vitest | 350 initial tests passed. Engineer rerun passed 49 tests. Calendar and budget-agreement rerun passed 62 tests. Sales rerun passed eight. Companies and Meetings rerun passed 94. Approvals rerun passed 68. |
| Related Vitest | The broad run finished with 1,263 passed and 11 failed. Four Administration failures reproduced at the integration base. The Companies create-target race was fixed and passed on rerun. The budget-agreement failure passed in isolation. Calendar, Engineer and Sales presentation expectations were replaced with checks for help, access and filtering, and passed on rerun. |
| Impeccable detector | Source check returned zero findings. |
| Journey selection | A memoized local copy of the affected selector selected 464 of 529 specs from the integration base. Direct journeys for the owned screens are the relevant subset. |

## Render evidence

The baseline uses the untouched integration commit `4f26eec49`. The local stack was unavailable before the first source edit, so the baseline was rendered from that separate checkout after startup recovered. The source inventory and purpose sketches preceded the edits.

Playwright's browser download returned HTTP 403. System Chromium drove the app, captures and journeys. The initial full Supabase start stalled on Storage. The pinned image loaded from digest-verified upstream layers, and a lean start plus the requested local reset passed.

The paired gallery uses localhost, seed roles, English and Bahasa Indonesia, and viewports of 1920×1080, 1440×900, 1024×768 and 390×844. Browser response aliases replace record and account names in the captures. Temporary browser locale overrides leave account preferences intact.

The 390×844 approval stress pair substitutes three long rupiah amounts in the browser response. This leaves the seed untouched and exercises the real display code. The visible purchase amount edges moved from x=172, 138 and 172 to x=361 for all three. The viewport overflow was zero in both captures. The oldest case keeps the red age. Subsequent cases keep the age in neutral text.

- `before/approvals-id-390-long-idr.png`
- `after/approvals-id-390-long-idr.png`

## Measured edges

Each cell gives the title, first section heading and first table left edge in CSS pixels, in that order. A dash means the element was absent at that size. The page gutter stayed aligned across the paired renders.

| Capture | 1440 English before | 1440 English after | 390 Bahasa before | 390 Bahasa after |
| --- | --- | --- | --- | --- |
| admin-home | 248 / 273 / — | 248 / 273 / — | 16 / 33 / — | 16 / 33 / — |
| executive-home | 248 / 273 / — | 248 / 273 / — | 16 / 33 / — | 16 / 33 / — |
| finance-home | 248 / 869 / 249 | 248 / 273 / 249 | 16 / 33 / — | 16 / 33 / — |
| manager-home | 248 / 273 / 272 | 248 / 273 / 272 | 16 / 33 / 32 | 16 / 33 / 32 |
| engineer-home | 248 / 273 / — | 248 / 273 / — | 16 / 33 / — | 16 / 33 / — |
| approvals | 248 / 265 / — | 248 / 265 / — | 16 / 33 / — | 16 / 33 / — |
| projects | 248 / 273 / 249 | 248 / 273 / 249 | 16 / 33 / — | 16 / 33 / — |
| sales | 248 / 1057 / — | 248 / 273 / — | 16 / 50 / — | 16 / 50 / — |
| companies | 248 / — / 249 | 248 / — / 249 | 16 / — / — | 16 / — / — |
| calendar | 248 / 380 / — | 248 / 380 / — | 16 / 183 / — | 16 / 183 / — |
| meetings | 248 / — / 249 | 248 / — / 249 | 16 / — / — | 16 / — / — |
| my-work | 448 / 448 / — | 448 / 448 / — | 16 / 16 / — | 16 / 16 / — |

The default pairs recorded zero document-wide horizontal overflow in 192 captures, including the Field user. The individual table and list scroll areas can still scroll where intended.

Gallery paths follow `before/<capture>-<en|id>-<width>.png` and `after/<capture>-<en|id>-<width>.png`. The first column names the capture. The widths are 1920, 1440, 1024 and 390.

The shared Work in hand summary had two layers of top padding and a tall inline link at phone width. The existing card heading now supplies the spacing. The link uses the shared touch target without adding height. Checked the component's Projects, Executive and Project Manager callers. The standalone Work in hand page embeds the headerless variant.

| Work in hand heading to first figure label | 1440 before → after | 390 before → after |
| --- | --- | --- |
| executive-home | 32px → 16px | 52px → 16px |
| manager-home | 32px → 16px | 52px → 16px |
| projects | 32px → 16px | 52px → 16px |

The crops end in `-work-in-hand.png`. Shared-component tests passed for the summary itself and the Projects and Project Manager callers, 25 tests total.

## Journeys

- The post-merge replay passed all 18 browser checks. The final Sales paint adjustment was linted, built and recaptured.
- Projects smoke and seed authentication passed all 11 tests in the dev server.
- The scoped 29-case Chromium run passed 28. The Companies return journey hit an HTTP response error during that run and passed alone in the dev server. The run covered Calendar, timesheet and procurement approval, Companies, the Foreman, Projects and Sales return paths, leave approval, Meetings accessibility and minutes, kanban, Sales funnel geometry, work orders, the Field user, HR approval details, executive portfolio, work in hand and dashboard signals.
- The Foreman clock-in journey passed again with the paired `foreman-clocked-in-<en|id>-390.png` phone captures.
- No tracked journey steps changed. Temporary capture copies used the existing isolated Field user and Foreman fixtures and cleaned them through their journey hooks. The Companies journey created, edited and archived a disposable company through the Admin UI. Light-account fixtures came from the existing local test setup.

## Additional states

- Approval selection and its evidence at 390 with both languages. Files end in `-approval-preview.png`.
- Filtered-empty Companies and Meetings at 390 with both languages. Files end in `-empty-search.png`.
- Foreman after clock-in and reload at 390 with both languages. Files begin with `foreman-clocked-in-`.
- The gallery contains 111 matched before-and-after pairs. The table views were refreshed after merging integration commit `8e43e7688`, which updated the shared row-menu treatment.

## Rendered gate

The post-merge UX proof completed the eight routes at 1440, 1024 and 390 in both themes. It reported word-budget, layout and missing-baseline failures, and no serious or critical axe findings. The root counted 225 words at 1440 and 224 at 390, the same as the untouched baseline. The final approval-specific rules run passed at all three widths. Later crops verified the work-in-hand heading correction on three callers. At 390 the audit counts the compact Work in hand link box. A touch-enabled viewport measured its 44×44 hit area. The final Sales attention panel ended with its rows and cleared the blank-panel warning. The rendered detector still reported two Sales findings.

## What remains

- The gallery covers the default states and the named variants. A complete gallery of loading, error, one-record, picker, menu, drawer and dialog states and three review rounds on every route remain open.
- The deliberate long-rupiah stress capture covers Approvals. A corresponding stress fixture on every route remains open.
- Projects, Companies and Meetings retain their current record-opening journeys. Drawer-first triage remains open for those lists.
- The full rendered gate remains red. The default proof login does not exercise the Field user's `/my` view. The role-specific captures and journey cover it directly.

## Final gate status

The post-merge typecheck passed after regenerating the local declaration cache. The post-merge build and guards passed, and ESLint reported zero warnings on the touched files. The post-merge related Vitest run reported Administration failures before reaching its 15-minute limit. The earlier full related run and scoped reruns are recorded above.

The local branch carries the application commits and this separate proof commit. The rendered gate is red, so this round has no READY result.
