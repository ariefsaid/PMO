# Financial statements in PMO (#897) — v0.23 native report display

**Owner amendment (2026-10-18):** v0.23.0 displays saved ERPNext standard reports.
This supersedes the 2026-10-16 calculation approach for this release. Implementation targets dev only.

**Authority:** owner 2026-10-18 direction; OD-SAR-PMO-IS-THE-UI and OD-ERP-3/4; DD-OPS-11;
ADR-0016 authorization, ADR-0010 test ownership. The producer/aggregation parts of ADR-0088 and
older implementation plans are superseded for this release by decision OD-FS-023.

## 1. Job, release scope and parked work

When preparing month-end, Finance reads the connected Company's ERPNext standard statements and
project P&L in PMO, including the preceding period, without opening ERPNext Desk.

**Cadence amendment (owner, 2026-10-19 15:45/16:15 WIB; release-review refinement, PR #1212; OD-ERP-023):** Keep the five-minute cron trigger. The whole ERPNext sweep runs during UTC minutes 0–4. Between those windows, a statement-eligible binding without a matching first publication may keep five-minute progress while its matching native report batch opened within six hours or acquired a report within the last six hours (Director, under owner instruction to fix the stalled first load, 2026-10-20). Match the existing collector eligibility and the current company, binding identity, activation instant, version and project map. A future activation timestamp does not extend either window. Older connections start collection on an ordinary hourly attempt; once that attempt opens a validated batch, its bounded five-minute continuation can finish the initial catalogue (normally about one hour after collection starts). Expired or unconfirmed batch windows follow the hourly cadence. Other ticks make no ERP calls or domain writes. Immediate dispatch and ClickUp cadence remain unchanged; statement report requests allow 25 seconds, the statement stage 75 seconds, and the sweep tick 100 seconds, relying on the conservative 150-second Edge wall-clock ceiling; ordinary ledger budgets remain unchanged. No schedule migration or statement-only gate applies.

v0.23 displays **actual ERPNext standard report responses**, saved by the existing ERP sweep:
Trial Balance, Profit and Loss Statement, Balance Sheet, and P&L with an explicit mapped native
Project filter. One activated Company, IDR, month/quarter/fiscal-year picker, current/prior ranges.
Existing approved company page/project Overview, roles, plain-language states and both locales stay.

**Parked after v0.23.0, preserved rather than deleted:** independent mirrored-GL report calculation,
B2 aggregate/T7/130k calculator work, T3 recompute, seven-case calculator oracle/ACB equivalence,
no-ERP financial statements, and any derived unassigned remainder. Company report remains native
company-wide; a project report adds only its explicit native Project filter. No company-minus-project
math, allocation or invented native unassigned report. No unassigned picker/endpoint in v0.23.
Cash flow, consolidation, account maintenance, GL drilldown, auditor export and posting/closing/
period-lock workflows retain their separate scope. Existing Actuals/aging/other accounting flows
and raw-ledger privacy contracts remain unchanged.

## 2. Source, capture and storage contract

- **Producer:** normal read-only GET `frappe.desk.query_report.run` with standard native report
  name and exact filters, with ignore_prepared_report=1 as a method argument (not inside filters),
  through the existing classified GET ERP transport/strict metadata wrapper.
  No native helper execution, custom report/controller, GL/account arithmetic or browser ERP call.
  v16.33.0/Frappe16.31.0 is the captured statement profile; existing supported legacy integrations
  continue independently when this display capability is unavailable.
- **Periods/profile:** actual applicable native fiscal calendar; immediately preceding equivalent
  range, with explicit dates. TB uses its actual FY/from/to and six returned monetary fields, both
  closing-entry options on, group/net on, unclosed-prior-P&L off. PL is nonaccumulated; BS accumulated;
  Date Range current/prior calls are independent with Monthly/Quarterly/Yearly. IDR, blank selected
  book plus native default-book entries, no other dimensions/consolidation/template. An unsupported
  prior/range or native clamping does not create zero/guessed dates.
- **Mapped projects:** server binding map resolves PMO project id to native Project name. Company
  responses are never a project's fallback. Native project PL supplies both its detailed response
  and its restricted three totals. The latter copy the native report_summary Income/Expense/Net
  Currency values for each single-period call; no sum/subtraction or missing-profit-row inference.
  Mapping/summary-role structure is source-bound and validated; relevant missing values fail.
- **Lossless display:** preserve native financial numeric tokens before JS Number conversion;
  normalize representation/structure only. Preserve ordered columns/rows, sparse special/footer/
  provisional/unclosed rows, native empty states and per-side absent rows. No locally repaired
  hierarchy/profit/zero row, missing-cell default0, row summation or monetary recomputation.
  Current/prior remain separate native sides; translated labels are not Account identities or a
  cross-period join key. Formatting is presentation only and does not rewrite stored values.
- **Presentation metadata (owner 2026-10-18):** Native display has no System Settings or
  System Manager dependency. ERPNext owns report calculation precision and rounding. Read
  presentation precision from readable Currency metadata or the report response; preserve lexical
  financial values without client rounding. A System Settings 403 must not prevent publication.
- **Raw audit:** keep each original financial response with its exact filters, software/context,
  acquisition time and digest in restricted detail storage. Totals rows have no raw reports,
  account rows/settings/filter bodies or company detail. Never publish native bodies/coordinates.
- **Incremental refresh / complete publication (OD-FS-024):** Bootstrap the complete supplied
  catalogue. Later sweeps refresh the current/prior comparison for month, quarter and fiscal year,
  plus historical native reports invalidated by observed mirrored-ledger changes. Backdated
  changes also invalidate later historical Trial Balance and Balance Sheet reports that depend
  on those entries. Retain compatible unchanged historical outputs, original raw strings, hashes,
  filters and per-side acquiredAt. Each successful publication still atomically exposes the ENTIRE
  required scope/period catalogue; partial work preserves the preceding complete generation.
  Missing or incompatible native context requires acquisition rather than guessed reuse. Mirror
  values are invalidation signals only, never financial inputs. No arbitrary history cutoff,
  narrower user-demand catalogue or runtime-timeout increase.
  Native acquisition precedes mirror refresh in each tick, so changes first detected by the later
  stage refresh on the next tick; durable dirty revisions survive until successful publication.
- **Honest time/coherence:** sourceGeneration identifies one complete published native read set,
  which can include reports retained from earlier acquisitions; it is not a GL/chart generation
  or an ERP-wide transaction. Each response retains acquiredAt. The common acquisition envelope
  covers both retained and fresh reports and does not relabel old reports newly acquired. Ordinary
  financial changes across native calls belong to that real window. Recheck binding, Company,
  native profile, calendar, project map and effective report settings before publication; changed
  context invalidates pending work. Only dirty revisions admitted by the completed batch may be
  acknowledged; later changes survive for the next refresh. Missing/failed reports cannot publish.
  No second financial pass, GL-completeness/ACB parity gate or invented ERP revision is required.

### Roles and server authority

Active own-org Admin/Finance/Executive read company and account-detail reports and project totals.
Project Manager/Engineer read only totals for projects visible under actual projects RLS. Inactive,
anonymous, no-profile and foreign-org callers have no access. Real role, not impersonation, applies.
RLS/grants plus invoker read RPCs enforce this on every path, including absence lookup. No client
org/Company/native-project/filter override; ordinary users never write the read-model. Existing
account/ledger role restrictions remain; they are not this release's statement amount source.

## 3. EARS requirements

- **FR-001:** When an authorized user selects a captured supported period/scope, PMO shall display
  its saved native current/prior report outputs with correct dates, Company and IDR context.
- **FR-002:** When an org's sweep segment runs, it shall collect/resume bounded normal native report
  reads for eligible fresh reports and publish a complete validated retained-plus-fresh catalogue
  under the current lease/binding fence.
- **FR-003:** The system shall obtain every statement financial value from its actual native report
  response and shall preserve that value through storage/read/display without independent accounting.
- **FR-004:** While native output includes or omits provisional/unclosed profit or posted equity,
  PMO shall preserve that presentation without manufacturing/correcting postings or profit rows.
- **FR-005:** When a mapped project is selected, the system shall use that explicit native Project
  filter and expose only the authorized native project result; no unassigned remainder is derived.
- **FR-006:** The system shall enforce the exact server role/tenancy/detail-vs-totals contract above.
- **FR-007:** When results render, PMO shall reuse approved Card/DataTable/ListState/provenance and
  period controls, both locales and plain readable report/account labels. No raw ERP ids or “mirror”,
  “GL”, “watermark”, “docstatus”/internal source jargon in visible or accessible UI copy.
- **FR-008:** If collection/context/publication fails or remains partial, PMO shall keep the old
  complete result with its original time and honest delayed state; without one it shall show
  “Statements are not available yet”. Native complete-empty is “No activity in this period”.
- **FR-009:** When a complete compatible native catalogue exists, the sweep shall refresh the
  routine current/prior comparisons, dependency-invalidated historical reports and missing or
  incompatible keys, retaining other exact native pairs without rereading unchanged history.
- **FR-010:** When a generation includes retained reports, publication shall preserve original
  per-report raw/provenance/acquiredAt and show an honest acquisition envelope.
- **NFR-004:** A dirty revision observed during a batch shall survive failed publication and shall
  not be lost when a newer revision of that date arrives before acknowledgment.
- **NFR-001:** Every stored/read/displayed financial cell and project-total value shall equal its
  captured native response value; a changed/removed required cell shall fail the owning proof.
- **NFR-002:** The collector shall respect actual runtime/request/body limits, resume rather than
  publish a prefix, and expose the true acquisition window without claiming an ERP atomic snapshot.
- **NFR-005:** While the connected ERP has constrained capacity, acquisition shall issue serial
  bounded report requests with segment size and cadence based on measured per-call cost and
  headroom; retain runtime deadlines and resume pending work without saturating the ERP.
- **NFR-003:** Use repository/DAL, permission-scoped cache keys, accessible shared UI and sanitized
  errors/evidence; never expose raw detail/financial responses through totals or public artifacts.

## 4. Acceptance and lowest sufficient owners

| ID | Given / When / Then | Canonical owner |
|---|---|---|
| AC-001 — Native output preservation | Given hash-bound actual standard TB/PL/BS/project PL examples and exact filters, when the shipped fetch/normalizer maps them to saved display payloads, then all native ordered rows/columns/monetary cells/summary totals and intentional absences survive without arithmetic; changed/missing required data fails and irrelevant extras pass. | Vitest `statementReports.test.ts` |
| AC-002 — RIS Finance rehearsal | Given an authorized isolated RIS-equivalent rehearsal, completed native capture window and recorded filters/versions, when ordinary Finance opens each report/project/current-prior pair, then saved native output, authorized read and UI values/labels agree; no ERP posting/closing is performed by the runner. | Curated E2E `AC-002-financial-statements-rehearsal.spec.ts` |
| AC-003 — Privacy | Given signed roles/inactive/anonymous/foreign org, when direct snapshot/raw-detail/read RPC paths run, then only authorized finance roles receive detail/raw and no ordinary caller writes. | pgTAP display privacy |
| AC-004 — Project totals | Given visible/hidden/foreign/nonexistent projects and forged scope inputs, when staff reads totals, then only that authorized project's native Income/Expense/Net plus safe structural context returns; raw/detail/Company payload never returns, including on absence paths. | pgTAP project totals |
| AC-005 — Native acquisition lifecycle | Given multiple segments, sparse native outputs, failure/context drift and ordinary ERP financial changes across calls, when acquisition resumes, then a System Settings 403 does not block valid publication, valid responses are retained once per request key, drift/missing/error prevents completion, old published data and dirty work survive, compatible historical pairs retain original bytes/times, routine and dependency-selected requests are exact, and later dirty revisions survive acknowledgment; no GL/second-pass gate. | Vitest/real sweep-handler test |
| AC-006 — Atomic complete publication | Given old rows and concurrent/stale/expired workers, when final publication succeeds/fails, then readers see only old or complete new scope/current-prior catalogue, with fenced state/time/raw linkage; never pending/prefix/cross-org data. | pgTAP + existing two-session race |
| AC-007 — Selection | Given bound Company/calendar/mapped project, when period/scope changes, then saved exact current/prior ranges and report type are selected with no stale/broader scope fallback. | Existing scope unit/RTL |
| AC-008 — Honest UI | Given loading/error/unavailable/native-empty/delayed/populated/native-sparse states in both locales, when rendered, then approved accessible UI preserves values, rows and original time with no invented zero/row/jargon. | Existing section/renderer unit/RTL |
| AC-009 — Real-role cache | Given real roles/Admin view-as and identity/org/role/project changes, when requests/cache run, then affordances and cached responses remain within the signed real-role scope. | Existing permission/cache unit/RTL |

AC ids stay traceable, but AC001/005 source mechanism and the absence/remainder semantics are
explicit owner amendments, not silently weakened old calculator tests. Record exact old/new test
contracts before dependent edits; preserve privacy, atomicity, honest-state and intuitive UI goals.

## 5. Release status / remaining facts

Code can land on dev with honest pending acceptance. Synthetic/native samples and an ordinary local
Finance rehearsal support development; they do NOT prove RIS equivalence. AC002 remains pending
until the owner-approved separate site in the existing local ERPNext v16 stack is provisioned
from the local input files and actually run. No new infrastructure or off-device production data
transfer is authorized.
OQ001 remains month/quarter/FY, no custom dates. Former OQ002 mirrored-history/ACB equivalence moves
with parked recomputation work; native capability/context/permission and end-to-end RIS display
proof remain actual release facts. A native report may use ACB/closing internally; PMO copies it.
No seven-case calculator or130k local aggregation gate is imposed on v0.23 native display.

Before any dev-to-main release PR, both Sol and Claude Opus whole-release security reviews must
complete. Notify Claude when the release candidate is ready on dev. Dev remains the current ceiling.
