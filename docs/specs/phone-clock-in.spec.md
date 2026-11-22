# Clock in by phone at the work location

Ticket #2705 (map #902). Status: approved by the Director 2026-11-21 with rulings 1-5 (section 8), built. Builds on `light-accounts.spec.md` (#2710, `ClockInSection` seam),
`builtin-role-set.spec.md` (#2709) and `crews-roster-attendance.spec.md` (attendance path). The broader GPS ticket is #1517; offline capture is Q1 2027.
Rulings: OD-SCOPE-2 (no client process in code), OD-SCOPE-4.

**Job story.** When I arrive at a work location, I want to clock in from my phone inside the work order's area and choose my crew,
so attendance is recorded where the work is.

## 1. Design in one paragraph

A work order may carry an **area**: a point (`area_lat`, `area_lng`) and a radius in metres (`area_radius_m`), set by whoever may edit work orders
today (existing update policy). No area means no location is asked and clock-in is exactly today's. Where an area is set, the phone reads its
position once on tap and calls ONE security-definer RPC `phone_check_in(work_order, crew, lat, lng, accuracy)`. The database computes the
distance (haversine in SQL, no PostGIS) and decides. Inside and rostered: attendance through the existing `attendance_record` path
(`phone_check_in`) plus a location record. Outside, or not rostered that day: a **pending check-in request** for the supervisor, no attendance.
The supervisor, holding the organisation's configured supervisor role and never the requester, approves (attendance created through the same
path) or rejects with a reason. Position is kept in `phone_check_ins`, readable only by the person, the crew's controller/supervisor and Admin.

## 2. What exists (prior-art result, scope stated)

Searched decisions, ADRs, migrations, hooks, issues (`scripts/prior-art.sh`: geolocation, Permissions-Policy, phone_check_in, work order area,
field_controller). Found: `attendance_record` (1036/1110, source `phone_check_in`, requires roster + own profile), `crews.field_controller_id`,
`attendance_can_record(crew)`, the #2710 seam. Not found: any location on work orders, any check-in request table, any geolocation use in code.
The only geolocation restriction is `pmo-portal/public/_headers` (`Permissions-Policy: camera=(), microphone=(), geolocation=()` on `/*`).

## 3. Requirements (EARS)

- **FR-001** The work order shall carry an optional area: `area_lat` (-90..90), `area_lng` (-180..180), `area_radius_m` (1..50000), all set or all NULL.
- **FR-002** Who may set the area shall be exactly who may update a work order today (Admin, Executive, Project Manager, Finance), through the role-gated `set_work_order_check_in_area` RPC (1550); never a field account, never a direct table write.
- **FR-003** While a work order has no area, `phone_check_in` shall record attendance through `attendance_record` without reading or storing a position, and the phone shall not ask for location.
- **FR-004** When `phone_check_in` is called for a work order with an area, the database shall compute the distance from the point by haversine, from the position it received, and shall never accept a client "inside" flag. A missing/non-finite position, or accuracy <= 0, is refused (22023).
- **FR-005** When the person is rostered on that work order that day, within the area, `phone_check_in` shall record attendance via `attendance_record` (source `phone_check_in`, the crew chosen) and store lat/lng/accuracy/time/distance in `phone_check_ins` with status `recorded`.
- **FR-006** When the person is outside the area, or not rostered on the work order that day, `phone_check_in` shall store a `pending` request and create no attendance.
- **FR-007** The chosen crew shall be one the person is a member of that day; for an off-roster request the crew is optional.
- **FR-008** The check-in RPC shall be callable by a light account (it does not call `assert_not_light`) and acts only for the caller's own person.
- **FR-009** The organisation setting `phone_check_in_supervisor_role` (a built-in role key, default NULL) names who decides. NULL means: the controller of the chosen crew (`crews.field_controller_id`) or anyone `attendance_can_record` allows. A key means: an active person holding that built-in role. Only an Admin of the organisation sets it.
- **FR-010** `phone_check_in_decide(id, approve, reason)` shall refuse the requester, anyone not an eligible supervisor (FR-009), another organisation, and a light account; it shall decide a pending request once. Approve creates the attendance through the same `attendance_record` path with the stored position kept; reject needs a reason.
- **FR-011** The check-in position shall be readable only by the person, the crew's controller/supervisor and Admin of the organisation (RLS on `phone_check_ins`); no client write grant.
- **FR-012** `phone_check_in_requests()` shall list pending requests the caller may decide; empty for everyone else. The decision list sits on the existing Attendance screen and renders nothing unless a request exists.
- **FR-013** Location shall be read only on the tap (`getCurrentPosition`, no watch, no stored permission state), only from the clock-in section. The geolocation block in the response headers is lifted for the `/my` route only (section 5).
- **FR-014** Permission denied, unavailable fix or timeout shall show a clear message and offer the "ask your supervisor" request without a position (stored as pending, outcome `no_position`); it never records attendance by itself.
- **FR-016** Stored latitude and longitude shall be rounded to 5 decimals (about 1 m) in the database; the distance test uses the unrounded input.
- **FR-017** When the document's permissions policy does not allow geolocation (the page was reached by client-side navigation), the phone shall do one hard navigation to `/my?clockin=<work order>` and resume the tap after load, with a guard so it cannot loop.
- **FR-018** `my_home()` shall carry a boolean `has_area` per rostered work order (never the coordinates) so the phone knows before the tap whether a position is needed.
- **FR-015** English and Bahasa Indonesia, phone-first, one column, 44px targets, tokens only; existing repositories gain no method (new module `phoneCheckIn.ts`).

## 4. Acceptance criteria and owning layer

| ID | Given / When / Then | Owner |
|---|---|---|
| AC-PCI-001 | Area columns accept all-set or all-null, reject partial, out-of-range or radius <= 0. | pgTAP |
| AC-PCI-002 | Haversine helper returns known distances (equator degree, a 100 m offset within 1 m); symmetric; zero at same point. | pgTAP |
| AC-PCI-003 | No area: `phone_check_in` records attendance with no position row; unchanged outcome vs `attendance_record`. | pgTAP |
| AC-PCI-004 | Inside, rostered: attendance row `phone_check_in` exists, `phone_check_ins` status `recorded` with lat/lng/accuracy/time. | pgTAP |
| AC-PCI-005 | Outside (client sends only a position): pending request, no attendance; boundary point just inside records, just outside is pending. | pgTAP |
| AC-PCI-006 | Not rostered that day (inside area): pending, no attendance. | pgTAP |
| AC-PCI-007 | Chosen crew the person is not in: refused; invalid position or accuracy refused. | pgTAP |
| AC-PCI-008 | Light account can call `phone_check_in` (inside case records); light account cannot decide. | pgTAP |
| AC-PCI-009 | Decide: requester refused; person without the configured role refused; other org refused; with setting NULL the crew controller may; with a role key only holders of it; decided once (second call refused). | pgTAP (+ mutation) |
| AC-PCI-010 | Approve creates attendance (source `phone_check_in`) and links it; reject without reason refused, with reason stored; neither creates attendance on reject. | pgTAP |
| AC-PCI-011 | Position visible to the person, the crew controller and Admin; invisible to a peer, another crew's controller, another org; no INSERT/UPDATE/DELETE for authenticated. | pgTAP |
| AC-PCI-012 | Setting: Admin sets/clears; non-Admin and another org's Admin refused; key must exist in the catalogue. | pgTAP |
| AC-PCI-013 | Headers: `/my` allows `geolocation=(self)`, `/*` unchanged and still blocks; camera and microphone stay blocked on `/my`. | vitest (new file) |
| AC-PCI-014 | No area: no location prompt, `getCurrentPosition` not called; with area: called exactly once per tap, never `watchPosition`; denied shows message and the supervisor-request action. | vitest |
| AC-PCI-015 | Decision list renders nothing with no requests; with one, approve/reject buttons for an eligible supervisor, reject requires a reason; English and Bahasa strings present. | vitest |
| AC-PCI-E2E | A rostered person with a mocked in-area position clocks in; with an off-area position a request appears for the supervisor, who approves; attendance shows. | E2E (written, not run) |

Mutation notes (named, not run by the builder): make the inside test always true (AC-PCI-005 red); drop the requester guard in decide (AC-PCI-009 red);
drop the role check (AC-PCI-009 red); ignore the roster test (AC-PCI-006 red); add a SELECT policy for any member on `phone_check_ins` (AC-PCI-011 red);
add `assert_not_light()` to `phone_check_in` (AC-PCI-008 red); skip the all-or-none area check (AC-PCI-001 red).

## 5. The geolocation block and how it is scoped

The only place is `pmo-portal/public/_headers`, `/*`: `Permissions-Policy: camera=(), microphone=(), geolocation=()`. Existing test AC-SEC-207
pins the `/*` rule, so it stays. Cloudflare Pages merges matching rules and cannot override a header's value, but a rule may detach one with `! Name`. Plan:
a `/my` rule that detaches the header and sets `camera=(), microphone=(), geolocation=(self)`. The clock-in section lives on `/my` only, so the policy
is lifted for that route and stays blocked on every other route. The browser API is called only from `ClockInSection`.
Residual: a Permissions-Policy is per response; in-app navigation from `/my` to another route is client-side (same document), so the document policy
stays the one loaded. The browser API is therefore called from the clock-in screen only, by code, not by header, on a full page load of another route.

## 6. Settings

`work_orders.area_*` (per work order, empty = off). `organizations.phone_check_in_supervisor_role` (default NULL = crew controller / attendance approver).

## 7. Not in this ticket

Offline check-in (Q1 2027). Continuous tracking, geofence alerts, retention/consent notice (#1517 owns). Check-out. A map.

## 8. Director rulings applied (2026-11-21)

1. Headers: `/my` detaches the site-wide `Permissions-Policy` with `! Permissions-Policy` and re-adds `camera=(), microphone=(), geolocation=(self)`. AC-SEC-207 stays untouched; the new test asserts the `/my` rule and that every other rule still blocks geolocation.
2. Per-document policy: before `getCurrentPosition`, `ClockInSection` asks `document.permissionsPolicy` / `document.featurePolicy` `allowsFeature('geolocation')` (where available). If not allowed it does one `window.location.assign('/my?clockin=<wo>')` and resumes the tap after load, guarded by a session flag so it cannot loop (FR-017). Both branches unit-tested (AC-PCI-014).
3. `attendance_record` is re-created in 1212 as a copy of the 1110 definition with one hunk changed (the phone-check-in authority test) and a header naming the source; the rollback restores the 1110 body.
4. Crew is optional on off-roster or no-position requests; deciders as in FR-009.
5. Stored lat/lng rounded to 5 decimals in the database (FR-016).
6. (Builder) 1214 re-creates `my_home()` as a copy of 1207 with the `has_area` key only (FR-018); a work order with no area keeps the existing clock-in path (existing tests untouched). Position protocol: with an area and no position yet, `phone_check_in` returns `needs_position` and writes nothing; the phone then reads its position once and calls again. A denied/unavailable fix calls it with `p_no_position = true`.

## 9. Phone clock-in fixes (15 December walk)

- **FR-019** A crew's Foreman clocks in himself on a work order his crew is rostered on and chooses the crew when he leads more than one (1551). The first clock-in enters him in the workforce register when he is not there yet.
- **FR-020** `my_home()` carries, per work order, today's clock-in state: clocked in (with the time), waiting (with who decides), or refused (with the reason) (1552). The card shows it, survives a reload and offers no second tap while clocked in or waiting.
- **FR-021** A check-in waiting for a decision appears in the home "needs you" list of the person who may decide, one tap from Approve and Reject; each request shows the area it is judged against (1553).
- **FR-022** The check-in area form has latitude, longitude, radius in metres and "use my current location"; anyone who opens the Roster view sees the area read-only. A roster the person may not tick says who ticks it.
- Proof: `supabase/tests/1550_walk_checkin.test.sql` (AC-WCI-001..022, with in-file mutation checks), vitest AC-WCI-030..060, journeys AC-PCI-E2E and AC-LA-E2E.
