# Spec: ERPNext adapter — Timesheets push-Approved-only (Issue P3b — ADR-0055 P3 phase, time/costing spine)

> **Status:** **DRAFT — revised 2026-07-16 for the owner rulings; awaiting sign-off on the remainder.**
> **Decided since draft 1:** **OQ-TSP-3 → the Employee-adopt sub-domain** (owner picked the most correct
> long-term option, explicitly over map-only) — §5.9 is the new surface; **OQ-TSP-4 → billable hours OUT of
> scope, costing only** (confirmed; §2 non-goals). **Still open:** OQ-TSP-5 (timezone), OQ-TSP-6 (correction
> path) — drafted positions kept, flagged, **not buried** (§3, §14); and the **new** OQ-TSP-10 that the adopt
> ruling surfaced (ERP `Employee` → PMO user resolution — §3, §14, with a recommendation).
> **OQ-TSP-1 (the live-bench spike) is STILL OPEN and STILL A HARD GATE** — the bench was down ~36h and the
> spike could not run; it has been restarted and the spike re-dispatched. **No body field names are guessed
> anywhere in this spec.**
>
> **⚑ ID-prefix deviation (confirmed by the owner, 2026-07-16):** the brief said `FR-TS-###`/`AC-TS-###`, but
> `FR-TS-001..010` / `AC-TS-###` are **already taken** by the shipped `docs/specs/timesheets-approval.spec.md`
> (the PMO approval state machine, migration `0007_timesheet_approval.sql`, pgTAP `0021..0026`). Reusing them
> would break `grep -r AC-TS-###` traceability against a live spec. This spec uses **`FR-TSP-###`
> (TimeSheet Push) / `NFR-TSP-*` / `AC-TSP-###`**. The pre-existing `FR-TS-*` requirements are **unchanged and
> not re-litigated** — P3b consumes them as a precondition.
>
> **Authority / grounds:** **ADR-0059** (**written and Proposed alongside this spec** — *PMO-SoT domains with
> an external side-mirror*: the two postures, the choice rule, the seven Posture-B invariants, the
> deterministic key, the never-adopt rule + its **master-data exception** that licenses §5.9's Employee
> adopt, and the ADR-0055 §5 row clarification); **ADR-0055** §5 ownership-map row *"Timesheets | **ERP** |
> native + costing; PMO weekly-grid UX is the surface; **approve = command**"* (clarified, not contradicted,
> by ADR-0059 §7) + §8 (*P3 = "ERPNext width: timesheets, budget projection, sales documents"*) + §4 + §2;
> **ADR-0058** (the fenced outbox — verbatim, plus the anchor-less corollary of ADR-0059 §4); **ADR-0048**
> (ERPNext = the costing/accounting engine); **ADR-0019** (server-enforced SoD — already satisfied PMO-side
> by `transition_timesheet`); **ADR-0016**; **ADR-0010**; **OD-SAR-GATES**, **OD-SAR-PMO-IS-THE-UI**,
> **OD-SAR-DRAFT-SUBMIT**, **OD-ENA-SHARED-BINDINGS**, **OD-ENA-VAULT-SEAM** (`docs/decisions.md`); the
> shipped **P2** adapter (`docs/specs/erpnext-adapter.spec.md` — its **party-adopt path is the pattern §5.9
> follows, not a new mechanism**) and **P3a** (`docs/specs/erpnext-adapter-p3a-sales-ar.spec.md` + its
> max-thinking Luna re-audit, `docs/reviews/2026-07-15-luna-p3a-reaudit-maxthinking.md` — P3b is designed to
> **not repeat** its ten findings; §5.2/§5.4/§5.6/§5.9, §12).
>
> **Owner intake ruling (binding — the whole scope in one line):**
> **PMO timesheets push to ERPNext ONLY once Approved.** A Draft / Submitted-but-unapproved timesheet
> **never** reaches ERP. **PMO is the system of record for time entry and approval**; ERPNext receives the
> **approved result** for costing.
>
> **Scope (locked, Director + the 2026-07-16 rulings):** (a) a new PMO domain **`timesheets`** owned by the
> `erpnext` tier and **two** new `ErpDocKind`s — **`timesheet`** (ERP `Timesheet`, the push) and
> **`employee`** (ERP `Employee`, **read-only inbound adopt** — the OQ-TSP-3 ruling, §5.9); (b) a
> **push-on-approval** write-through (create + submit) riding the ADR-0058 outbox, with a **server-side
> Approved re-assertion before any ERP call**; (c) **two new machine-written tables** — the 1:1 side mirror
> `timesheet_erp_mirror` and the adopted master `erp_employees` — and **no flip** of the PMO-owned
> `timesheets`/`timesheet_entries` (§4, ADR-0059 Posture B); (d) a **sweep backstop** re-driving
> approved-but-unpushed sheets under a **deterministic** key; (e) inbound **lifecycle-only for the
> `timesheet` kind** (a natively-created ERP Timesheet is **never adopted**) but **normal adopt for the
> `employee` master** (ADR-0059 §5's master-data exception); (f) the **byte-for-byte invariant**
> (FR-TSP-004): P3b is additive; an org not owning `timesheets`→`erpnext` — i.e. **every existing client** —
> is unchanged, **and** the PMO timesheet module's behavior (`FR-TS-001..010`) is unchanged **for every org,
> flipped or not**.

---

## 0. Job story

> **When a client employs ERPNext as the costing engine, the approved hours my team already entered and I
> already approved in PMO must land in ERPNext by themselves — so project costing is computed on real time —
> while hours that are still being drafted, disputed, or awaiting my approval never leak into the ledger; and
> every client who does NOT employ ERPNext keeps the exact timesheet module they have today.**

PMO stays the app layer, the weekly-grid UX, **and the SoT for entry + approval** (ADR-0055 §5's *"PMO
weekly-grid UX is the surface; approve = command"*, clarified by ADR-0059 §7). ERPNext owns the native
`Timesheet` and the costing computed from it. The push is a **consequence** of approval, not a second
approval: `transition_timesheet` remains the sole approval authority — its SoD (*"even an Admin can never
approve their own timesheet"*, `0007` A4) is the SoD that matters; ERP submit is the mechanical consequence.
Commands go down **synchronously** through the served `adapter-dispatch` boundary P2 shipped, guarded by the
ADR-0058 outbox so a retry — or a race between the synchronous push and the sweep backstop — can never mint a
duplicate Timesheet (a duplicate = **double-counted hours** = inflated project cost). The flip is per-org and
reversible; with no `timesheets`→`erpnext` assignment it is inert.

---

## 1. Overview and user value

P3b is the **time/costing phase** and — per **ADR-0059** — the **first Posture-B domain**: the first
inversion of ADR-0055 §5's shipped ownership posture, where **PMO owns the process (entry + approval) and
ERPNext records the outcome (the costing document)**. That inversion is the whole design (§4, §7):

| | Posture A — P2 procurement / P3a revenue | **Posture B — P3b timesheets** |
|---|---|---|
| Who authors | PMO UI → ERP is the writer of truth | PMO UI |
| Who approves | ERP `docstatus` (+ a PMO-side SoD RPC for SI) | **PMO** (`transition_timesheet`, shipped) |
| SoT of the record | **ERP** | **PMO** (`timesheets` + `timesheet_entries`) |
| PMO table posture | **flipped** machine-only (RLS `42501` on native writes) | **unflipped, user-writable — untouched** |
| ERP-side state lives in | the mirror table itself | **a 1:1 side table** `timesheet_erp_mirror` |
| Trigger | a user command | **approval** (+ a sweep backstop) |
| Idempotency key | client-minted per attempt | **deterministic** (two originators) |
| Inbound adopt (process doc) | mints a PMO mirror | **never** — ack-and-skip + `action-required` |
| Inbound adopt (**master data**) | n/a | **yes — `Employee`, via the shipped party-adopt path** (ADR-0059 §5 exception) |
| Reversal | drop the flip; stale rows remain | **`drop table` — zero PMO data loss** |

User value: approved time reaches costing with **zero double-keying** and zero Desk visits
(OD-SAR-PMO-IS-THE-UI); a project's ERP cost is real; unapproved/disputed hours are structurally incapable of
reaching the ledger; PMO keeps its weekly-grid UX, its manager-approval line (`profiles.manager_id`), its
tenancy model, and — for every non-employing client — its exact current behavior.

---

## 2. Scope

### In scope
- A new PMO domain **`timesheets`** owned by the `erpnext` tier (`capabilityMap` grows `{companies,
  procurement, revenue}` → `{companies, procurement, revenue, timesheets}`), accepted by the
  `adapter-dispatch` `ADAPTER_REGISTRY` + the `domain_externally_owned` ownership map (0087).
- **Two** new `ErpDocKind`s, wired additively into `DOCTYPE_REGISTRY`/`DOCTYPE_BODIES`/`KIND_DOMAIN`/
  `KIND_MIRROR_TABLE`:
  - **`timesheet`** → ERP `Timesheet` (submittable; the push), and
  - **`employee`** → ERP `Employee` (**`readOnly: true`** — inbound adopt only; PMO never writes an
    `Employee`). **Both live in the `timesheets` domain** — see FR-TSP-094's placement rule (putting
    `employee` under `companies` would change behavior for orgs **already flipped** on `companies`, breaking
    FR-ENA-004; the timesheets flip must bring its own master).
- The **push command surface: create + submit only** (`submitOnCreate: true` — §5.5 explains why this is the
  *opposite* of `sales-invoice`'s `submitOnCreate:false`, and why that is correct, not an oversight).
- The **Approved-only gate as a server-side re-assertion** (`approvalGuard.ts`) — the dispatch re-reads
  `timesheets.status` under the caller's JWT and requires `'Approved'` **before any adapter/outbox/ERP work**
  (ADR-0059 §3.3). The client never asserts approved-ness.
- **Two new machine-written tables** (§4): the 1:1 side mirror `timesheet_erp_mirror` and the adopted master
  `erp_employees` + its PMO-user link. The PMO-owned `timesheets`/`timesheet_entries` are **NOT touched** (no
  new columns, no RLS change, no trigger) — §4.3.
- **The Employee-adopt sub-domain (§5.9 — the OQ-TSP-3 ruling):** inbound adopt of ERP `Employee` records
  into `erp_employees` via the **shipped party-adopt path** (`_shared/erpnextFeedDeps.ts`'s `mintMirror` +
  `external_refs` + the sweep/webhook engine — **not a second mechanism**), plus an **Admin-confirmed link**
  to a PMO `profiles.id` and a fail-closed push when a sheet's author has no confirmed link.
- Deterministic idempotency (§5.3, ADR-0059 §4): `idempotency_key = 'ts:' || timesheet_id || ':' ||
  approved_at` so the synchronous push and the sweep backstop **collide on the outbox unique 4-tuple**
  (`23505`) instead of double-posting.
- **Fail-closed reference pre-flight before the ERP write** (§5.4 — the Luna BLOCK-5/BLOCK-6/SF9 lessons):
  the employee link, every entry's project mapping, and every link's `org_id` are resolved and validated
  **before** the outbox claim and the ERP POST; any miss → `commit-rejected`, no ERP call. A missing
  resolution is **never** silently omitted from the body.
- Binding-config additions (§4.4): `default_activity_type`, `timesheet_day_start`. *(The draft-1
  `employee_map` config key is **removed** — superseded by the adopt ruling.)*
- Inbound: **lifecycle-only** for the `timesheet` kind + a desk-cancel tombstone that reopens the push state;
  a natively-created ERP Timesheet is **ack-and-skipped + surfaced `action-required`**, never adopted.
- The **byte-for-byte invariant** (FR-TSP-004), in **two** forms P3b needs and P3a did not:
  1. an org not owning `timesheets`→`erpnext` is unchanged (incl. **orgs already flipped on
     `companies`/`procurement`/`revenue`** — the new `employee` kind must not perturb them); **and**
  2. the PMO timesheet module (`FR-TS-001..010`: draft/save/submit/approve/reject/rework, the weekly grid,
     `save_timesheet_week`, `transition_timesheet`) is **byte-for-byte unchanged even for a flipped org** —
     P3b **adds a consequence to approval, it does not change approval**.
- The served-fn money-e2e lane is **reused** (P2 FR-ENA-001..003) — every P3b push e2e exercises the **real
  served `adapter-dispatch`** + the named server-side fault seams, never `page.route`.

### Out of scope (non-goals — explicit)
- **⛔ Billable hours / billing rate — OUT OF SCOPE (owner ruling, 2026-07-16: "costing only, billable OUT").**
  The adapter sends **no** `is_billable`, **no** `billing_hours`, **no** `billing_rate`; PMO models no
  billability and no rate, and none is added here. **P3b pushes costing truth only.** The **Timesheet →
  Sales Invoice billing linkage** (`Sales Invoice.timesheets[]`, the P3a↔P3b intersection) is **deferred to
  its own issue**, which owns: whether billability is an ERP-side per-Activity-Type concern or a new PMO
  field on `timesheet_entries` (a PMO schema + UI change), the rate source, and the SI linkage itself.
  **A builder must not add a billing field to close a "nice to have" — it is a scope violation.**
  *(Rationale recorded: ship costing correctly before touching anything that bills a client.)*
- **Any change to the PMO timesheet approval state machine** — `transition_timesheet`'s map, SoD, and authz
  matrix are untouched. Adding an ERP-push step *inside* that RPC is explicitly prohibited (§13, ADR-0059
  §3.1).
- **Minting PMO users/auth identities from ERP.** The Employee adopt mints into `erp_employees` only; it
  **never** creates a `profiles` row, an auth user, or a login (§5.9, FR-TSP-093). *(Auto-provisioning
  logins from an external HR master would be a privilege-escalation surface, not a convenience.)*
- **Employee *write*** — PMO never creates/updates/deletes an ERP `Employee` (`readOnly: true`). HR masters
  are ERP-side. **Activity Type, costing-rate, salary, holiday-list authoring** are likewise ERP-side.
- **Cancel / amend as PMO commands.** PMO's `Approved` state is **terminal** (`0007`: `'Approved' → []`), so
  a PMO-side correction path does not exist today → there is nothing to cancel/amend *from* (§3 OQ-TSP-6 —
  **open**). An ERP **desk** cancel still arrives as inbound lifecycle (in scope).
- **Adopting native ERP Timesheets into PMO** — prohibited (ADR-0059 §5): it would mint hours that never
  passed PMO approval.
- **Field-level re-sync of native fields from a desk edit** (the P2 boundary) — the feed stamps lifecycle.
- **Budget projection** (the other ADR-0055 §8 P3 item) — a separate issue.
- Any helper-app requirement in ERPNext (ADR-0055 §2).

---

## 3. Decided defaults and open questions

> **Discipline (the P3a precedent):** the architectural questions are decided; the **empirical** ones are a
> live-bench spike, and **nothing is invented**. P3a's OQ-SAR-1 spike overturned two drafted assumptions
> (`project` not `cost_center`; SI cancel not hard-blocked) — P3b's ladder is **wider**, so the guess-rate
> would be higher, not lower.

### OQ-TSP-1 — the `Timesheet` + `Employee` field maps, anchor, and validation ladder — **OPEN — BLOCKING — the spike could not run**

**⚑ Status 2026-07-16:** the bench was **down ~36h**; the spike **did not run**. It has been restarted and the
spike **re-dispatched**. **This remains a HARD GATE: no body field names may be guessed to close it, and the
body/e2e work does not start until it freezes.**

Run the **R9 ladder** against the same stock bed P2/P3a used (`frappe/erpnext:v15.94.3`, site `frontend` @
`http://localhost:8080`, `PMO Smoke Co`, IDR, Standard COA, no custom apps, token auth, stock
`/api/resource` v1 REST only), method identical to `docs/spikes/2026-07-11-erpnext-pe-mandatory-fields.md` +
`2026-07-14-erpnext-si-pe-receive-fields.md`: POST a minimal body, read the `exc_type`/`_server_messages`
rejection, add exactly the named field, repeat until `200`; then `PUT {docstatus:1}`; then **re-fetch** and
diff. File the frozen output as `docs/spikes/YYYY-MM-DD-erpnext-timesheet-fields.md`; **its §9 is the
binding map.**

The spike MUST answer, each with observed evidence:

1. **Minimal mandatory body** for `Timesheet` + its `time_logs` child rows: which of `employee`, `company`,
   `time_logs[].activity_type`, `from_time`, `to_time`, `hours`, `project` are required at **save**, at
   **submit**, or **server-derived**? *(Hypotheses to be proved/disproved, NOT built on.)*
2. **The anchor.** Which stock, REST-**filterable** text field survives `validate` + `submit` + re-fetch
   **verbatim**? Probe **in order**: `note`, `title` (if present), `parent_project`,
   `time_logs[].description`. **If none survives → OQ-TSP-2's fail-closed default fires — report loudly.**
3. **Overlap validation.** Does ERP reject overlapping `time_logs` **within** one Timesheet? **Across**
   Timesheets for the same `employee`? Exact `exc_type`/message. *(Drives §5.5's packing algorithm — PMO
   stores `entry_date` + `hours` with **no clock times**.)*
4. **Datetime format + timezone.** Does `from_time` accept naive `'YYYY-MM-DD HH:MM:SS'`? Interpreted in the
   **site** timezone (`System Settings.time_zone`)? What happens to an ISO-8601 `…Z` string? *(Feeds OQ-TSP-5.)*
5. **Does submit create GL entries?** *(Hypothesis: **no** — a Timesheet posts no GL by itself. If the spike
   finds a GL/costing posting on submit, it **is** a money doc and every ADR-0058 rule tightens — report
   loudly.)* Answer via `GET /api/resource/GL Entry?filters=[["voucher_no","=","<ts-name>"]]`.
6. **Cancel behavior.** Cancellable? **Blocked** when referenced (`LinkExistsError`), or **auto-unlinked**
   (the P3a AR delta)?
7. **The zero/empty edges.** Empty `time_logs`; `hours: 0`; `hours > 24` on a row; a day summing > 24 — clean
   `417`/`ValidationError`, or an unguarded **`500 TypeError`** (the PI/SI crash shape)? A `500` bucket must
   be pre-validated client-side and classified non-retryable.
8. **Employee link.** Exact `DoesNotExistError` shape for an unknown `employee`; can an `Employee` exist
   without HR-module setup on the stock bed?
9. **⭐ NEW (the OQ-TSP-3 ruling) — the `Employee` doctype's READ shape.** `GET /api/resource/Employee` +
   `GET /api/resource/Employee/<name>`: the exact field names for **name** (the ID — `HR-EMP-#####`?),
   `employee_name`, **`user_id`** (the Frappe User link — *does it exist and is it populated?*),
   `company_email` / `personal_email` / `prefered_email` (**which exist; which are populated**), `status`
   (`Active`/`Left`/…), `company`, `date_of_joining`, `relieving_date`, and `modified`. **This decides
   OQ-TSP-10's matching key.** Also: does `Employee` support the same `modified`-poll + webhook the party
   adopt uses? *(§5.9's `employeeFromDoc` is spike-gated exactly like the Timesheet body — **do not guess
   these names either**.)*

### OQ-TSP-2 — recovery policy for an anchor-less doc — **DECIDED (fail-closed), contingent on OQ-TSP-1 #2**

Per **ADR-0059 §4's corollary**:
- **Surviving, filterable, PMO-owned anchor** → `anchorField: '<that field>'`, `anchorMutable: false` ⇒
  reissue-capable (the PI twin), ADR-0058 verbatim, no new registry semantics.
- **No field survives** → `anchorField: null` **+ the additive registry flag `neverReissue: true`**, and
  `reissueOnInconclusiveAbsence = !(entry.anchorMutable || entry.neverReissue)`. **Rationale:** today
  `anchorField: null` means *"skip the probe → fresh claim+POST"* — i.e. **reissue-capable** — which for a
  Timesheet is a silently **duplicated week of hours** → inflated project cost. So an anchor-less Timesheet
  is **`held`** — terminal until an operator — **never auto-reissued**. Additive + default-absent ⇒ every
  existing kind is byte-for-byte (NFR-TSP-REG-001).

### OQ-TSP-3 — Employee master — **✅ DECIDED (owner, 2026-07-16): the Employee-adopt sub-domain**

**Ruling:** the owner chose the **Employee-adopt sub-domain** — the most correct long-term option —
**explicitly over map-only** (the draft-1 `binding.config.employee_map`). **The `employee_map` config key is
removed.** P3b adopts ERP `Employee` records into PMO through the **existing party-adopt mechanism** (the
shipped `_shared/erpnextFeedDeps.ts` `mintMirror` path + `external_refs` + the webhook/sweep engine —
ADR-0059 §5's **master-data exception** licenses this: PMO is not the Employee's SoT and no PMO process is
bypassed by adopting one). **Do not invent a second adopt mechanism.** Full surface: **§5.9**; storage
**§4.2**; ACs **AC-TSP-090..094**. The one thing the ruling does **not** settle is the *matching key* →
**OQ-TSP-10**.

### OQ-TSP-4 — billable hours — **✅ DECIDED (owner, 2026-07-16): costing only; billable OUT of scope**
**Ruling: confirmed out.** No `is_billable`/`billing_hours`/`billing_rate` is sent; no PMO billability model
is added. The Timesheet→SI billing linkage and the billability/rate question are **deferred to their own
issue** (§2 non-goals). P3b delivers **costing**.

### OQ-TSP-5 — site timezone vs org timezone — **✅ RULED (owner, 2026-07-22)**

> **THE RULING: per-org timezone becomes a FIRST-CLASS binding-config field, AND a mismatch BLOCKS the
> flip.** The timesheet domain may not be handed to the ERPNext tier while the org's declared working
> timezone disagrees with the ERP site's `System Settings.time_zone`.
>
> Rationale the owner endorsed: this is the **silent-corruption** class. A day-shifted entry produces
> wrong period costing with **no error**, and is close to undetectable after the fact. A loud refusal at
> onboarding costs one check; the alternative is wrong money that looks right. Same principle already
> applied to `NaN` watermarks, missing `company`, multi-FY budgets, and the unstamped-activation gate:
> **a visible refusal beats a plausible guess.**
>
> **Build implications:** (1) add the org timezone to `external_org_bindings.config` (it is currently
> implicit — nothing in PMO records what the org's working timezone actually is); (2) the flip/enable
> path must REFUSE on mismatch, not warn; (3) keep the built naive site-local `'YYYY-MM-DD HH:MM:SS'`
> send and the `timesheet_day_start` default — the ruling adds the config + the block, it does not
> change the wire format.

*(Original open question retained below for context.)*
PMO stores `entry_date` (a **date**, no time, no zone). ERPNext stores **naive datetimes** interpreted in the
**site**'s `System Settings.time_zone`. The adapter synthesizes `from_time` (§5.5). If the bench site's
timezone differs from the org's working timezone, a day-boundary entry lands on the **wrong ERP day** → wrong
period costing, **silently**. **Drafted position (built):** send **naive site-local**
`'YYYY-MM-DD HH:MM:SS'` (never a `Z`-suffixed instant), pin `timesheet_day_start` default `'09:00:00'` in
binding config, and **assert at onboarding** that the ERP site timezone matches the org's — surfacing a
**loud** mismatch rather than silently shifting hours. **Owner to rule:** is a per-org timezone a first-class
binding-config field, and should a mismatch **block** the flip?

### OQ-TSP-6 — correction path for an approved week — **✅ RULED (owner, 2026-07-22)**

> **THE RULING: option (a) NOW — ship P3b with the gap — AND option (b) is the NEXT issue**, filed with
> its own spec: `Approved → Draft` (a re-open) plus an ERP cancel command.
>
> ⚑ **"Next" means genuinely next, not someday.** This gap is hit far more often than the analogous
> multi-FY budget deferral (which affects 8 of 54 seeded projects): **mistyped timesheets are routine** —
> every timesheet product has a correction path because people get weeks wrong regularly. Until (b)
> ships, a pushed week with a mistake can only be corrected by an ERPNext **Desk** cancel, which is a
> known, accepted, temporary violation of **OD-SAR-PMO-IS-THE-UI**.
>
> **(b) is NOT a P3b task** — it changes the SHIPPED `FR-TS-001..010` state machine, so per ADR-0059 §8
> it gets its own issue and its own spec. A builder must still not invent it inside P3b.

*(Original open question retained below for context.)*
`0007`'s map makes **`Approved` terminal** (`'Approved' → []`). Once pushed there is **no PMO path** to fix a
mistake. The only correction today is an ERP **desk** cancel — which **contradicts OD-SAR-PMO-IS-THE-UI**
("no user is ever required to open the ERPNext Desk"). **This spec builds no correction path** (§2) and the
inbound desk-cancel tombstone (FR-TSP-084) is the only reconciliation. **Owner to rule:** (a) accept the gap
for P3b (drafted); (b) add `Approved → Draft` (a re-open) + an ERP cancel command — **a change to the shipped
`FR-TS-001..010` state machine, therefore its own issue with its own spec** (ADR-0059 §8), not a P3b task;
(c) something else. **A builder must not invent (b) inside P3b.**

### OQ-TSP-10 — ⭐ **NEW (surfaced by the OQ-TSP-3 ruling): how does an ERP `Employee` resolve to a PMO user?** — **OPEN — needs an owner ruling; recommendation below**

**This is the crux of the adopt ruling and it is genuinely a decision, not a detail.** Adopting an
`Employee` row is mechanical (the party-adopt path already does it). **Resolving it to a `profiles.id` is
not** — the answer decides *whose* cost a week of hours becomes, and it is a **security** question as much as
a data question:

| Option | How | Why it might be right | Why it might be wrong |
|---|---|---|---|
| **(A) Auto-match on work email** | `erp_employees.work_email` (or `erp_user_id`) `=` the PMO user's auth email, case-insensitive | Zero admin effort; usually correct | **ERP-side email is ERP-editable.** Anyone with Desk access can silently re-point a PMO user's identity → hours/cost attributed to the wrong person. Also breaks silently on a personal-vs-work email mismatch, and on employees with no PMO login (contractors) |
| **(B) Explicit admin mapping UI** | An Admin picks the PMO user for each adopted Employee | Unambiguous; auditable; no ERP-side field can move it | Manual for every hire; a new hire's first approved week fails to push until an Admin acts |
| **(C) ⭐ RECOMMENDED — adopt-then-confirm** | The adopt **proposes** a link on an exact, case-insensitive match of the spike-confirmed work-email field (OQ-TSP-1 #9) → `link_state='proposed'`; an **Admin confirms** it (a security-definer RPC, audited) → `link_state='confirmed'`. **Only `confirmed` is authoritative for a push.** Anything else → the push **fails closed** (FR-TSP-051) with an `action-required` | Gets (A)'s ergonomics (the Admin clicks Confirm on a pre-filled proposal, not a picker) with (B)'s authority (an ERP-side email edit can **propose**, but can **never** silently re-point a **confirmed** link — a re-proposal on a changed email surfaces as `action-required`, it does not auto-re-link). Matches the app's existing posture: the party adopt's ambiguous-match case already **surfaces** rather than auto-resolving | One human click per new employee, once |

**Recommendation: (C).** It is the only option where an ERP-side edit cannot silently move a PMO user's cost
identity, and it degrades safely (a missed confirm = a visibly failed push + a sweep that re-drives once
confirmed — never a wrong attribution). **This spec builds (C)** — §5.9, FR-TSP-090..095 — **flagged as
open**; if the owner picks (A) or (B), only FR-TSP-092's link-state machine changes (an FR-level change, not
a re-architecture: the table, the adopt, and the fail-closed push are identical in all three).
**Sub-questions to rule on with it:** (i) an `Employee` whose `status` is `Left` while its PMO user is still
active (**drafted:** keep the confirmed link; the push still works — history must stay pushable); (ii) may an
Admin link **one** PMO user to **two** Employees (**drafted: no** — `unique (org_id, profile_id) where
link_state='confirmed'`).

### OQ-TSP-7 — domain granularity — **DECIDED**
One PMO domain **`timesheets`** carrying **both** kinds (`timesheet`, `employee`). Independent of
`companies`/`procurement`/`revenue`; an org may own any subset (the OQ-2/OQ-SAR-2 precedent). **The
`employee` kind is deliberately NOT in the `companies` domain** — FR-TSP-094.

### OQ-TSP-8 — push trigger topology — **DECIDED (synchronous-first + sweep backstop, deterministic key)**
Synchronous-first (ADR-0055 §4): the FE's approve path calls `transition_timesheet` (the unchanged authority)
and, on success, dispatches the push. Because a synchronous push can fail *after* a successful approval
(network, ERP down, unlinked employee), an **approved-but-unpushed sheet is a normal, expected state** — the
`erpnext-sweep` re-drives it (FR-TSP-045). Both paths use the **same deterministic key** (§5.3) so they
collide on the outbox's unique 4-tuple rather than racing to two ERP POSTs. The approval is **never** blocked
or rolled back by a push failure (FR-TSP-006).

### OQ-TSP-9 — side table vs flipping `timesheets` — **DECIDED (side table) — now ADR-0059**
`timesheet_erp_mirror`, 1:1, machine-written — **not** a flip. Reasons: (i) PMO is SoT, so the P3a flip would
be **wrong** and would `42501` the shipped weekly grid on a flipped org; (ii) adding machine-only `erp_*`
columns to a **user-writable, hot** table would need a column-pin guard on every `save_timesheet_week` write
— a behavior + performance change to shipped code for zero benefit; (iii) a side table keeps P3b **strictly
additive** (`drop table` reverses it whole, zero PMO data loss). **Now recorded as ADR-0059 (Posture B)** —
no longer a spec footnote.

---

## 4. New storage (schema — reversible migrations, RLS on every table)

Migration numbers: `ls supabase/migrations | tail -1` = **`0107`** at spec time → P3b reserves **`0108`**
(the side mirror), **`0109`** (the gate/config RPCs), **`0110`** (`erp_employees` + the link RPC).
**Re-verify at build time** (concurrent writers).

### 4.1 `timesheet_erp_mirror` (new — the ERP-side state for a PMO-owned record)

1:1 with `timesheets`. **Machine-written only** (dispatch/sweep service role). All four `erp_*` feed columns
ship **day one** (the 0103 lesson: `companies` shipped without `erp_modified`/`erp_docstatus` and broke the
first live webhook with `42703`).

| Column | Type | Notes |
|---|---|---|
| `id` | uuid pk | |
| `org_id` | uuid not null | org seam; `stamp_org_id()` (0074) |
| `timesheet_id` | uuid not null **unique** references `timesheets(id) on delete cascade` | the 1:1 seam; cascade because the PMO row is SoT |
| `ts_number` | text | ERP `name` (display only; the mapping lives in `external_refs`) |
| `push_state` | text not null default `'pending'` CHECK (`pending\|pushing\|pushed\|failed\|held`) | the operator surface + the sweep's work queue. `held` = ADR-0058-terminal (OQ-TSP-2) |
| `push_error` | text | last classified failure (client-safe) |
| `pushed_at` | timestamptz | |
| `approved_at_pushed` | timestamptz | the `timesheets.approved_at` this push was keyed on — the deterministic-key witness (ADR-0059 §6) |
| `erp_total_hours` | numeric(9,2) | ERP `total_hours` — **read-back oracle**, verbatim, never recomputed (ADR-0048) |
| `erp_total_costing_amount` | numeric(14,2) | ERP `total_costing_amount` — read-back oracle |
| `erp_docstatus` | smallint | feed column, day one |
| `erp_modified` | text | feed column (per-row source-mod cursor / stale-event guard), day one |
| `erp_amended_from` | text | feed column, day one |
| `erp_cancelled_at` | timestamptz | feed column (soft-tombstone), day one |
| `created_at` | timestamptz not null default now() | |

Index `(org_id, push_state)` — **the sweep's hot path**. Unique `(timesheet_id)`. The ERP `name` ↔ PMO id
mapping lives in the shipped **`external_refs`** (`(org_id, 'timesheets', external_record_id)`, 0088).

**RLS (NOT the P3a flip — see §7):** `SELECT` = `org_id = auth_org_id()` **and** the caller may read the
parent sheet (own / line-manager / privileged — the shipped `timesheets_select` audience mirrored via an
`exists`). **No `INSERT`/`UPDATE`/`DELETE` policy for `authenticated` at all** ⇒ default-deny; the service
role bypasses RLS. **Stricter and simpler** than P3a's flip: there is no forward-compat PMO-native writer to
shape for. No `*_native_mirror_guard` trigger is needed — there is no legitimate user UPDATE to column-pin.

### 4.2 `erp_employees` (new — the adopted ERP Employee master + its PMO-user link) ⭐ OQ-TSP-3 ruling

The adopt target. **Machine-written** by the feed (the shipped party-adopt path); the **link** columns are
written **only** by the Admin link RPC (§5.9). **Never** a `profiles` row (§2 non-goals, FR-TSP-093).

| Column | Type | Notes |
|---|---|---|
| `id` | uuid pk | the PMO record id the `external_refs` mapping points at |
| `org_id` | uuid not null | org seam; `stamp_org_id()` |
| `employee_number` | text | ERP `name` (the `HR-EMP-#####` id — display; the mapping lives in `external_refs`) |
| `employee_name` | text | ERP `employee_name` (display) |
| `work_email` | text | the spike-confirmed work-email field (OQ-TSP-1 #9) — **the OQ-TSP-10(C) match candidate**, never authoritative by itself |
| `erp_user_id` | text | ERP `user_id` (the Frappe User link), if it exists/is populated — spike-gated |
| `erp_status` | text | ERP `status` (`Active`/`Left`/…) — mirrored + surfaced; **not** a push gate (OQ-TSP-10(i)) |
| `profile_id` | uuid references `profiles(id)` | **the crux** — the PMO user. Written **only** by the link RPC |
| `link_state` | text not null default `'unlinked'` CHECK (`unlinked\|proposed\|confirmed\|rejected`) | OQ-TSP-10(C). **Only `confirmed` authorizes a push** (FR-TSP-051) |
| `link_proposed_reason` | text | e.g. `work-email-exact-match` — why the adopt proposed it (auditability) |
| `linked_by` | uuid references `profiles(id)` | the confirming Admin (server-resolved, never a payload) |
| `linked_at` | timestamptz | |
| `erp_docstatus` | smallint | feed column, day one (Employee is not submittable — mirrored for uniformity with `mirrorStatusPatch`) |
| `erp_modified` | text | feed column — the per-row source-mod cursor (**the 0103 lesson**: without it the staleness guard never engages — exactly the party-adopt bug found live 2026-07-14) |
| `erp_amended_from` | text | feed column, day one |
| `erp_cancelled_at` | timestamptz | feed column, day one |
| `created_at` | timestamptz not null default now() | |

- Unique **`(org_id, profile_id) where link_state = 'confirmed'`** (a partial unique index) — one PMO user
  has at most one confirmed Employee (OQ-TSP-10(ii) drafted). Index `(org_id, link_state)` (the operator
  queue) + `(org_id, lower(work_email))` (the match probe).
- **RLS:** `SELECT` = `org_id = auth_org_id()` **and** (`auth_role() in ('Admin','Executive','Finance',
  'Project Manager')` **or** `profile_id = auth.uid()` — a user may see **their own** link). **This table
  carries employee names + work emails (PII)** — it is deliberately **not** org-wide readable, unlike
  `companies`. **No `INSERT`/`UPDATE`/`DELETE` policy for `authenticated`** ⇒ default-deny; the feed writes
  as service role and the link is an Admin-only security-definer RPC (§5.9) — **never** a direct table write.

### 4.3 PMO-owned tables — **explicitly unchanged**

`timesheets`, `timesheet_entries`, `save_timesheet_week` (0055), `transition_timesheet` (0007),
`profiles.manager_id` (0007 A1), and every timesheet RLS policy (0002/0007/0011) are **NOT modified by P3b**.
Migrations `0108`/`0109`/`0110` **must not** `alter table timesheets` / `timesheet_entries` / `profiles` in
any way. This is FR-TSP-004(ii) and it has its own pgTAP proof (AC-TSP-004).

### 4.4 Binding config extension (`external_org_bindings.config` jsonb — no schema change)

The shipped per-org connection table (0096; **OD-ENA-SHARED-BINDINGS**: new tiers/domains add **keys**, never
tables) gains **two** `timesheets` keys:

| Key | Type | Default | Purpose |
|---|---|---|---|
| `default_activity_type` | `string \| null` | `null` | ERP `Activity Type` for every pushed row, **if OQ-TSP-1 #1 proves it mandatory**. Null + mandatory ⇒ `commit-rejected` / `activity-type-unconfigured` before any ERP call |
| `timesheet_day_start` | `string` | `'09:00:00'` | the synthetic day start `from_time` packs from (§5.5, OQ-TSP-5) |

`project_map` (shipped, P3a) is **reused unchanged** to resolve each entry's ERP project.
**`employee_map` is REMOVED** (draft-1) — superseded by the OQ-TSP-3 adopt ruling; the resolution is now
`erp_employees.profile_id` + `link_state='confirmed'`. Every config read **merges over defaults in SQL** (the
Luna SF10 lesson: `0107` returned a partial jsonb unchanged, so `{}` made a default-ON key read as `undefined`).

---

## 5. Functional requirements (EARS)

### 5.1 The invariants

- **FR-TSP-004 (ubiquitous — THE INVARIANT, two-part)** —
  **(i)** Where an org does **not** own `timesheets`→`erpnext` (the shipped default for **every** existing
  client), the system shall produce **byte-for-byte identical behavior** to the pre-P3b system: the new
  domain, the **two** new kinds, the two new tables, and the config keys shall introduce **no** write path,
  **no** dispatch hop, **no** push state, and **no** change to P2/P3a behavior — **including for orgs already
  flipped on `companies`/`procurement`/`revenue`** (the new `employee` kind must add **no** doctype to their
  sweep and **no** row to their feed — FR-TSP-094).
  **(ii)** **Even where an org DOES own `timesheets`→`erpnext`**, the PMO timesheet module's behavior
  (`FR-TS-001..010`: the weekly grid, `save_timesheet_week`, `transition_timesheet`'s map/SoD/authz matrix,
  every timesheet RLS policy) shall be **byte-for-byte unchanged**. P3b **adds a consequence to approval; it
  does not change approval.** *(ADR-0059 §3.1; no P3a analogue; §12 R-SOT.)*
- **FR-TSP-005 (cold-start fail-closed routing)** — The routing decision reads the cached own-org ownership
  map (P2 FR-ENA-005 lifecycle). An absent/not-yet-loaded map **defaults to `pmo`** ⇒ **no push** (the sheet
  approves exactly as today; the sweep pushes later if the org is in fact flipped and the map was merely
  cold). A push routes to `erpnext` only when the map is loaded and positively asserts `timesheets`→`erpnext`.
  *(The fail-closed direction is **benign** here, unlike `revenue`: cold ⇒ the approval still succeeds —
  there is no user-facing failure to fail closed **into**. A `*-not-enabled` rejection here would be a
  regression for every client.)*
- **FR-TSP-006 (approval never depends on ERP liveness)** — While `timesheets` is externally-owned, a push
  failure of **any** class (unreachable, rejected, unlinked, held) shall **never** fail, block, roll back, or
  retry-loop the PMO approval: `transition_timesheet` commits first and independently; the push is a
  subsequent command whose failure is recorded (`push_state='failed'` + `push_error`) and surfaced.
  **The user's approval always succeeds.** *(ADR-0059 §3.2; NFR-TSP-AVAIL-001.)*

### 5.2 The Approved-only gate (the owner ruling, enforced server-side)

- **FR-TSP-010 (Approved is a SERVER-side precondition, re-asserted before any ERP work)** — When a
  `timesheets` command reaches the served `adapter-dispatch`, the dispatch shall **re-read the sheet's
  `status` from the database under the caller's own JWT** (the deputy `callerClient` — RLS-scoped, never
  `service_role`) and reject anything other than `'Approved'` with `commit-rejected` /
  `timesheet-not-approved` (`422`) **before** adapter selection, **before** any outbox row, and **before**
  any ERP call. The payload is **never** trusted to assert approved-ness. *(ADR-0059 §3.3; the Luna BLOCK-4
  lesson applied to P3b's central invariant. A Draft/Submitted/Rejected sheet is structurally incapable of
  reaching ERP, no matter what a hand-crafted command claims.)*
- **FR-TSP-011 (push authorization)** — A `timesheets` push shall be authorized only for: the sheet's
  **`approved_by`** actor; **or** a caller with role `Admin`/`Executive`/`Project Manager`/`Finance`; **or**
  the server-side sweep (service role, no user JWT). Any other active member → `commit-rejected` /
  `not-authorized` (`403`). **The generic `MONEY_WRITE_ROLES` set MUST NOT be reused as the sole rule:** a
  legitimate approver may be an **`Engineer`-role line manager** (`profiles.manager_id`, the `0007` A2/A4
  matrix) who is **not** in that set — reusing it verbatim would break the primary approval path. *(This FR
  exists because the obvious code reuse is wrong.)*
- **FR-TSP-012 (kind↔domain enforcement)** — `KIND_DOMAIN['timesheet'] = 'timesheets'` and
  `KIND_DOMAIN['employee'] = 'timesheets'` shall be registered so the shipped
  `checkErpnextCommandAuthorization` check (c) rejects a cross-domain command (`domain:'procurement'` +
  `erp_doc_kind:'timesheet'`; `domain:'timesheets'` + `erp_doc_kind:'incoming-payment'`) with `422` before
  any ERP write. **Additionally, `employee` is `readOnly` ⇒ any *write* command carrying it shall be rejected
  `422`** (`employee-is-read-only`) — the adopt is inbound-only (FR-TSP-093). *(Luna BLOCK-4.)*
- **FR-TSP-013 (target binding — no client-supplied ERP target)** — A `timesheets` command shall **never**
  accept a client-supplied `externalRecordId`. The dispatch resolves the ERP target **solely** from
  `external_refs(org_id, 'timesheets', record.id)`. The shipped `checkTransitionTargetBinding` shall be
  extended additively (an applicability allow-list keyed on `(domain, kind)`); the existing
  `revenue`/`sales-invoice` behavior is unchanged. *(Luna BLOCK-3.)*
- **FR-TSP-014 (no NULL-actor no-op)** — Every server-written actor/witness column
  (`timesheet_erp_mirror.approved_at_pushed`, `pushed_at`; `erp_employees.linked_by`) shall be written from
  **server-resolved** values (the dispatch's verified `sub`; the DB's `timesheets.approved_at`; `auth.uid()`
  inside the link RPC), never from the command payload; a path that cannot resolve them **fails** rather than
  writing `NULL`. *(ADR-0059 §6; Luna BLOCK-4's "finalized with `author_user_id = NULL`, making SoD a
  no-op". The sweep's service-role path MUST take the same route — §12 R-SWEEP.)*

### 5.3 Idempotency + post-commit safety (ADR-0058 verbatim + the ADR-0059 §4 delta)

- **FR-TSP-040** — Every non-read-only `timesheets` command shall carry an `idempotencyKey` and ride the
  `external_command_outbox` + atomic recovery **verbatim** (ADR-0058 §§1–4): the `claim_outbox_for_commit`
  atomic claim, the `claim_generation` fencing token, and the fenced `record_outbox_ref`/`confirm_outbox`
  finalization (H-1) all apply unchanged. Two concurrent pushers cannot both POST; a superseded claimant's
  write-backs are 0-row no-ops.
- **FR-TSP-041 (the DETERMINISTIC key — the Posture-B delta)** — Unlike every P2/P3a command
  (client-minted `freshIdempotencyKey()`), a timesheet push key shall be **derived** as
  `'ts:' || timesheet_id || ':' || approved_at` (the `approved_at` the gate read, ISO-8601). **Rationale
  (binding, ADR-0059 §4):** the push has **two** legitimate independent originators — the synchronous approve
  path and the sweep backstop — with **no shared client state**. A fresh random key per attempt would make
  the outbox's unique 4-tuple **useless for exactly the collision it exists to prevent**: sweep + user racing
  → **two ERP Timesheets = a duplicated week of hours**. With the derived key the second originator fails
  atomically (`23505`) and reconciles to the winner (FR-TSP-044). Including `approved_at` keeps a
  hypothetical future re-approval (OQ-TSP-6(b)) a *different* command, not a silently-suppressed one.
- **FR-TSP-042 (anchor + reissue policy)** — The `timesheet` registry entry's `anchorField`/`anchorMutable`/
  `neverReissue` are the **OQ-TSP-1 #2 spike outcome** under the **OQ-TSP-2 ruling**: a surviving PMO-owned
  anchor ⇒ `anchorMutable:false` (reissue-capable, the PI twin); **no surviving anchor** ⇒
  `anchorField:null` **+ `neverReissue:true`** ⇒ a post-window inconclusive recovery is **`held`**, never
  auto-reissued. `reissueOnInconclusiveAbsence` becomes `!(entry.anchorMutable || entry.neverReissue)`.
- **FR-TSP-043 (additive registry semantics)** — `neverReissue` shall be **optional and default-absent** on
  `DoctypeEntry`, so every shipped kind's recovery behavior is **byte-for-byte** (NFR-TSP-REG-001).
- **FR-TSP-044 (no blind retry)** — The client shall **never** blindly retry a non-idempotent Timesheet POST
  on a retryable transport failure or a `500` bucket; a retry is permitted only through the guarded recovery
  algorithm (ADR-0058 §4 state table: `confirmed`→return; `committed`→fenced finalize; `committing`(fresh)→
  wait; `committing`(stale)→**quarantine**; `quarantined`→post-window claim→probe→adopt/reissue-or-hold per
  FR-TSP-042; `held`→terminal until operator).
- **FR-TSP-045 (the sweep backstop)** — While an org owns `timesheets`→`erpnext`, the `erpnext-sweep` shall,
  each tick, select `timesheets` rows with `status='Approved'` whose `timesheet_erp_mirror` is absent or
  `push_state in ('pending','failed')` **and not tombstoned**, and re-drive the push under the **same
  deterministic key** and the **same server-side Approved gate** (FR-TSP-010 re-asserted, not skipped because
  "the sweep is trusted"), bounded per tick (NFR-TSP-PERF-001). `push_state='held'`/`'pushed'` are **never**
  re-driven; `'pushing'` only via the ADR-0058 stale-claim path, never a naive re-POST.

### 5.4 Reference resolution — fail-closed, BEFORE the ERP write

- **FR-TSP-050 (pre-flight ordering — the Luna BLOCK-6 lesson)** — All of: `status='Approved'` (FR-TSP-010),
  the caller's authorization (FR-TSP-011/012), the **employee link** (FR-TSP-051), the **project** resolution
  for **every** entry (FR-TSP-052), the **activity type** (FR-TSP-053), the **same-org assertion** for the
  sheet, every entry's project, and the resolved Employee (FR-TSP-054), and the **daily-hours
  pre-validation** (FR-TSP-055) shall be resolved and validated **BEFORE** the outbox claim and **BEFORE**
  the ERP POST. *(Luna BLOCK-6: "cross-org validation happens after the external write… leaving committed
  money with no PMO row." The P3b twin is committed **hours** with no PMO push record — same class, fixed by
  **ordering**, not by a later rejection.)*
- **FR-TSP-051 (employee — via the CONFIRMED adopt link; fail-closed)** — The ERP `employee` shall be
  resolved as: the `erp_employees` row where `profile_id = timesheets.user_id` **and**
  `link_state = 'confirmed'` **and** `org_id` = the caller's org → its `external_refs`-mapped ERP `name`.
  **Any other state — no adopted Employee, `link_state in ('unlinked','proposed','rejected')`, or an
  unmapped ref — is `commit-rejected` / `employee-unlinked` BEFORE any ERP call**; the push is **never**
  attempted without a confirmed link and **never** falls back to a default/shared Employee (which would
  mis-attribute cost). `push_state='failed'` + an `action-required` operator surface naming the author
  (FR-TSP-085). The sweep re-drives it automatically once an Admin confirms the link (FR-TSP-045) — **the
  approved sheet is never lost, only pending**. *(OQ-TSP-3 ruling + OQ-TSP-10(C).)*
- **FR-TSP-052 (project — fail-closed, NOT silently omitted)** — Each `time_logs[]` row's ERP `project` shall
  be resolved from `binding.config.project_map[timesheet_entries.project_id]`. An **absent** mapping →
  `commit-rejected` / `project-unmapped` **before any ERP call** — the row is **never** sent without its
  project dimension. *(Luna SF9 exactly: "a missing `project_map` entry yields `ctx.refs.project=null`… PMO
  shows project-attributed cost while ERP GL lacks the project dimension." Closed at the boundary, not in the
  body builder.)*
- **FR-TSP-053 (activity type — fail-closed if mandatory)** — Where OQ-TSP-1 #1 proves `activity_type`
  mandatory and `default_activity_type` is null → `commit-rejected` / `activity-type-unconfigured` before any
  ERP call.
- **FR-TSP-054 (same-org pre-flight)** — Before the ERP write, the dispatch shall assert
  `timesheets.org_id` = the caller's org, that **every** entry's `project.org_id` = the caller's org, and
  that the resolved `erp_employees.org_id` = the caller's org; a violation → `cross-org-link-rejected`
  (`422`), no ERP call. *(Luna BLOCK-6.)*
- **FR-TSP-055 (daily-hours pre-validation)** — Before the ERP write, the dispatch shall reject a sheet whose
  entries **sum > 24 hours on any single `entry_date`** with `commit-rejected` / `daily-hours-exceed-24`.
  *(PMO caps a single entry at `hours <= 24` (0001 CHECK) but **does not cap the daily total across
  projects** — 3 projects × 10h on one day is a legal PMO sheet. §5.5's sequential packing would spill
  `from_time` into the **next day**, silently mis-dating hours, and/or trip ERP's overlap validation.
  P3b-specific; no P2/P3a analogue.)*
- **FR-TSP-056 (empty sheet)** — An approved sheet with **zero** entries, or whose entries all have
  `hours = 0`, shall be **skipped, not pushed**: `push_state='pushed'` with `ts_number = null` and no ERP
  call. This is a success, not a failure — it must not sit in the sweep's retry queue forever.

### 5.5 The push command — create + submit

- **FR-TSP-060 (one ERP Timesheet per PMO week)** — An approved PMO weekly `timesheets` row maps to exactly
  **one** ERP `Timesheet`, whose `time_logs[]` are that sheet's `timesheet_entries` (one row per non-zero
  `(project_id, entry_date, hours)`).
- **FR-TSP-061 (submit-on-create is CORRECT here — do not "fix" it)** — The `timesheet` kind ships
  `submitOnCreate: true`: a push performs the R9 two-step `POST` insert → `PUT {docstatus:1}` submit →
  **re-fetch** (never trusting a stale POST/PUT body — R9 §5). **This is deliberately the opposite of
  `sales-invoice`'s `submitOnCreate:false`** (OD-SAR-DRAFT-SUBMIT), and the reasoning does **not** transfer:
  OD-SAR-DRAFT-SUBMIT exists because an SI's *only* approval gate was the ERP submit, so create+submit let
  the author approve their own invoice. A timesheet's gate is **`transition_timesheet`'s SoD, already passed,
  in PMO, by a different actor** (`0007` A4) — ERP submit is the **mechanical consequence**, not a second
  gate. Leaving an ERP draft would mean approved hours never reach costing, which is the entire point of the
  issue. *(Stated as an FR so a reviewer pattern-matching on P3a does not "correct" it.)*
- **FR-TSP-062 (synthetic time packing)** — PMO stores `entry_date` + `hours` and **no clock times**; ERP's
  `time_logs[]` needs `from_time` (per OQ-TSP-1 #1). The adapter shall synthesize times
  **deterministically**: for each `entry_date`, order that date's entries by `project_id` (a stable, total
  order — never hash/object-key order), start at `binding.config.timesheet_day_start` (default `'09:00:00'`),
  and pack each row **sequentially, non-overlapping**: row *n*'s `from_time` = row *n−1*'s `from_time` + row
  *n−1*'s `hours`. The same input shall always produce the same body (a re-push after a `committed`-state
  recovery must be **byte-identical** or the probe/adopt logic cannot match). *(Overlap behavior is OQ-TSP-1
  #3; the >24h spill is prevented by FR-TSP-055.)*
- **FR-TSP-063 (naive site-local datetimes)** — `from_time` (and `to_time`, if OQ-TSP-1 #1 proves it
  required) shall be transmitted as **naive** `'YYYY-MM-DD HH:MM:SS'` strings, **never** a UTC/`Z`-suffixed
  ISO instant, and never passed through a JS `Date` timezone conversion. *(OQ-TSP-5 — **open**.)*
- **FR-TSP-064 (the body map is the spike's, not this spec's)** — `bodies/timesheet.ts`'s `toBody`/`fromDoc`
  shall implement the **OQ-TSP-1 frozen map verbatim**. This spec pins the **contract** (one doc per week;
  employee/project/activity resolved server-side and fail-closed; deterministic packing; naive datetimes;
  hours as decimal strings; **no billing fields — OQ-TSP-4 ruled them out**) — **not** the field list.
  **A builder MUST NOT invent field names.**
- **FR-TSP-065 (error classification)** — The shipped classifier (P2 FR-ENA-013) applies unchanged:
  `MandatoryError`/`ValidationError`/`DoesNotExistError`/`LinkExistsError`/`UpdateAfterSubmitError` →
  `commit-rejected`; an unguarded `500 TypeError` (if OQ-TSP-1 #7 finds one) → the **distinct non-retryable
  bucket**, never blind-retried; network/timeout/5xx-after-budget → `external-unreachable` (⇒ the sweep
  re-drives it). No new classifier branch is expected; the spike confirms.

### 5.6 Amount/hours transport + mirror-write shape

- **FR-TSP-070 (decimal-string transport)** — Every hours/rate/amount value shall cross the `timesheets`
  command path as a **decimal string** end-to-end; **no** such value passes through JS float math. *(P2
  FR-ENA-070 verbatim. `7.5 + 8.25` float drift on a `numeric(5,2)` hours column is the same class of defect
  as money drift and, once costed, **is** money.)*
- **FR-TSP-071 (the read-back oracle)** — `erp_total_hours`/`erp_total_costing_amount` shall mirror ERP's
  **server-computed** `total_hours`/`total_costing_amount` **verbatim**; PMO shall **never** recompute or
  reconcile them from `timesheet_entries` (ADR-0048, ADR-0059 §8). A divergence between PMO's summed hours
  and ERP's `total_hours` is a **reportable signal**, never a silent local correction.
- **FR-TSP-072 (full-row upsert; never the SoT table)** — Inbound ERP changes apply as full-row upserts on
  `timesheet_erp_mirror` / `erp_employees` (idempotent re-apply, no PMO recomputation) and shall **never**
  write to `timesheets`/`timesheet_entries`/`profiles`.

### 5.7 Change feed — lifecycle only for `timesheet`; NEVER adopt a process doc

- **FR-TSP-080 (reuse the engine)** — The P2 change-feed engine (`erpnext-webhook` HMAC ingress +
  modified-poll sweep) applies to both new kinds with **no engine change**: `feedKinds.ts` gains
  `KIND_DOMAIN['timesheet'|'employee']='timesheets'` and
  `KIND_MIRROR_TABLE['timesheet']='timesheet_erp_mirror'` / `['employee']='erp_employees'`. `Timesheet` and
  `Employee` are **unique** doctypes → no `payment_type`-style disambiguation (contrast FR-SAR-081).
- **FR-TSP-081 (webhook signature is the trust boundary)** — Inbound Timesheet/Employee webhooks are verified
  `X-Frappe-Webhook-Signature = base64(HMAC-SHA256(secret, raw_body))` before any side effect;
  absent/invalid → `401`, no side effect. (P2 FR-ENA-082.)
- **FR-TSP-082 (NEVER adopt a native Timesheet — the SoT-inversion guard)** — When an inbound **Timesheet**
  event arrives whose ERP `name` has **no** `external_refs(org,'timesheets',…)` mapping (created natively in
  the Desk), the feed shall **ack-and-skip** it — minting **no** `timesheets` row, **no** `timesheet_entries`,
  **no** `timesheet_erp_mirror` row — and surface an **`action-required`** operator task naming the ERP doc.
  *(ADR-0059 §5. Adoption would mint PMO hours that never passed PMO approval, inverting the owner's ruling.
  The exact inverse of P3a's FR-SAR-085, and the difference is deliberate: there ERP was SoT and adoption was
  correct. This also closes the Luna BLOCK-7 class — "inbound adoption loses links" — by removing the path.
  **The `employee` kind is the licensed exception: master data, not a process document — §5.9.**)*
- **FR-TSP-083 (lifecycle stamping for PMO-originated docs)** — For a Timesheet **with** an `external_refs`
  mapping, the feed shall stamp `erp_docstatus`/`erp_modified`/`erp_amended_from`/`erp_cancelled_at` +
  `erp_total_hours`/`erp_total_costing_amount` on `timesheet_erp_mirror` **only**, guarded by the per-row
  `erp_modified` monotonic comparison (a stale/out-of-order older event is a **no-op**).
- **FR-TSP-084 (desk cancel → tombstone + reopen; never fight the accountant)** — When ERPNext cancels a
  pushed Timesheet (`docstatus 2`), the feed shall soft-tombstone the mirror (`erp_cancelled_at`,
  `erp_docstatus=2`), write an `external_ref_lineage` row (`reason='cancelled'`), retain `external_refs`, and
  set `push_state='failed'` + an `action-required` surface — it shall **NOT** re-push (the sweep would
  instantly re-create what a human just cancelled: an infinite fight). The PMO `timesheets` row is
  **untouched** (still `Approved` — PMO's approval is not ERP's to revoke). *(ADR-0059 §5 corollary;
  resolution is the OQ-TSP-6 correction path — **open**.)*
- **FR-TSP-085 (operator surface)** — `push_state in ('failed','held')` and every `action-required` case
  (unlinked employee, unmapped project, unconfigured activity type, native-doc skip, desk cancel, a
  proposed/ambiguous Employee link) shall be visible to an Admin with the classified reason. *(ADR-0059 §6:
  a push failure that is invisible is indistinguishable from a push that never happened — the sheet is
  already Approved, so **nothing else will surface it**.)*

### 5.9 ⭐ The Employee-adopt sub-domain (the OQ-TSP-3 ruling)

> **Licensed by ADR-0059 §5's master-data exception:** the never-adopt rule governs a Posture-B domain's
> **process documents** (`Timesheet`), **not** the masters it references. PMO is not the `Employee`'s SoT and
> no PMO process is bypassed by mirroring one — so it adopts **normally**, through the **shipped party-adopt
> path**.

- **FR-TSP-090 (reuse the party-adopt mechanism — do NOT invent a second one)** — The `employee` kind's
  inbound adopt shall use the **existing** machinery, extended additively:
  `_shared/erpnextFeedDeps.ts`'s **`mintMirror`** (the same function that mints a `companies` row for a
  natively-created `Supplier`/`Customer` — a new `domain === 'timesheets'` branch beside the shipped
  `companies`/`revenue` branches), `findPmoRecordId`/`recordExternalRef`
  (`external_refs(org,'timesheets','Employee:<erp name>')`), `mirrorStatusPatch` for lifecycle, the
  `erp_modified` per-row staleness guard, the **same** webhook (HMAC) + **same** modified-poll sweep, and the
  **same** `externalIdForKind` prefix convention (`'Employee:<name>'` — mirroring `'Supplier:'`/`'Customer:'`,
  so the encoding is deterministic and collision-free within the domain). **No new adopt function, no new
  feed engine, no new sweep, no new refs table.** *(The party adopt already learned the 0103/`erp_modified`
  lesson the hard way — inherit it, do not re-learn it: the adopt MUST mint the **full** canonical + the
  `erp_modified` stamp, never a half-empty name-only row, or the staleness guard never engages.)*
- **FR-TSP-091 (adopt trigger + backfill)** — The adopt shall be driven by **both** shipped triggers, with no
  new mechanism: the **modified-poll sweep** (the convergence authority — a new `(org, 'Employee')` cursor on
  `external_sync_watermarks`, whose first tick after the flip **backfills every existing Employee**, because
  the cursor starts at zero) and the **webhook** (a lossy hint; the sweep re-surfaces anything missed).
  *(No separate "import" job exists or is needed — the backfill **is** the sweep's first tick.)*
- **FR-TSP-092 (the PMO-user link — adopt-then-confirm; OQ-TSP-10(C), OPEN)** — The adopt shall **never**
  auto-link. On mint/update it shall:
  1. mint/update the `erp_employees` row (`employee_number`/`employee_name`/`work_email`/`erp_user_id`/
     `erp_status` + the `erp_*` feed columns), leaving `link_state` **unchanged** for an existing row;
  2. for an **unlinked** row, attempt exactly one **match probe** — an **exact, case-insensitive** comparison
     of the spike-confirmed work-email field (OQ-TSP-1 #9) against the PMO user's auth email — and, on a
     **unique** hit, set `link_state='proposed'`, `profile_id=<the match>`,
     `link_proposed_reason='work-email-exact-match'`;
  3. on **zero** or **multiple** hits, leave `link_state='unlinked'`, `profile_id=null`, and surface
     `action-required` *(the party adopt's ambiguous-match precedent: **surface, never auto-resolve**)*;
  4. **never** promote a `proposed`/`rejected` row to `confirmed`, and **never** silently re-point a
     `confirmed` row when the ERP-side email changes — such a change surfaces `action-required` and the
     confirmed link **stands** *(the OQ-TSP-10(C) security property: an ERP-side edit can propose, never
     re-point)*.
  **Only an Admin may confirm**, via a **security-definer RPC**
  `confirm_erp_employee_link(p_erp_employee_id, p_profile_id)` that internally re-asserts org + `Admin` role
  (DEFINER bypasses RLS — the ADR-0011/0012 lesson), enforces `unique (org_id, profile_id) where
  link_state='confirmed'`, stamps `linked_by = auth.uid()` + `linked_at` (server-resolved, FR-TSP-014), and
  writes an `audit_events` row. A direct table write is impossible (§4.2 default-deny).
  **`link_state='confirmed'` is the ONLY state that authorizes a push** (FR-TSP-051).
- **FR-TSP-093 (adopt NEVER mints a PMO identity — read-only master)** — The `employee` kind is
  `readOnly: true`: PMO shall **never** create, update, or delete an ERP `Employee`, and the adopt shall
  **never** insert a `profiles` row, an auth user, or a login. An adopted Employee with no matching PMO user
  is a **legitimate terminal state** (`link_state='unlinked'` — e.g. a contractor or a non-PMO employee) —
  it is surfaced, not provisioned. *(Auto-provisioning logins from an ERP-controlled master would be a
  privilege-escalation surface, not a convenience.)*
- **FR-TSP-094 (domain placement — `timesheets`, NOT `companies`)** — Both new kinds live in the
  **`timesheets`** domain. **The `employee` kind must NOT be placed in `companies`**: that domain is
  **already flipped for existing orgs**, and adding an `Employee` doctype to its sweep + feed would change
  their behavior — a direct **FR-ENA-004 / FR-TSP-004(i) violation** (new sweep calls, new rows, a new PII
  table populated for orgs that never asked for timesheets). The timesheets flip must **bring its own
  master**: an org owning `companies` but not `timesheets` sees **no** Employee traffic whatsoever.
- **FR-TSP-095 (Employee lifecycle + PII posture)** — An ERP-side `status='Left'` is **mirrored** to
  `erp_status` and surfaced, but shall **not** revoke a `confirmed` link and shall **not** block a push
  (historic weeks must stay pushable — OQ-TSP-10(i) drafted). `erp_employees` holds names + work emails
  (**PII**): its `SELECT` is restricted to privileged roles + the subject themselves (§4.2), it is **never**
  org-wide readable, and the adopt shall mirror **only** the fields §4.2 names — never salary, bank, national
  id, or any other HR field the doctype may carry. *(Minimum-necessary: the adapter reads a wide doctype; it
  must not mirror a wide row.)*

### 5.8 Authorization + tenancy

- **FR-TSP-170 (machine-only ERP state)** — `timesheet_erp_mirror` and `erp_employees` shall be writable
  **only** by the service role (§4: no `authenticated` INSERT/UPDATE/DELETE policy ⇒ default-deny) or, for
  the link columns, the Admin security-definer RPC (FR-TSP-092). A user JWT attempting any direct write →
  RLS denial. No `GENERATED` column, no derived trigger ⇒ no service-role bypass need.
- **FR-TSP-171 (read audience parity)** — A caller may `SELECT` a `timesheet_erp_mirror` row **only if** they
  may `SELECT` its parent `timesheets` row (own / line-manager / `Admin,Executive,Project Manager,Finance` —
  the shipped `timesheets_select` audience). `erp_employees` is readable by privileged roles + the subject
  (`profile_id = auth.uid()`) only (§4.2, PII). The ERP state of a sheet is never more visible than the sheet.
- **FR-TSP-172 (org seam)** — `org_id` is stamped by `stamp_org_id()` (0074) and **never threaded from the
  client**; every read is org-isolated; the adapter contract never carries `org_id` (NFR-TSP-CONTRACT-001).
- **FR-TSP-173 (reads come from PMO)** — Every timesheet read in the UI (the grid, the approval queue) reads
  the **PMO** tables, unchanged; the ERP read-back (`erp_total_hours`, `push_state`) is **supplementary
  display** only and shall never be required to render the module (⇒ an ERP outage degrades a badge, never
  the timesheet page).

---

## 6. Non-functional requirements

- **NFR-TSP-REG-001 (additive registry)** — The `neverReissue` flag and the `timesheet`/`employee` registry/
  body/feed entries shall be additive; no existing entry is edited; every shipped kind's recovery behavior is
  byte-for-byte (AC-TSP-002).
- **NFR-TSP-IDEM-001 (no duplicate week)** — Under any interleaving of {user approve-push, sweep tick, retry,
  crash-after-commit-before-mirror}, at most **one** ERP Timesheet shall exist per `(timesheet_id,
  approved_at)`. Proven at the real served boundary with the shipped `after-commit-before-mirror` fault seam.
- **NFR-TSP-AVAIL-001 (approval independence)** — The p99 of `transition_timesheet`→`Approved` shall be
  unchanged by P3b for a flipped org (the push is not in the approval's critical transaction), and an ERP
  outage shall not raise the approval's error rate above the pre-P3b baseline. *(FR-TSP-006.)*
- **NFR-TSP-PERF-001 (sweep bounded)** — The backstop's candidate query shall be index-served by
  `timesheet_erp_mirror (org_id, push_state)` + `timesheets (org_id, status)` (shipped, 0001) and bounded per
  tick, so a 10k-employee org's history is never table-scanned per tick and one org's backlog cannot starve
  another's. The Employee sweep is likewise cursor-bounded (`external_sync_watermarks`).
- **NFR-TSP-SEC-001 (secret confinement)** — ERP credentials resolve **only** via
  `erpnext/credentials.ts::resolveErpCredentials(secretRef, getEnv)` with the injected getter
  (**OD-ENA-VAULT-SEAM**) — no new secret path.
- **NFR-TSP-SEC-002 (PII minimization)** — `erp_employees` mirrors **only** the §4.2 field set; no salary,
  bank, national-id, or other HR field is read into PMO, and its read audience is privileged roles + the
  subject (FR-TSP-095, FR-TSP-171).
- **NFR-TSP-CONTRACT-001 (vocabulary confinement)** — Frappe vocabulary (`Timesheet`, `Employee`,
  `time_logs`, `activity_type`, `from_time`, `docstatus`, `/api/resource`) lives **only** under
  `pmo-portal/src/lib/adapterSeam/erpnext/**` + the ERPNext edge functions. What crosses the contract is the
  PMO domain `timesheets` + the kinds `timesheet`/`employee` (PMO verbs).
- **NFR-TSP-MONEY-001 (decimal transport)** — No hours/rate/amount value crosses P3b's path through JS float
  math (FR-TSP-070).
- **NFR-TSP-TEST-001 (real boundary)** — Every push e2e exercises the **real served `adapter-dispatch`** and
  the named server-side fault seams; `page.route` is prohibited in a P3b push e2e.
- **NFR-TSP-REV-001 (reversibility)** — P3b is reversed by `drop table public.timesheet_erp_mirror` +
  `drop table public.erp_employees` + removing the ownership row; **no PMO data is lost** because P3b writes
  none into PMO's SoT tables. *(ADR-0059's Posture-B property; P3a's flip does not have it.)*

---

## 7. Authorization model (why P3b's is NOT P3a's)

| | P3a (`revenue`) | **P3b (`timesheets`)** |
|---|---|---|
| PMO table posture | flipped: user INSERT → `42501` | **unflipped, untouched** — users still author + approve |
| ERP-state tables | the mirror itself, per-command flip RLS + `*_native_mirror_guard` | **side** tables, **default-deny** (no `authenticated` write policy at all) |
| The gate | `submit_sales_invoice` SoD RPC (approver≠author) + `can()` UX | **`transition_timesheet`'s shipped SoD** — **already the authority; P3b adds nothing** |
| Dispatch re-assertion | `sodGuard.ts` (re-run the SoD RPC under the caller's JWT) | **`approvalGuard.ts`** (re-read `status='Approved'` under the caller's JWT) — FR-TSP-010 |
| Role set | `MONEY_WRITE_ROLES` | **NOT `MONEY_WRITE_ROLES` alone** — `approved_by` OR privileged OR sweep (FR-TSP-011): an Engineer line-manager is a legitimate approver |
| Master-data write | party create/update (P2) | **none** — `employee` is `readOnly`; the only PMO-side write is the **Admin link RPC** (FR-TSP-092) |

**RLS remains the enforcement authority** (ADR-0016); `can()` is UX only. P3b introduces exactly **two** new
authorities: `approvalGuard.ts` (deliberately a **read-and-compare of DB truth** — no new rule to get wrong,
only an existing rule re-asserted at the boundary) and `confirm_erp_employee_link` (an Admin-only
security-definer RPC in the ADR-0011/0012 pattern).

---

## 8. Acceptance criteria (Given/When/Then)

### The invariants

- **AC-TSP-001** — A non-`timesheets` org never pushes; the approval is unchanged. **[unit]**
  **Given** a **cold/absent** ownership map and separately an org that does not own `timesheets`→`erpnext`,
  **When** a user approves a timesheet,
  **Then** `transition_timesheet` succeeds exactly as pre-P3b, **no** `dispatchDomainCommand` is called,
  **no** outbox row is created, **no** `timesheet_erp_mirror` row is minted, and **the approval resolves
  successfully** (never a `*-not-enabled` rejection). (FR-TSP-004(i), FR-TSP-005)
- **AC-TSP-002** — Zero regression. **Cross-layer gate:** the unchanged P2+P3a suite (`npm run verify` + full
  pgTAP + `e2e/serial/AC-ENA-*` + `AC-SAR-*`) staying green **is** the proof (mirrors AC-ENA-002/AC-SAR-002);
  no single new test owns it. In particular every existing kind's recovery behavior is unchanged by the
  additive `neverReissue` flag. (FR-TSP-004(i), FR-TSP-043, NFR-TSP-REG-001)
- **AC-TSP-003** — **An org flipped on `companies`/`procurement`/`revenue` but NOT `timesheets` sees zero
  Employee traffic.** **[unit]**
  **Given** an org owning `companies`→`erpnext` (P2's shipped state) and **not** `timesheets`,
  **When** the sweep ticks and a webhook for an ERP `Employee` arrives,
  **Then** the sweep issues **no** `Employee` doctype call, the webhook ack-and-skips with **no** side
  effect, **no** `erp_employees` row exists, and the org's `companies` feed behavior is byte-for-byte.
  (FR-TSP-004(i), FR-TSP-094)
- **AC-TSP-004** — **The PMO timesheet module is byte-for-byte on a FLIPPED org.** **[pgTAP]**
  **Given** an org that **does** own `timesheets`→`erpnext`,
  **When** the shipped timesheet suite's behaviors are exercised (own-row RLS, entry `WITH CHECK`, the
  manager read-widening, `save_timesheet_week`'s atomicity + tenancy guards, `transition_timesheet`'s map
  legality, SoD, and authz matrix — the assertions of pgTAP `0007/0011/0021..0026/0046..0049/0106`),
  **Then** every one behaves **identically to an unflipped org**, and `information_schema` confirms
  migrations `0108`/`0109`/`0110` added **no** column, policy, or trigger to
  `timesheets`/`timesheet_entries`/`profiles`. (FR-TSP-004(ii), §4.3) *(§12 R-SOT.)*

### The Approved-only gate (the owner's ruling — the headline ACs)

- **AC-TSP-010** — **A non-Approved sheet NEVER reaches ERP, whatever the command claims.** **[served-fn e2e]**
  **Given** an org owning `timesheets`→`erpnext` and sheets in `Draft`, `Submitted`, and `Rejected`,
  **When** a hand-crafted command is POSTed **directly** to the served `adapter-dispatch` for each —
  including one whose payload asserts `status:'Approved'` and one carrying a forged `approved_by` —
  **Then** each is rejected `422` `commit-rejected` / `timesheet-not-approved`, **no** ERP HTTP request is
  issued (asserted against the bench's Timesheet count), **no** `external_command_outbox` row is created, and
  **no** `timesheet_erp_mirror` row is minted. (FR-TSP-010, FR-TSP-014)
- **AC-TSP-011** — Approval pushes; the ERP doc lands submitted with hours + project. **[served-fn e2e]**
  **Given** the OQ-TSP-1 spike frozen, an org owning `timesheets`→`erpnext`, a **confirmed** `erp_employees`
  link for the author, `project_map` entries, and a `Submitted` sheet with entries across two projects and
  two days,
  **When** the line manager approves it in the app,
  **Then** `transition_timesheet` sets `Approved`, the push commits an ERP `Timesheet` (insert →
  `PUT {docstatus:1}` → re-fetch) whose `time_logs` carry the resolved employee/projects and non-overlapping
  synthetic times **and no billing fields**, `external_refs('timesheets')` records the mapping,
  `timesheet_erp_mirror` shows `push_state='pushed'` + `ts_number` + the mirrored `erp_total_hours`, and
  **no** `page.route` is used. (FR-TSP-060..064, FR-TSP-071)
- **AC-TSP-012** — Push authorization: the approver may push; a bystander may not; an Engineer line-manager
  **may**. **[pgTAP]**
  **Given** an approved sheet whose `approved_by` is an **`Engineer`**-role line manager, and separately an
  active `Engineer` bystander who is not the manager,
  **When** each dispatches the push,
  **Then** the line-manager/approver is **permitted** (proving `MONEY_WRITE_ROLES` alone is not the rule) and
  the bystander is rejected `42501` with no ERP call. (FR-TSP-011)
- **AC-TSP-013** — Kind↔domain, read-only-kind, and target binding are enforced. **[unit]**
  **Given** commands with `domain:'timesheets'` + `erp_doc_kind:'incoming-payment'`; `domain:'procurement'` +
  `erp_doc_kind:'timesheet'`; a **write** command carrying `erp_doc_kind:'employee'`; and a `timesheets`
  command carrying a client-supplied `externalRecordId`,
  **When** each reaches the dispatch,
  **Then** each is rejected `422` before any ERP call (`employee-is-read-only` for the third), and the ERP
  target is resolved **solely** from `external_refs`. (FR-TSP-012, FR-TSP-013, FR-TSP-093)

### Idempotency + recovery

- **AC-TSP-020** — **The sweep and the user cannot both create a Timesheet.** **[served-fn e2e]**
  **Given** an approved sheet and the `after-commit-before-mirror` fault seam armed,
  **When** the sweep tick and a user-triggered re-push both run,
  **Then** the deterministic key `'ts:<id>:<approved_at>'` makes the second attempt fail atomically
  (`23505`) or reconcile via the outbox `committed` fenced finalize; **exactly one** ERP Timesheet exists for
  the sheet (asserted by an ERP list query — **the ERP is the oracle, not PMO state**);
  `timesheet_erp_mirror` shows `push_state='pushed'` with the winner's `ts_number`. (FR-TSP-040/041/044/045,
  NFR-TSP-IDEM-001)
- **AC-TSP-021** — Inconclusive post-window recovery is `held`, never a duplicated week. **[unit]**
  **Given** the `timesheet` registry entry as frozen by OQ-TSP-1 #2 under the OQ-TSP-2 ruling, and a
  post-window recovery whose probe is inconclusive (or skipped because `anchorField` is null),
  **When** the recovery algorithm resolves,
  **Then** `reissueOnInconclusiveAbsence` is **false** and the outbox row goes **`held`** — **never**
  auto-reissued; **and** an existing kind (`purchase-invoice`, `payment`) through the same code path retains
  its **exact** shipped behavior. (FR-TSP-042, FR-TSP-043)
- **AC-TSP-022** — The sweep re-drives an approved-but-unpushed sheet and never re-drives a settled one.
  **[served-fn e2e]**
  **Given** approved sheets in `push_state` ∈ {absent, `'pending'`, `'failed'`, `'pushed'`, `'held'`} and ERP
  reachable,
  **When** the sweep ticks,
  **Then** absent/`pending`/`failed` are pushed and become `'pushed'`; `'pushed'`/`'held'` are **not** touched
  (no ERP call); and the sweep **re-asserts the Approved gate** rather than trusting the mirror row.
  (FR-TSP-045, FR-TSP-010)

### Fail-closed references

- **AC-TSP-030** — Unlinked employee / unmapped project / unconfigured activity type reject **before** any
  ERP call. **[unit]**
  **Given** an approved sheet whose author has **no** `erp_employees` row; separately one whose link is
  `proposed` (not `confirmed`); separately one whose entry's project has **no** `project_map` entry;
  separately (where the spike proves it mandatory) a null `default_activity_type`,
  **When** the push is dispatched,
  **Then** each is rejected `commit-rejected` with `employee-unlinked` / `employee-unlinked` /
  `project-unmapped` / `activity-type-unconfigured`, the ERP client is **never invoked** (asserted on the
  HTTP spy), **no** outbox row is claimed, `push_state='failed'` carries the classified reason, and —
  critically — **no** body is ever built with the dimension **omitted**. (FR-TSP-050..053)
- **AC-TSP-031** — Cross-org links are rejected **before** the external write. **[served-fn e2e]**
  **Given** an approved sheet in org A dispatched by a caller in org B; separately a sheet whose entry
  references another org's project; separately a resolved `erp_employees` row from another org,
  **When** the push is dispatched,
  **Then** each is rejected `422` `cross-org-link-rejected` **before** any ERP call and before any outbox
  claim — never after the commit. (FR-TSP-050, FR-TSP-054)
- **AC-TSP-032** — A >24h day is rejected; an empty sheet is skipped as success. **[unit]**
  **Given** an approved sheet with three 10-hour entries on one `entry_date` (each individually legal under
  the shipped `hours <= 24` CHECK), and separately an approved sheet with zero/all-zero entries,
  **When** each is pushed,
  **Then** the first is rejected `commit-rejected` / `daily-hours-exceed-24` with no ERP call; the second is
  marked `push_state='pushed'` with `ts_number = null`, no ERP call, and is **not** re-driven by the sweep.
  (FR-TSP-055, FR-TSP-056)
- **AC-TSP-033** — Time packing is deterministic + non-overlapping. **[unit]**
  **Given** a sheet with three entries on one date across three projects (`hours` = 2.5, 3, 1.5) and
  `timesheet_day_start='09:00:00'`,
  **When** the body is built twice,
  **Then** both bodies are **byte-identical**; `from_time`s are `09:00:00`, `11:30:00`, `14:30:00` in a stable
  `project_id` order; no interval overlaps; every datetime is a **naive** `'YYYY-MM-DD HH:MM:SS'` string with
  no `Z`/offset and no JS `Date` timezone conversion. (FR-TSP-062, FR-TSP-063)
- **AC-TSP-034** — Hours cross as decimal strings without float drift. **[unit]**
  **Given** entries with cents-bearing hours (`7.25`, `8.35`, `0.05`),
  **When** they cross the adapter into the ERP body and the read-back mirrors `total_hours`,
  **Then** each value is transmitted as its exact decimal string, `erp_total_hours` equals ERP's
  server-computed total verbatim, no JS float artifact appears, and PMO never recomputes the total from
  entries. (FR-TSP-070, FR-TSP-071, NFR-TSP-MONEY-001)

### Change feed

- **AC-TSP-040** — **A natively-created ERP Timesheet is NEVER adopted.** **[served-fn e2e]**
  **Given** a Timesheet created directly in the ERPNext Desk (no PMO command, no `external_refs` mapping) and
  an inbound webhook + a sweep tick,
  **When** the feed processes it,
  **Then** **no** `timesheets` row, **no** `timesheet_entries` rows, and **no** `timesheet_erp_mirror` row are
  minted; the webhook acks; an `action-required` operator task names the ERP doc; and PMO's timesheet counts
  are unchanged. (FR-TSP-082)
- **AC-TSP-041** — Desk cancel tombstones + reopens; the sweep does not fight the accountant.
  **[served-fn e2e]**
  **Given** a pushed Timesheet that an accountant cancels in the Desk,
  **When** the feed applies the cancel and the sweep then ticks **twice**,
  **Then** the mirror is soft-tombstoned (`erp_cancelled_at`, `erp_docstatus=2`), a lineage row
  (`reason='cancelled'`) is written, `external_refs` is retained, `push_state='failed'` with an
  `action-required` surface, the PMO `timesheets` row is **still `Approved` and otherwise untouched**, and
  the sweep issues **no** re-push on either tick. (FR-TSP-084)
- **AC-TSP-042** — Stale/out-of-order events are no-ops; the webhook signature is the trust boundary.
  **[unit]**
  **Given** an inbound Timesheet (and separately Employee) event with an **older** `modified` than the
  mirror's, and separately events with absent/invalid/valid `X-Frappe-Webhook-Signature`,
  **When** the feed processes them,
  **Then** the stale event is a **no-op** (the live mirror is never clobbered); absent/invalid signature →
  `401` with **no** side effect; valid → applied as a hint. (FR-TSP-081, FR-TSP-083)

### ⭐ The Employee-adopt sub-domain

- **AC-TSP-090** — The adopt mints an `erp_employees` row through the **party-adopt path**, full-fidelity, and
  **never** a PMO identity. **[unit]**
  **Given** an org owning `timesheets`→`erpnext` and an inbound ERP `Employee` event (webhook, and separately
  a sweep tick),
  **When** the feed adopts it,
  **Then** an `erp_employees` row is minted via `mintMirror` with the **full** canonical (`employee_number`/
  `employee_name`/`work_email`/`erp_user_id`/`erp_status`) **and a non-null `erp_modified` stamp** (the
  0103/party-adopt lesson — never a half-empty name-only row), `external_refs(org,'timesheets',
  'Employee:<name>')` maps it, a re-apply is **idempotent** (no duplicate row), and **no** `profiles` row,
  auth user, or login is created. (FR-TSP-090, FR-TSP-091, FR-TSP-093)
- **AC-TSP-091** — The link is **proposed**, never auto-confirmed; only an Admin confirms; an ERP-side email
  edit cannot re-point a confirmed link. **[pgTAP]**
  **Given** an adopted Employee whose `work_email` exactly (case-insensitively) matches PMO user U's auth
  email; separately one matching **zero** users; separately one matching **two**; separately a **confirmed**
  link whose ERP-side email then changes to point at user V,
  **When** the adopt runs and then link operations are attempted,
  **Then** the first is `link_state='proposed'` with `profile_id=U` +
  `link_proposed_reason='work-email-exact-match'` — and a push for U is **still rejected**
  (`employee-unlinked`) until confirmed; the zero/two-match cases stay `link_state='unlinked'`,
  `profile_id=null`, + `action-required`; a **non-Admin** calling `confirm_erp_employee_link` → `42501`; an
  **Admin** → `link_state='confirmed'` with `linked_by=<the Admin>`/`linked_at` **server-stamped** (not
  payload-supplied); a second confirm binding the **same** `profile_id` to another Employee → **rejected**
  (the partial unique index); and the changed-email case leaves the confirmed link **intact** + surfaces
  `action-required` (**never** a silent re-point). (FR-TSP-092, FR-TSP-014, OQ-TSP-10(C))
- **AC-TSP-092** — An unlinked author's approved sheet fails closed, is visible, and self-heals on confirm.
  **[served-fn e2e]**
  **Given** an approved sheet whose author has no **confirmed** Employee link,
  **When** the push runs, then an Admin confirms the link, then the sweep ticks,
  **Then** the first push is rejected `employee-unlinked` **with zero ERP calls**, `push_state='failed'` +
  `push_error` + `action-required` name the author, **the approval stands** (the sheet is still `Approved`),
  and after the confirm the **sweep pushes it automatically** to `push_state='pushed'` — **the approved sheet
  is never lost, only pending**. (FR-TSP-051, FR-TSP-045, FR-TSP-085)
- **AC-TSP-093** — `erp_employees` is machine-only, PII-scoped, and org-isolated. **[pgTAP]**
  **Given** an org owning `timesheets` with adopted Employees linked to users U and W,
  **When** a user JWT attempts `INSERT`/`UPDATE`/`DELETE` on `erp_employees`,
  **Then** each is denied; **and when** the service role writes it, it succeeds; **and** an `Admin` reads all
  rows, U reads **only** U's own row (`profile_id = auth.uid()`), an unrelated `Engineer` reads **0 rows**
  (the PII boundary — unlike `companies`, this table is **not** org-wide readable), and a user in **another
  org** reads **0 rows**; **and** the partial unique index on `(org_id, profile_id) where
  link_state='confirmed'` exists. (FR-TSP-170..172, FR-TSP-095, NFR-TSP-SEC-002)
- **AC-TSP-094** — A `Left` Employee keeps its confirmed link and stays pushable. **[unit]**
  **Given** a confirmed link whose ERP-side `status` flips to `Left`,
  **When** the feed applies it and a historic approved week is pushed,
  **Then** `erp_status='Left'` is mirrored + surfaced, the link stays `confirmed`, and the push **succeeds**
  (history must stay pushable). (FR-TSP-095, OQ-TSP-10(i) drafted)

### Storage + tenancy

- **AC-TSP-050** — ERP state is machine-only; read audience matches the sheet; the four feed columns exist
  day one. **[pgTAP]**
  **Given** an org owning `timesheets`→`erpnext` and a `timesheet_erp_mirror` row for user U's sheet,
  **When** a user JWT attempts `INSERT`/`UPDATE`/`DELETE` on `timesheet_erp_mirror`,
  **Then** each is denied; **and when** the service role writes it, it succeeds; **and** U reads their own
  row, U's line manager reads it, a `Finance` user reads it, an unrelated `Engineer` in the same org reads
  **0 rows**, and a user in **another org** reads **0 rows**; **and** `information_schema.columns` confirms
  `erp_docstatus`/`erp_modified`/`erp_amended_from`/`erp_cancelled_at` exist. (FR-TSP-170..172)
- **AC-TSP-051** — The push failure is visible; the UI degrades, never breaks. **[unit]**
  **Given** a flipped org, an approved sheet with `push_state='failed'` + `push_error`, an Employee link in
  `proposed`, and separately an ERP read-back that is entirely absent,
  **When** an Admin views the timesheet/approvals surface,
  **Then** the failure + its classified reason are visible with a retry affordance, the proposed link is
  visible with a Confirm affordance, and the timesheet page renders fully from PMO data with the ERP badge
  simply absent (never an error state, never a blocked render). (FR-TSP-085, FR-TSP-173)

---

## 9. Traceability (ADR-0010 — each AC owned by exactly ONE layer)

| AC | Requirement(s) | Owning layer | Planned proof |
|---|---|---|---|
| AC-TSP-001 | FR-TSP-004(i), FR-TSP-005 | Vitest (unit) | `pmo-portal/src/lib/repositories/timesheetPush.external.test.ts` |
| AC-TSP-002 | FR-TSP-004(i), FR-TSP-043 | **Cross-layer regression gate** — the unchanged P2+P3a suite staying green IS the proof (mirrors AC-ENA-002 / AC-SAR-002) |
| AC-TSP-003 | FR-TSP-004(i), FR-TSP-094 | Vitest (deno) | `supabase/functions/erpnext-sweep/index.test.ts` + `erpnext-webhook/index.test.ts` (extend) |
| AC-TSP-004 | FR-TSP-004(ii) | pgTAP | `supabase/tests/0112_timesheet_module_unchanged_when_flipped.test.sql` |
| AC-TSP-010 | FR-TSP-010, FR-TSP-014 | served-fn e2e | `pmo-portal/e2e/serial/AC-TSP-010-approved-only-gate.spec.ts` |
| AC-TSP-011 | FR-TSP-060..064, FR-TSP-071 | served-fn e2e | `pmo-portal/e2e/serial/AC-TSP-011-timesheet-push.spec.ts` *(spike-gated)* |
| AC-TSP-012 | FR-TSP-011 | pgTAP | `supabase/tests/0113_timesheet_push_authz.test.sql` |
| AC-TSP-013 | FR-TSP-012, FR-TSP-013, FR-TSP-093 | Vitest (deno) | `supabase/functions/adapter-dispatch/authGuard.test.ts` + `transitionTargetGuard.test.ts` (extend) |
| AC-TSP-020 | FR-TSP-040/041/044/045 | served-fn e2e | `pmo-portal/e2e/serial/AC-TSP-020-push-idempotency.spec.ts` |
| AC-TSP-021 | FR-TSP-042, FR-TSP-043 | Vitest (unit) | `pmo-portal/src/lib/adapterSeam/erpnext/doctypeRegistry.test.ts` + `dispatch.test.ts` (extend) |
| AC-TSP-022 | FR-TSP-045, FR-TSP-010 | served-fn e2e | `pmo-portal/e2e/serial/AC-TSP-022-sweep-backstop.spec.ts` |
| AC-TSP-030 | FR-TSP-050..053 | Vitest (unit) | `pmo-portal/src/lib/adapterSeam/erpnext/dispatchFactory.test.ts` (extend) |
| AC-TSP-031 | FR-TSP-050, FR-TSP-054 | served-fn e2e | `pmo-portal/e2e/serial/AC-TSP-031-cross-org.spec.ts` |
| AC-TSP-032 | FR-TSP-055, FR-TSP-056 | Vitest (unit) | `pmo-portal/src/lib/adapterSeam/erpnext/bodies/timesheet.test.ts` |
| AC-TSP-033 | FR-TSP-062, FR-TSP-063 | Vitest (unit) | `pmo-portal/src/lib/adapterSeam/erpnext/timeLogPacking.test.ts` |
| AC-TSP-034 | FR-TSP-070, FR-TSP-071 | Vitest (unit) | `pmo-portal/src/lib/adapterSeam/erpnext/moneyShape.test.ts` (extend) |
| AC-TSP-040 | FR-TSP-082 | served-fn e2e | `pmo-portal/e2e/serial/AC-TSP-040-native-timesheet-not-adopted.spec.ts` |
| AC-TSP-041 | FR-TSP-084 | served-fn e2e | `pmo-portal/e2e/serial/AC-TSP-041-desk-cancel-tombstone.spec.ts` |
| AC-TSP-042 | FR-TSP-081, FR-TSP-083 | Vitest (deno) | `supabase/functions/erpnext-webhook/index.test.ts` + `_shared/erpnextFeedDeps.test.ts` (extend) |
| **AC-TSP-090** | FR-TSP-090/091/093 | Vitest (deno) | `supabase/functions/_shared/erpnextFeedDeps.test.ts` (extend — the employee adopt) |
| **AC-TSP-091** | FR-TSP-092, FR-TSP-014 | pgTAP | `supabase/tests/0114_erp_employee_link.test.sql` |
| **AC-TSP-092** | FR-TSP-051, FR-TSP-045, FR-TSP-085 | served-fn e2e | `pmo-portal/e2e/serial/AC-TSP-092-employee-unlinked-selfheal.spec.ts` |
| **AC-TSP-093** | FR-TSP-170..172, FR-TSP-095 | pgTAP | `supabase/tests/0111_erp_employees_rls.test.sql` |
| **AC-TSP-094** | FR-TSP-095 | Vitest (deno) | `supabase/functions/_shared/erpnextFeedDeps.test.ts` (extend) |
| AC-TSP-050 | FR-TSP-170..172 | pgTAP | `supabase/tests/0110_timesheet_erp_mirror_rls.test.sql` |
| AC-TSP-051 | FR-TSP-085, FR-TSP-173 | Vitest (RTL) | `pmo-portal/pages/Approvals.test.tsx` (extend) |

> NFR-TSP-SEC-001 / CONTRACT-001 / REV-001 are structural — proven transitively and reviewed at the gate.
> IDEM-001 → AC-TSP-020/021; MONEY-001 → AC-TSP-034; REG-001 → AC-TSP-002/021; SEC-002 → AC-TSP-093;
> AVAIL-001 → AC-TSP-051 + the FR-TSP-006 design; PERF-001 → AC-TSP-022 + a plan-time `EXPLAIN`.
> **AC-TSP-011 is a spike-frozen gate — BLOCKED until OQ-TSP-1 freezes** (mirroring AC-SAR-040/041's posture
> before 2026-07-14). **AC-TSP-090/091/094 are partially spike-gated** — the `Employee` field names come from
> OQ-TSP-1 #9.

---

## 10. Error handling

| Condition | Classification | Required behavior |
|---|---|---|
| Sheet not `Approved` (incl. a forged payload) | `commit-rejected` / `timesheet-not-approved` (`422`) | Server-side DB re-read under the caller's JWT; reject **before** adapter/outbox/ERP (FR-TSP-010) |
| Caller is neither `approved_by`, privileged, nor the sweep | `commit-rejected` / `not-authorized` (`403`) | Reject before any ERP call; **do not** use `MONEY_WRITE_ROLES` as the sole rule (FR-TSP-011) |
| `erp_doc_kind`↔`domain` mismatch / unknown kind | `422` | `KIND_DOMAIN` check in the shipped `authGuard` (FR-TSP-012) |
| A **write** command carrying `erp_doc_kind:'employee'` | `422` / `employee-is-read-only` | The adopt is inbound-only; PMO never writes an ERP Employee (FR-TSP-093) |
| Client-supplied `externalRecordId` on a `timesheets` command | `422` | Target resolved from `external_refs` only (FR-TSP-013) |
| Author has no **confirmed** `erp_employees` link (absent / `unlinked` / `proposed` / `rejected`) | `commit-rejected` / `employee-unlinked` | Reject before any ERP call; `push_state='failed'` + `action-required`; **never** a default Employee; the sweep re-drives once confirmed (FR-TSP-051) |
| An entry's project has no `project_map` entry | `commit-rejected` / `project-unmapped` | Reject before any ERP call; **never** send the row without its project (FR-TSP-052) |
| `activity_type` mandatory but unconfigured | `commit-rejected` / `activity-type-unconfigured` | Reject before any ERP call (FR-TSP-053) |
| Cross-org sheet / project / employee link | `cross-org-link-rejected` (`422`) | Reject **before** the external write, never after (FR-TSP-054) |
| A single `entry_date` sums > 24h | `commit-rejected` / `daily-hours-exceed-24` | Pre-validate; no ERP call; no packing spill (FR-TSP-055) |
| Approved sheet with zero / all-zero entries | **success, skipped** | `push_state='pushed'`, `ts_number=null`, no ERP call, not re-driven (FR-TSP-056) |
| ERP validation rejection | `commit-rejected` | Parse `exc_type` then `_server_messages`; surface it; `push_state='failed'` (FR-TSP-065) |
| Unguarded `500 TypeError` (if OQ-TSP-1 #7 finds one) | `commit-rejected` (non-retryable) | Pre-validate client-side; distinct bucket; never blind-retried (FR-TSP-044/065) |
| ERP unreachable / timeout / 5xx-after-budget | `external-unreachable` | Fail honestly; **the approval stands**; `push_state='failed'`; the sweep re-drives (FR-TSP-006/045) |
| Duplicate push (sweep vs user race) | `23505` (outbox unique 4-tuple) | Deterministic key ⇒ one proceeds, the loser reconciles (FR-TSP-041) |
| Retry after post-commit mirror failure | guarded reconcile | Outbox `committed` fenced finalize / anchor probe; **never** re-create the Timesheet (FR-TSP-044) |
| Post-window inconclusive recovery (probe miss or no anchor) | `command-held` (terminal) | `push_state='held'`; **never** auto-reissued — the duplicated-week guard (FR-TSP-042, OQ-TSP-2) |
| Inbound **Timesheet** with no `external_refs` mapping | **ack-and-skip** + `action-required` | **Never** adopt — it would mint unapproved hours (FR-TSP-082) |
| Inbound **Employee** with no mapping | **adopt** (the licensed exception) | Mint `erp_employees` via the party-adopt path; propose-or-surface the link (FR-TSP-090..092) |
| Employee work-email matches **zero** or **multiple** PMO users | `action-required` | `link_state='unlinked'`, `profile_id=null`; **never** auto-resolve (FR-TSP-092) |
| ERP-side email change on a **confirmed** link | `action-required` | The confirmed link **stands**; never a silent re-point (FR-TSP-092, OQ-TSP-10(C)) |
| Non-Admin calls `confirm_erp_employee_link` | `42501` | Admin-only security-definer RPC; org + role re-asserted internally (FR-TSP-092) |
| Confirming a second Employee for an already-confirmed PMO user | `23505` | The partial unique index rejects it (OQ-TSP-10(ii) drafted) |
| Employee `status='Left'` | mirror + surface | Keep the confirmed link; the push still works (FR-TSP-095) |
| Desk cancel of a pushed Timesheet | tombstone + reopen | Soft-tombstone + lineage + `push_state='failed'` + `action-required`; **no** auto re-push (FR-TSP-084) |
| Out-of-order older `modified` event | no-op | Per-row `erp_modified` monotonic guard (FR-TSP-083) |
| Invalid/absent webhook signature | `401` / no side effect | Reject as untrusted (FR-TSP-081) |
| Cold/absent ownership map | **no push** (benign) | The approval succeeds unchanged; the sweep pushes later if flipped (FR-TSP-005) |

---

## 11. Implementation TODO checklist

- [ ] **OQ-TSP-1 spike (BLOCKING — re-dispatched 2026-07-16 after the ~36h bench outage):** the R9 ladder for
      `Timesheet` **and the `Employee` read shape (#9)**; freeze §9 in
      `docs/spikes/YYYY-MM-DD-erpnext-timesheet-fields.md`. **No body code before it.**
- [ ] Registry: `ERPNEXT_TIMESHEETS_DOMAIN` + capability-map entry + the `timesheet` kind
      (`submitOnCreate:true`; anchor/`neverReissue` per the spike + OQ-TSP-2) + the `employee` kind
      (`readOnly:true`) + the additive `neverReissue` field + `reissueOnInconclusiveAbsence =
      !(anchorMutable || neverReissue)`.
- [ ] Storage `0108`: `timesheet_erp_mirror` (side table, org seam, four day-one `erp_*` cols, default-deny
      writes + sheet-parity SELECT, `(org_id, push_state)` index). **`alter table timesheets` FORBIDDEN.**
- [ ] Storage `0109`: `approved_timesheet_for_push` (the Approved + authz + entries read) +
      `get_timesheet_config` (defaults **merged in SQL** — the SF10 lesson).
- [ ] Storage `0110`: `erp_employees` (adopt target + link columns, PII-scoped SELECT, partial unique
      `(org_id, profile_id) where link_state='confirmed'`) + `confirm_erp_employee_link` (Admin-only
      security-definer, audited).
- [ ] `approvalGuard.ts` (FR-TSP-010) + the FR-TSP-011 role rule (**not** `MONEY_WRITE_ROLES` alone) + the
      read-only-kind rejection + extend `checkTransitionTargetBinding` additively.
- [ ] `bodies/timesheet.ts` (spike-frozen; **no billing fields**) + `bodies/employee.ts` (`fromDoc` only,
      spike-frozen) + `timeLogPacking.ts` + the >24h / empty-sheet pre-validations.
- [ ] `dispatchFactory` timesheet ref resolver: **confirmed-link** employee + per-entry project + activity
      type + same-org — all **fail-closed, before the outbox claim**.
- [ ] `readModelWriters`: the `timesheets` writer (side-table upsert + `push_state` + `ts_number` +
      read-back), additive; **the sweep's finalize path supplies the same server-resolved context**.
- [ ] `feedKinds` + `erpnextFeedDeps`: both kinds; **lifecycle-only + never adopt** for `timesheet`
      (FR-TSP-082); **adopt via the party-adopt `mintMirror` branch** for `employee` (FR-TSP-090..092);
      desk-cancel reopen (FR-TSP-084).
- [ ] Sweep: the bounded approved-but-unpushed backstop under the deterministic key + the re-asserted gate;
      the `Employee` cursor pass (backfill on first tick), **gated on the org owning `timesheets`**.
- [ ] FE: the approve path dispatches the push **after** `transition_timesheet` succeeds and **never** blocks
      the approval; the `failed`/`held` operator surface; the **Employee-link Confirm** surface (Admin).
- [ ] Verification: `npm run verify` + `scripts/with-db-lock.sh supabase test db` + `e2e/serial/AC-TSP-*`.

---

## 12. Explicit residual risks

- **R-SOT (FR-TSP-004(ii)) — P3b's sharpest, no P2/P3a analogue.** Every prior phase flipped a table PMO
  barely owned; P3b touches the neighborhood of a **shipped, heavily-tested, user-facing module**
  (`0007`/`0011`/`0055` + pgTAP `0021..0026`/`0046..0049`/`0106`). The risk is a "small" convenience edit to
  `transition_timesheet` or `timesheets` breaking approval for **every** client. Mitigated by: the
  side-table design (no PMO-table change is even *possible* within `0108`), §13's prohibition, ADR-0059
  §3.1, and **AC-TSP-004** + AC-TSP-002.
- **R-DUP (NFR-TSP-IDEM-001).** Two independent originators is a **new** topology (ADR-0059 §4) — P2/P3a had
  one. A duplicated Timesheet = a duplicated week of hours → inflated project cost. Mitigated by the
  deterministic key + ADR-0058's atomic claim/fencing + the OQ-TSP-2 `held` ruling; proven by AC-TSP-020/021.
- **R-ANCHOR (OQ-TSP-1 #2 / OQ-TSP-2) — the live fork.** If no ERP field survives `validate`, P3b needs the
  `neverReissue` semantics and a real crash-after-commit becomes an **operator** task. Accepted: a manual
  reconcile beats a silent duplicated week.
- **R-SPIKE (OQ-TSP-1) — OPEN, and it has already slipped once** (the bench was down ~36h; restarted +
  re-dispatched). The ladder is **wider** than P3a's (a child table + datetimes + an HR-master link + an
  overlap validator + the `Employee` read shape). P3a's spike overturned **two** drafted assumptions; assume
  this one will too. AC-TSP-011 and parts of AC-TSP-090/091 are gated on it.
- **R-EMPLOYEE-IDENTITY (OQ-TSP-10) — NEW, and the sharpest *security* risk P3b adds.** The Employee→user
  link decides **whose** cost a week becomes. Auto-matching on an **ERP-editable** email would let anyone with
  Desk access silently re-point a PMO user's cost identity. Mitigated by the recommended **adopt-then-confirm**
  (only Admin-`confirmed` authorizes a push; an ERP-side email change surfaces rather than re-points) —
  **but the owner has not ruled yet** (§14).
- **R-EMPLOYEE-PII — NEW.** `erp_employees` is the first PMO table holding an HR master's names + work emails.
  Mitigated by the minimum-necessary field set (FR-TSP-095), the restricted SELECT (§4.2), and AC-TSP-093 —
  but it is a new PII surface and the security-auditor should treat it as one.
- **R-EMPLOYEE-ONBOARDING.** A new hire's first approved week fails to push until an Admin confirms the link.
  Mitigated by the loud `action-required` + the sweep's self-heal (AC-TSP-092 — the sheet is never lost, only
  pending) — but it **is** a per-hire manual step, which the owner should weigh when ruling OQ-TSP-10.
- **R-SWEEP (the Luna BLOCK-4 replay).** P3a's audit found the sweep's finalize path calling the writer
  **without** `callerUserId`, NULLing the SoD witness. P3b's sweep runs as service role with **no** user JWT
  **by design** — so it MUST take the same server-resolved route (FR-TSP-014/045) and re-assert the Approved
  gate (FR-TSP-010) rather than trusting the mirror row. **Most likely finding to recur**; AC-TSP-022 asserts
  the gate on the sweep path specifically.
- **R-TZ (OQ-TSP-5) — OPEN.** A site/org timezone mismatch mis-dates hours **silently**. Mitigated by naive
  site-local transport + an onboarding assertion — **owner ruling pending**.
- **R-CORRECTION (OQ-TSP-6) — OPEN.** An approved-and-pushed week with a mistake has **no** in-app fix,
  against OD-SAR-PMO-IS-THE-UI. Accepted for P3b, surfaced for the owner. A builder must **not** invent a
  re-open path inside P3b (§13, ADR-0059 §8).
- **R-PERF (NFR-TSP-PERF-001).** An unindexed backstop query would table-scan every org's history per tick.
  Mitigated by `(org_id, push_state)` + a per-tick bound; `EXPLAIN`-verified at plan time.

---

## 13. Out-of-scope reminders for implementation

- **Do NOT modify `transition_timesheet` (0007), `save_timesheet_week` (0055), the `timesheets`/
  `timesheet_entries`/`profiles` schema, or any timesheet RLS policy.** Migrations `0108`/`0109`/`0110` must
  contain **no** `alter table` on them. The push is a **consequence** of approval, never a step inside it.
  *(A DB function cannot call an edge function; "just push from the RPC" would couple PMO's SoT to ERP
  liveness and violate FR-TSP-006.)*
- **⛔ Do NOT send `is_billable` / `billing_hours` / `billing_rate`, and do NOT add a PMO billability or rate
  field** — **owner ruling 2026-07-16: costing only, billable OUT.** The Timesheet→SI billing linkage is its
  own issue.
- **Do NOT add a PMO `Approved → Draft` re-open path** — OQ-TSP-6(b), a change to the shipped
  `FR-TS-001..010` state machine, needing its own spec + owner ruling.
- **Do NOT adopt native ERP Timesheets** into PMO (FR-TSP-082) — it would mint hours that never passed PMO
  approval. *(The `employee` master is the licensed exception, ADR-0059 §5 — do not generalize it back to
  process documents.)*
- **Do NOT invent a second adopt mechanism** for Employee — reuse `_shared/erpnextFeedDeps.ts`'s `mintMirror`
  + `external_refs` + the existing webhook/sweep (FR-TSP-090).
- **Do NOT auto-link an Employee to a PMO user, and NEVER create a `profiles` row / auth user / login from an
  ERP Employee** (FR-TSP-092/093).
- **Do NOT place the `employee` kind in the `companies` domain** — it would change behavior for orgs already
  flipped on `companies` (FR-TSP-094).
- **Do NOT mirror salary/bank/national-id or any HR field beyond §4.2's set** (FR-TSP-095).
- **Do NOT invent the `Timesheet`/`Employee` field maps** — OQ-TSP-1's frozen §9 is the only authority
  (FR-TSP-064).
- **Do NOT reuse `MONEY_WRITE_ROLES` as the sole push authorization** — it excludes the Engineer line-manager
  who is the *primary* legitimate approver (FR-TSP-011).
- **Do NOT mint a fresh random idempotency key per push attempt** — the sweep/user race needs the
  deterministic key to collide (FR-TSP-041).
- **Do NOT silently omit an unresolved employee/project/activity dimension** — reject before the ERP call
  (FR-TSP-050..053; the Luna SF9 lesson).
- **Do NOT auto-reissue a Timesheet** on inconclusive recovery (OQ-TSP-2).
- **Do NOT auto re-push after a desk cancel** (FR-TSP-084) — never fight the accountant.
- **Do NOT block or roll back an approval on a push failure** (FR-TSP-006).
- **Do NOT recompute ERP totals locally** (ADR-0048; FR-TSP-071).
- **Do NOT thread `org_id` from the client or send Frappe vocabulary above the adapter contract**
  (NFR-TSP-CONTRACT-001).
- **Do NOT use `page.route` in a push e2e** (NFR-TSP-TEST-001).
- **Do NOT design around an ERP helper app** (ADR-0055 §2).

---

## 14. Open questions for the owner (sign-off blockers)

> **Resolved 2026-07-16:** ✅ **OQ-TSP-3** → the **Employee-adopt sub-domain** (over map-only) — §5.9;
> ✅ **OQ-TSP-4** → **costing only, billable OUT** — §2 non-goals. Everything else in this spec is decided.
> **These five remain — none is invented-around, none is buried:**

1. **OQ-TSP-1 (spike, BLOCKING — no ruling needed, just run it).** The `Timesheet` R9 ladder **+ the
   `Employee` read shape (#9)**. **⚑ It could not run — the bench was down ~36h; restarted and
   re-dispatched.** Answers: mandatory fields, the anchor, overlap validation, datetime/TZ, **whether submit
   posts GL**, cancel semantics, the zero/empty edges, employee-link errors, and the `Employee` field names.
   **Nothing is guessed to close it.**
2. **⭐ OQ-TSP-10 — NEW, surfaced by the OQ-TSP-3 ruling: how does an ERP `Employee` resolve to a PMO user?**
   (A) auto-match on work email · (B) explicit admin mapping UI · **(C) ⭐ RECOMMENDED — adopt-then-confirm**
   (propose on an exact work-email match; **only an Admin-confirmed link authorizes a push**; an ERP-side
   email edit can propose but **never** re-point a confirmed link). **This spec builds (C).** Rationale: it
   is the only option where a Desk-side edit cannot silently move a PMO user's cost identity, and it degrades
   safely (a missed confirm = a visibly failed push + a sweep that self-heals on confirm). **Sub-rulings
   wanted:** (i) an Employee whose ERP `status='Left'` while its PMO user is active — **drafted: keep the
   confirmed link, history stays pushable**; (ii) may one PMO user be confirmed to two Employees —
   **drafted: no** (partial unique index). *(If the owner picks (A) or (B), only FR-TSP-092's link-state
   machine changes — the table, the adopt, and the fail-closed push are identical in all three.)*
3. **OQ-TSP-5 — site/org timezone (still open).** Is a per-org timezone a first-class binding-config field,
   and does a site/org mismatch **block** the flip? **Drafted position built:** naive site-local datetimes +
   a loud onboarding assertion. *(Silent-corruption class: a day-boundary entry lands on the wrong ERP day.)*
4. **OQ-TSP-6 — correction path (still open).** Accept "no in-app fix for an approved week" for P3b
   (**drafted — nothing built**) vs commission an `Approved → Draft` re-open + an ERP cancel as its **own**
   issue. *Sits against OD-SAR-PMO-IS-THE-UI.*
5. **ADR-0059 acceptance.** `docs/adr/0059-pmo-sot-with-external-side-mirror.md` is **written and Proposed**
   (2026-07-16) — the two postures, the choice rule, the seven Posture-B invariants, the deterministic key,
   never-adopt + its master-data exception (which licenses §5.9's Employee adopt), and the **ADR-0055 §5 row
   clarification** (its §7 wording is ready to lift into ADR-0055's map). **Owner acceptance requested**; it
   governs every future PMO-SoT domain (Budgets is flagged as the next candidate, **not** pre-decided).

SPEC-DRAFT (rev. 2026-07-16) — OQ-TSP-3 ✅ / OQ-TSP-4 ✅ decided; awaiting owner on OQ-TSP-10, OQ-TSP-5,
OQ-TSP-6 + ADR-0059 acceptance; OQ-TSP-1 spike re-dispatched and still gating the build.
