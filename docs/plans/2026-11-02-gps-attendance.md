# GPS attendance and requests implementation plan (#1517)

> **For agentic workers:** Use the repository's Orca dispatch and TDD workflow. Checkboxes are execution steps; a fresh worker owns each slice.

**Goal:** Record site-checked clock events and route leave/overtime requests with visible offline and review outcomes.

**Architecture:** PMO owns attendance. Effective assignment and queue come exclusively from #1516 and #1520; typed repositories mediate all UI access, server RPCs enforce organization, scope and SoD, and the existing approvals inbox presents request decisions. Raw location is separately protected and expires under an owner-approved schedule.

**Tech stack:** PostgreSQL/RLS/RPC, Supabase, pgTAP, React 19, TypeScript, Vitest and Playwright.

**Spec:** [gps-attendance.spec.md](../specs/gps-attendance.spec.md), proposed. **Hard gate:** owner signs OD-GPS-1–7, counsel confirms legal basis/retention/rights, #1516 and #1520 ship; #902 action registration is a release dependency. Defaults below are conditional, not authorization to ship. Capture exact shipped #1516 and #1520 APIs at implementation, update this plan before writing code; their unshipped identifiers cannot be responsibly fabricated.

## Global constraints

- Only migration numbers 0537–0540, each with a matching `supabase/migrations/rollback/<name>_down.sql`. Check availability at build time and stop on collision; obtain allocation rather than silently renumbering.
- Server derives org and actor; all business tables have RLS and server-enforced active-member, scope and SoD checks. Register module actions in #902 when available; frontend `can()` is UX only.
- Never log coordinates or transmit them to third-party maps. Consent and device permission are distinct; no background location.
- #1520 owns queue/retry/Needs fixing; no parallel queue. Online-only approval and money operations. No payroll, ERP posting, timesheet creation or new roster.
- Each auth, location-access or SoD slice ships alone. Do not start builds before owner sign-off and dependency contract alignment.

## Review focus

1. A boundary-straddling accuracy circle must never become verified (A1 / AC-GPS-002).
2. Replayed IDs with different payloads and concurrent clock events must not create duplicates (A1 / AC-GPS-005).
3. A device shared after sign-out must not disclose prior queued evidence (A5 / AC-GPS-004).
4. A reviewer with request access but no evidence grant must not receive coordinates (A2 / AC-GPS-008).
5. Legal holds must stop raw-location purge while ordinary records retain their agreed minimum (A3 / AC-GPS-009).

## Contract and file map

- `supabase/migrations/0537_attendance_events.sql`: events, locked-down evidence storage, location check, identity-bound idempotent capture and sequence serialization; rollback alongside it.
- `supabase/migrations/0538_attendance_requests.sql`: request states, scoped approval and audited transitions; rollback alongside it.
- `supabase/migrations/0539_attendance_privacy.sql`: evidence access, notice/consent and retention/hold controls; rollback alongside it.
- `supabase/migrations/0540_attendance_reads.sql`: bounded security-filtered reads and inbox query; rollback alongside it.
- `supabase/tests/0537_attendance_events.sql` through `0540_attendance_reads.sql`: behavioral and authorization contracts, transaction-wrapped with `finish()` and rollback.
- `pmo-portal/src/lib/db/attendance.ts` and `src/lib/repositories/attendance.ts`: typed RPC access and repository seam; `src/auth/policy.ts`: affordance actions.
- `pmo-portal/pages/Attendance.tsx`, `pages/approvals/AttendanceApprovalSection.tsx`: employee and reviewer experiences; `App.tsx`: route; English/Indonesian locales.
- `pmo-portal/e2e/AC-GPS-004-offline-clock.spec.ts` and `AC-GPS-006-attendance-approval.spec.ts`: curated cross-stack journeys using #1520's test harness.

## Slices and dependencies

| Slice | Migration | Deliverable | Ships |
|---|---|---|---|
| A1 | 0537 | identity, effective assignment, geofence, immutable clock event, idempotency and ordering | alone: auth/tenancy |
| A2 | 0538 | leave/overtime request and online server-enforced approval | alone: SoD/auth |
| A3 | 0539 | evidence authorization, consent/basis records, hold and purge | alone: sensitive data/auth |
| A4 | 0540 | bounded employee/reviewer reads and approvals inbox integration | alone: auth |
| A5 | none | repository, offline queue and employee UI | after A1–A4 and #1520 |
| A6 | none | approvals UI and cross-stack journeys | after A2/A4/A5 |

All slices wait for #1516 and #1520. If #1516 lacks effective site geometry or identity linkage, or #1520 lacks a per-user idempotent queue, return to the owner/Director; do not invent competing implementations. A1 must not be exposed until A3 is deployed and privacy configuration is enabled.

## A1 — server clock event (0537)

**Interfaces:** `capture_attendance_event(p_event_id uuid, p_kind text, p_occurred_at timestamptz, p_lat double precision, p_lon double precision, p_accuracy_m double precision) returns uuid`; employee, assignment, org and site are server-resolved. `kind` is `in` or `out`. Coordinate payload is transient at RPC entry and stored only in an A1 evidence relation with all client grants revoked. A1 capture remains disabled until A3 installs and enables the approved privacy controls.

- [ ] Write `supabase/tests/0537_attendance_events.sql`: AC-GPS-001 valid inside event preserves assignment and two times; AC-GPS-002 rejects missing assignment, nonfinite/out-of-range coordinates, nonpositive accuracy, outside/overlap; AC-GPS-005 same UUID+payload returns same ID, different payload rejected, double-in and concurrent duplicate insert yield one event. Include boundary, midnight and changed assignment cases.
- [ ] Run `scripts/with-db-lock.sh supabase test db supabase/tests/0537_attendance_events.sql`; expect failure because migration/function absent. Inspect body for `Parse errors`.
- [ ] Add `0537_attendance_events.sql` and rollback: event UUID, org, employee, assignment, project, site, kind, occurrence and server receipt, classification and payload fingerprint; check constraints and unique `(org_id, employee_id, event_id)`. Under an employee-scoped transaction lock, check alternating chronological sequence; derive site and assignment at occurrence. Use great-circle distance in metres; inside iff distance + accuracy <= radius, outside iff distance − accuracy > radius, otherwise uncertain. Refuse verification for outside/uncertain. Compare replay fingerprint before returning existing ID. Create the separate evidence relation with RLS and no client grants; set RLS and explicit grants on event metadata. Keep capture disabled until A3 installs approved privacy controls.
- [ ] Re-run the exact pgTAP command; expect every assertion pass and no parse errors. Mutation-check inside predicate and idempotency by temporarily breaking each and confirming its named test fails; restore and rerun.

## A2 — requests and SoD (0538)

**Interfaces:** `create_attendance_request(p_type text, p_start timestamptz, p_end timestamptz, p_reason text) returns uuid`; `transition_attendance_request(p_id uuid, p_to text, p_reason text) returns void`. Types `leave|overtime|clock_review`; clock review has event kind, occurrence instant and reason without coordinates, is routed through the same scoped workflow, and a decision records a reviewed outcome rather than verified GPS presence. Legal edges `draft→submitted`, `submitted→approved|rejected`. Decisions require online RPC, an active scoped authority and actor different from requester; no sole-user exception.

- [ ] Write `supabase/tests/0538_attendance_requests.sql`: AC-GPS-007 own/out-of-scope/cross-org decision denied, eligible reviewer decides once, repeated or illegal transition rejected; AC-GPS-011 invalid interval rejected and no reviewer yields submitted/unassigned; a clock review without coordinates can be submitted and decided without becoming GPS-verified. Assert audit actor/reason and no offline server decision.
- [ ] Run `scripts/with-db-lock.sh supabase test db supabase/tests/0538_attendance_requests.sql`; expect missing function failure, no parse errors.
- [ ] Create request table, scoped reader, both RPCs and matching rollback in `0538_attendance_requests.sql`; bind effective #1516 assignment server-side, implement the clock-review path, and use existing manager/authority predicate where applicable. Lock row before validating state and actor. Store decision actor/time/reason and audit without location. Add existing approvals notification hook from #1520 for only the eligible recipient; do not call spend routing.
- [ ] Re-run that pgTAP file; expect all assertions pass, no parse errors. Mutation-check self-approval and scope guards independently, restore and rerun.

## A3 — privacy and retention (0539)

**Interfaces:** `set_attendance_consent(p_notice_version text, p_granted boolean) returns void`; `purge_attendance_evidence(p_before timestamptz) returns integer` callable only by the service's scheduled role; `attendance_location_evidence(event_id, latitude, longitude, accuracy_m, hold_until)` is separate from ordinary event reads. Controller config determines chosen legal basis; the consent RPC is used only where basis requires it.

- [ ] Write `supabase/tests/0539_attendance_privacy.sql`: AC-GPS-008 owner and explicitly granted scoped reviewer see evidence; request approver, unrelated employee, default admin and other org do not; AC-GPS-009 purge removes expired unheld coordinates but not held or minimum records, and audit contains no coordinates. Include withdrawn consent, version changes, and unauthorized purge.
- [ ] Run `scripts/with-db-lock.sh supabase test db supabase/tests/0539_attendance_privacy.sql`; expect missing relation/function failure, no parse errors.
- [ ] Extend the A1 evidence relation with versioned basis/notice/consent and hold records, scoped read policy, service-only idempotent purge and rollback in 0539. Apply owner-approved 90-day/2-year defaults only after sign-off; schedule via existing operations infrastructure, not browser code. Ensure A1 capture stores a rounded fix atomically only if basis allows and performs classification on unrounded input.
- [ ] Re-run the same pgTAP file; expect all pass, no parse errors. Mutation-check evidence read and hold predicates; restore and rerun. Verify actual grants as well as policies.

## A4 — bounded reads and inbox (0540)

**Interfaces:** `list_my_attendance(p_from timestamptz, p_to timestamptz) returns setof attendance_event_summary`; `list_attendance_requests_for_approval(p_limit integer, p_before timestamptz) returns setof attendance_request_summary`. Summary excludes raw coordinates; evidence read remains A3's separately authorized path.

- [ ] Write `supabase/tests/0540_attendance_reads.sql`: employee sees own bounded events and requests with both times; eligible reviewer sees scoped submitted requests and unassigned status; cross-org and unrelated readers see none; ordinary summary contains no coordinates. Limit pages to 100, stable order by creation time and ID.
- [ ] Run `scripts/with-db-lock.sh supabase test db supabase/tests/0540_attendance_reads.sql`; expect missing functions, no parse errors.
- [ ] Implement the two stable security-filtered readers and rollback in 0540, deriving actor/org server-side and preserving A2 authority. Use keyset cursor including ID when timestamps tie; register an approvals inbox source through the shipped inbox interface.
- [ ] Re-run the same file and inspect full output: all pass, no parse errors. Test grants for authenticated, anon and service roles and mutation-check scope.

## A5 — repository and employee experience (no migration)

**Interfaces:** in `src/lib/repositories/attendance.ts`, `capture(input: ClockInput): Promise<ClockResult>`, `list(from: string, to: string): Promise<AttendanceSummary[]>`, `createRequest(input: AttendanceRequestInput): Promise<string>`; `ClockInput` contains event UUID, kind, occurrence instant and optional fix, never org ID. `ClockResult` distinguishes `verified|pending_sync|needs_review`.

- [ ] Add `pmo-portal/src/lib/repositories/attendance.test.ts` covering AC-GPS-003 denied/uncertain fix offers manual review and no verified state; AC-GPS-010 absent basis/withdrawal does not call geolocation; AC-GPS-012 separate labelled occurrence/receipt in timezone including midnight. Add a shared-device queue test proving a second user cannot read the first user's queued payload.
- [ ] Run `cd pmo-portal && npx vitest run src/lib/repositories/attendance.test.ts`; expect failure for missing module.
- [ ] Implement `src/lib/db/attendance.ts`, `src/lib/repositories/attendance.ts`, policy actions in `src/auth/policy.ts`, `pages/Attendance.tsx`, routing in `App.tsx`, and `public/locales/en` and `public/locales/id` strings. Use the existing shared forms and permission primitives, #1520 queue adapter, and bounded readers. Display pending, review and server-rejected states; no raw coordinates in notification or logging.
- [ ] Run the same Vitest command; expect pass. Add `e2e/AC-GPS-004-offline-clock.spec.ts` under `docs/e2e-parallel-conventions.md`: offline capture → reconnect → verified or Needs fixing with server reason; exercise server-rejected changed assignment and shared-device identity. Run `scripts/e2e-local.sh AC-GPS-004` from repo root; expect pass.

## A6 — approval experience (no migration)

- [ ] Write `pmo-portal/pages/approvals/AttendanceApprovalSection.test.tsx`: submitted request is visible only for eligible reviewer, approve/reject submit once, unassigned and offline states are explained, server error preserves state and no raw coordinates appear.
- [ ] Run `cd pmo-portal && npx vitest run pages/approvals/AttendanceApprovalSection.test.tsx`; expect missing component failure.
- [ ] Implement `pages/approvals/AttendanceApprovalSection.tsx`, integrate it into `pages/Approvals.tsx` using the existing inbox composition, repository and `can()`; provide localized decision and reason copy. Keep final authority in A2 RPC.
- [ ] Re-run component test. Add `e2e/AC-GPS-006-attendance-approval.spec.ts`: assigned employee submits leave and overtime, a different eligible reviewer decides online in the inbox, employee sees decisions. Run `scripts/e2e-local.sh AC-GPS-006`; expect pass.

## Traceability: one owning layer per AC

| AC | Owner | Slice |
|---|---|---|
| AC-GPS-001 | pgTAP 0537 | A1 |
| AC-GPS-002 | pgTAP 0537 | A1 |
| AC-GPS-003 | Vitest repository | A5 |
| AC-GPS-004 | Playwright offline clock | A5 |
| AC-GPS-005 | pgTAP 0537 | A1 |
| AC-GPS-006 | Playwright approval | A6 |
| AC-GPS-007 | pgTAP 0538 | A2 |
| AC-GPS-008 | pgTAP 0539 | A3 |
| AC-GPS-009 | pgTAP 0539 | A3 |
| AC-GPS-010 | Vitest repository | A5 |
| AC-GPS-011 | pgTAP 0538 | A2 |
| AC-GPS-012 | Vitest repository | A5 |

## Final gate per slice

Run `cd pmo-portal && npm run check:guards && npm run typecheck`; run `npx eslint --max-warnings=0` on the exact touched TS/TSX files and directly touched Vitest files only. Run touched pgTAP under `scripts/with-db-lock.sh`; inspect output for parse errors. Run touched journeys with `scripts/e2e-local.sh` and `scripts/ux-proof.sh` for touched routes; observe shared DB lock rules and do not reset unless migrations changed. Each fresh worker reports output bodies, security mutation evidence, scoped review and owner decisions; no PR until the required gates pass. CI supplies full-suite proof.
