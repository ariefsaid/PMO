# Spec: ClickUp adapter — tasks domain (Issue P1 — ADR-0055 P1 phase)

> **Status:** Draft (author 2026-07-10) — awaiting review battery + owner sign-off. Three
> owner-decision flags raised (§10: OD-CUA-1 enhancement-column write mechanism; OD-CUA-2
> mirrored-task deletion policy; OD-CUA-3 mixed-onboarding matching).
>
> P1 (the ClickUp adapter, tasks domain) of **ADR-0055**
> (`docs/adr/0055-external-system-adapters-sot-enhancement.md`, §7 ClickUp + §8 P1 row). Builds on the
> **shipped P0 seam** (`docs/specs/external-adapter-seam.spec.md`; migrations 0087–0090; the `reference`
> domain reference implementation). Conforms to house conventions: EARS + `FR-CUA-`/`NFR-CUA-`/`AC-CUA-`
> ids; Given/When/Then; ADR-0010 test-pyramid traceability (each AC owned by one test at its lowest
> sufficient layer). Grounds: ADR-0055 §§3,4,7,8 (binding architecture); `docs/glossary.md` §Integration
> (terms used **exactly**: SoT, externally-owned domain, read-model, enhancement, capability map, adapter,
> adapter contract, external tier) + the Task/Milestone/Dependency terms; ADR-0017 (repository seam — the
> contract this routes behind); ADR-0016 (`can()` UX-only, RLS is authority); ADR-0001 (`org_id` seam).
>
> **Owner-decided intake (2026-07-10 — binding, NOT re-opened here):**
> - **ClickUp access = MOCKED-ONLY in P1.** Every AC is provable against recorded/mocked ClickUp REST v2
>   responses; a live-smoke checklist is Appendix A, deferred until a real token exists in 1Password.
> - **Mapping = one ClickUp List per PMO project** (the parent Space/Folder is configurable per client);
>   a PMO Task ↔ a ClickUp task in that List.
> - **Onboarding = BOTH directions:** push-seed (PMO→ClickUp at flip time) AND pull-adopt (adopt existing
>   ClickUp tasks into the read-model).
> - From ADR-0055 §7: **ClickUp is SoT for tasks when employed**; milestones / dependencies /
>   weighted-rollup stay **PMO-side enhancements over mirrored tasks**; free-tier ClickUp API + webhooks
>   (~100 req/min) is the floor; the **US-hosted SaaS data-locality asymmetry** must be stated in client
>   comms (an NFR).
>
> **Scope (locked, Director):** (a) the **ClickUp adapter** implementing the P0 contract for the **tasks**
> domain — commands (create/update/delete/status-transition) + reads (list-changes-since-watermark,
> get-by-external-id) against ClickUp REST v2, with ClickUp vocabulary **confined to the adapter**; (b)
> flipping the **real** tasks domain — the RLS write-policy flip on `tasks` (generalizing the 0090
> reference pattern) + `executeWrite`/`executeWriteWithPendingPush` wired into the task repository writes,
> **reads unchanged**; (c) the **change-feed engine** (new in P1) — webhook ingress edge function +
> watermark reconciliation sweep; (d) **onboarding both ways** — push-seed + pull-adopt + project→List
> provisioning, idempotent + resumable, `external_refs` as the mapping ledger; (e) **pending-push state on
> task surfaces** (composing the P0 shared behavior); (f) **enhancement integrity** on mirrored-task
> deletion; (g) **rate-limit behavior**, error surfaces, and the **byte-for-byte invariant** for orgs that
> do NOT employ ClickUp (P1's critical regression risk — an explicit FR + AC, as P0 did).
>
> **Out of scope (later phases — do NOT build here):** ERPNext (P2/P3) and Odoo (P4) adapters and any of
> their API specifics; real-time collaborative editing / presence in ClickUp; **ClickUp custom fields
> beyond the mapping set** (name, status, assignee, start/due dates) — comments, checklists, tags,
> attachments, time-tracking, priority; ClickUp sub-tasks / nested hierarchy beyond the two-level PMO
> milestone→task model; the backfill/promote runbook for a domain *other* than tasks; deep user/member
> directory sync (assignee mapping is best-effort per FR-CUA-013); a write-capable Integrations admin
> surface (Operator provisions via the P0 RPC). **No re-litigation of any ADR-0055 or P0 decision.**

---

## 0. Job story

> **When a client employs ClickUp, PMO must make ClickUp the source of truth for the tasks domain —
> user task actions travel down as synchronous ClickUp commands, native ClickUp edits travel up via
> webhooks + a reconciliation sweep, and PMO's milestone/dependency/rollup enhancements keep working
> over the mirrored tasks — while every org that does NOT employ ClickUp stays byte-for-byte the
> pre-adapter system.**

P1 is the first *real* adapter: it turns the P0 seam's machinery (ownership switch, adapter contract,
write-routing, `external_refs`, watermarks, pending-push) from a proof against a synthetic domain into a
working integration against a real external system at the lowest stakes — the ClickUp free tier, the
distributor-partnership demo wedge (ADR-0055 §7,8).

---

## 1. Context (AS-IS) and scope

**What P0 shipped (the seam this plugs into).** The adapter contract (`pmo-portal/src/lib/adapterSeam/
contract.ts`) declares, in PMO domain language, a per-tier `capabilityMap`, per-domain `commit(command)`
(create/update/delete/transition), and reads `listChangesSinceWatermark` + `getByExternalId`. The router
(`router.ts`) decides `routeWrite(domain, ownershipMap)` and `executeWrite` / `executeWriteWithPendingPush`
(the latter composing the shared pending-push state machine, `pendingPush.ts`). The dispatch edge function
(`supabase/functions/adapter-dispatch/index.ts`) binds org context from the caller's JWT, invokes the
adapter with **no `org_id`**, then in order updates the read-model and records `external_refs`
(`dispatch.ts`, `refs.ts`). Storage: `external_domain_ownership` (the switch + `domain_externally_owned()`),
`external_refs` (id ledger), `external_sync_watermarks` (cursor), and — the reference implementation —
`external_reference_items` with a write-policy **flip** gated on `domain_externally_owned(auth_org_id(),
'reference')` (migration 0090). The P0 `adapter-dispatch` registry currently holds **only** the `reference`
adapter (a marked `// P1 routes per domain` seam).

**What P1 adds.** A **ClickUp adapter** (`tier = 'clickup'`, `capabilityMap = {'tasks'}`) registered in the
dispatch; the tasks-domain **RLS flip** (generalizing 0090 onto the real `tasks` table); the task
repository writes wired through `executeWrite`/`executeWriteWithPendingPush`; the **change-feed engine**
(webhook ingress + reconciliation sweep — new in P1, was explicitly deferred out of P0); onboarding both
ways; pending-push on the task surfaces; enhancement integrity; and the byte-for-byte guarantee for
non-ClickUp orgs surviving the repository wiring.

**The task DAL today** (`pmo-portal/src/lib/db/tasks.ts`, ADR-0017 repository `task` in
`repositories/index.ts`): `listTasks` / `getTask` (reads), `createTask` / `updateTask` /
`updateTaskStatus` / `deleteTask` (native-field writes), `addDependency` / `removeDependency` (dependency
**enhancement** writes). The `tasks` row carries native fields (`name`, `status`, `assignee_id`,
`start_date`, `end_date`) **and** the PMO enhancement column `milestone_id` (grouping). Today `tasks` RLS is
`tasks_write` (four delivery roles + parent-org guard, 0002) + `tasks_update_own_status` (assignee
status-only, 0016) + the `enforce_assignee_status_only` column-pin trigger; `task_dependencies` has
`task_dependencies_write` (0002).

**The shipped invariant.** Every org's `external_domain_ownership` is empty by default, so pre-P1 the tasks
domain is PMO-owned for **every** org and must remain byte-for-byte unchanged for any org that never
employs ClickUp — this survives the repository wiring only if the routing short-circuits on the empty map
(FR-CUA-030, the P1 regression risk).

## 2. Goals

- **G-1 (the adapter)** A ClickUp adapter implementing the P0 contract for the tasks domain — commands
  create/update/delete/status-transition + reads list-changes-since-watermark / get-by-external-id —
  against ClickUp REST v2, expressed at the contract in PMO domain language, with **all** ClickUp
  vocabulary confined to the adapter.
- **G-2 (the flip)** The real tasks domain flips to ClickUp-owned per org: user-JWT writes to the `tasks`
  native fields are RLS-denied while tasks are externally-owned (generalizing 0090); the sync service role
  writes the read-model; PMO enhancements (milestone grouping, dependencies, weights, rollup) keep working;
  **reads are unchanged** (always Supabase read-model).
- **G-3 (the change-feed)** A change-feed engine: a webhook ingress edge function (ClickUp signature
  verification + idempotent event apply, for latency) and a watermark reconciliation sweep (modified-since
  cursor on `external_sync_watermarks`, for truth). Webhooks for latency, sweep for truth (ADR-0055 §3).
- **G-4 (onboarding both ways)** Push-seed (PMO tasks → ClickUp at flip time) and pull-adopt (existing
  ClickUp tasks → read-model), both idempotent and resumable, with `external_refs` as the mapping ledger,
  and project→List provisioning.
- **G-5 (the visible state)** Pending-push state composed from the P0 shared behavior on the named task
  surfaces: task **board**, task **list**, task **detail**.
- **G-6 (enhancement integrity)** A defined, non-silent outcome for PMO enhancements when a mirrored task
  is deleted natively in ClickUp.
- **G-7 (the guarantee)** For any org that does NOT employ ClickUp, behavior is byte-for-byte the
  pre-adapter system — the P0 empty-map invariant survives the task-repository wiring. Zero regression.
- **G-8 (works pre-upsell / stays polite)** The adapter lives within ClickUp's free-tier ~100 req/min
  budget (batching + backoff) and fails honestly on rejection/unreachability.

## 3. Functional requirements (EARS)

### 3.1 ClickUp adapter — commands

- **FR-CUA-001** (ubiquitous) The system shall provide a **ClickUp adapter** implementing the P0 adapter
  contract (`Adapter` in `contract.ts`) with `tier = 'clickup'` and a static `capabilityMap = {'tasks'}`;
  registered in the `adapter-dispatch` adapter registry keyed by the `tasks` domain.
- **FR-CUA-002** (event-driven) When a `create` command is issued for the tasks domain, the adapter shall
  create a ClickUp task in the PMO project's mapped ClickUp List (ClickUp REST v2 `POST
  /api/v2/list/{list_id}/task`) and return the ClickUp task id as the `externalRecordId` plus the canonical
  PMO-shaped task record (FR-EAS-022 shape).
- **FR-CUA-003** (event-driven) When an `update` command is issued for the tasks domain, the adapter shall
  update the corresponding ClickUp task (`PUT /api/v2/task/{task_id}`), resolving the ClickUp task id from
  the `external_refs` mapping, and return the canonical PMO-shaped record from ClickUp's response.
- **FR-CUA-004** (event-driven) When a `transition` command (status change) is issued for the tasks domain,
  the adapter shall set the ClickUp task's status via `PUT /api/v2/task/{task_id}` using the List's
  configured status that the PMO `task_status` maps to (FR-CUA-011); an unmappable target status shall be
  surfaced as a `commit-rejected` classified error, not silently dropped.
- **FR-CUA-005** (event-driven) When a `delete` command is issued for the tasks domain, the adapter shall
  delete the corresponding ClickUp task (`DELETE /api/v2/task/{task_id}`) resolved from `external_refs`, and
  on success signal the dispatch to remove the mirrored read-model row and its `external_refs` mapping.
- **FR-CUA-006** (event-driven) When ClickUp rejects a command (validation, 4xx) the adapter shall raise an
  `AdapterError('commit-rejected', <ClickUp message>)`; when ClickUp is unreachable or returns 5xx after the
  retry budget (FR-CUA-051) is exhausted, the adapter shall raise `AdapterError('external-unreachable', …)`
  — so the dispatch maps each to the user-facing surface (P0 FR-EAS-023/§7 error table).

### 3.2 ClickUp adapter — reads (change-feed sources)

- **FR-CUA-007** (event-driven) When `listChangesSinceWatermark('tasks', cursor)` is invoked, the adapter
  shall page ClickUp tasks in the mapped List modified since the cursor (`GET
  /api/v2/list/{list_id}/task?date_updated_gt={cursor}&order_by=updated`, paginated), map each to a
  canonical PMO-shaped record, and return `{ changes, nextCursor }` where `nextCursor` advances the
  modified-since watermark and is `null` when the page is exhausted.
- **FR-CUA-008** (event-driven) When `getByExternalId('tasks', clickupTaskId)` is invoked, the adapter shall
  fetch that ClickUp task (`GET /api/v2/task/{task_id}`) and return the canonical PMO-shaped record, or
  `null` when ClickUp reports it absent (404).
- **FR-CUA-009** (ubiquitous) The adapter reads shall be the **only** synchronous ClickUp calls on any read
  path used by the change-feed engine; no repository read (`listTasks`/`getTask`) shall ever invoke an
  adapter read — repository reads always serve the Supabase read-model (FR-CUA-021; P0 FR-EAS-030).

### 3.3 Field mapping & vocabulary confinement

- **FR-CUA-010** (ubiquitous) The adapter shall map exactly the **mapping set** of PMO Task fields ↔ ClickUp
  task fields and no others: `name` ↔ `name`; `status` ↔ ClickUp status (FR-CUA-011); `assignee_id` ↔
  ClickUp assignee member id (FR-CUA-013); `start_date` ↔ ClickUp `start_date`; `end_date` ↔ ClickUp
  `due_date` (unix-ms boundary conversion inside the adapter). Fields outside this set are out of scope.
- **FR-CUA-011** (ubiquitous) The adapter shall translate the PMO `task_status` enum ↔ the mapped List's
  configured ClickUp statuses via a **per-List status map** captured at provisioning (FR-CUA-041); a PMO
  status with no configured ClickUp counterpart shall raise `commit-rejected` (config), and an inbound
  ClickUp status with no PMO counterpart shall map to the configured default PMO status and be logged.
- **FR-CUA-012** (ubiquitous — **the confinement invariant**) No PMO code above the adapter contract shall
  import, reference, or name any ClickUp vocabulary (List, Space, Folder, `date_updated`, member id, ClickUp
  status names, endpoints, headers); the contract surface, the dispatch, the router, the repository, and all
  UI shall speak only PMO domain language (P0 NFR-EAS-CONTRACT-001). ClickUp shapes live solely under
  `pmo-portal/src/lib/adapterSeam/clickup/**` and the ClickUp webhook edge function.
- **FR-CUA-013** (event-driven) When a command or inbound change carries an assignee, the adapter shall map
  it via a **member map** (PMO `profile.id` ↔ ClickUp member id, provisioned per client); an unmapped PMO
  assignee shall push as **unassigned** in ClickUp with the outcome surfaced (not a hard failure), and an
  unmapped inbound ClickUp assignee shall mirror as `assignee_id = null`. (Deep member-directory sync is out
  of scope — §9.)

### 3.4 Flipping the real tasks domain (RLS flip + repository wiring)

- **FR-CUA-020** (state-driven) While the tasks domain is externally-owned for an org (its
  `external_domain_ownership` assigns `tasks` to the `clickup` tier), the system shall, via RLS, **deny
  user-JWT writes to the `tasks` native fields** (`name`, `status`, `assignee_id`, `start_date`,
  `end_date`) and permit those writes only to the dispatch/sync service role — generalizing the 0090
  reference-flip pattern (`domain_externally_owned(auth_org_id(), 'tasks')` gating `tasks_write`,
  `tasks_update_own_status`, and the `enforce_assignee_status_only` trigger). **RLS is the enforcement
  authority** (ADR-0016; P0 FR-EAS-037); the repository routing branch is UX/DX-only.
- **FR-CUA-021** (ubiquitous) Repository **reads** (`listTasks`, `getTask`) shall be **unchanged** and shall
  **always** serve the Supabase read-model regardless of ownership — no read is routed to the adapter (P0
  FR-EAS-030). The `TaskRepository` interface (ADR-0017) shall be unchanged; only the internal
  implementation of write methods branches.
- **FR-CUA-022** (event-driven) When a task **native-field** write (`createTask`, `updateTask`,
  `updateTaskStatus`, `deleteTask`) is performed for an org where tasks are externally-owned, the repository
  shall route it through `executeWriteWithPendingPush` to the adapter dispatch as a synchronous ClickUp
  command (create/update/transition/delete), returning only after ClickUp commits (synchronous
  write-through — ADR-0055 §4; P0 FR-EAS-031/034).
- **FR-CUA-023** (event-driven) When a task native-field write is performed for an org where tasks are
  PMO-owned (incl. every org with an empty ownership map), the repository shall take the existing
  **direct-DAL** path unchanged — no dispatch, no edge-function hop (P0 FR-EAS-032; the FR-CUA-030
  invariant).
- **FR-CUA-024** (state-driven) While the tasks domain is externally-owned, a task **enhancement** write
  (dependency add/remove; milestone grouping via `milestone_id`; weights; rollup inputs) shall remain a
  **PMO-side direct-DAL write** and shall **not** be routed to ClickUp — enhancements are additive PMO data
  over the mirrored task (ADR-0055 §3,§7; glossary *Enhancement*). The mechanism that keeps `milestone_id`
  user-writable while the native fields are machine-only is **OD-CUA-1**.
- **FR-CUA-025** (event-driven) When the dispatch commits a task command, it shall update the `tasks`
  read-model row from the adapter's canonical answer and record/update the `external_refs` mapping
  (`domain = 'tasks'`, `external_tier = 'clickup'`, `pmo_record_id` ↔ ClickUp task id) — in the P0 order:
  command → read-model update → `external_refs` → return (P0 FR-EAS-034).

### 3.5 The byte-for-byte invariant (non-ClickUp orgs — critical regression)

- **FR-CUA-030** (ubiquitous — **THE INVARIANT**) Where an org does not employ ClickUp for tasks (its
  `external_domain_ownership` has no `tasks`→`clickup` assignment — the shipped default for every existing
  client), the system shall produce **byte-for-byte identical behavior** to the pre-P1 system for the tasks
  domain: every task write shall take the existing direct-DAL path with **no** adapter dispatch and **no**
  dispatch edge-function call, reads shall take the existing DAL path, **no** pending-push state shall be
  introduced, the `tasks` RLS (`tasks_write`, `tasks_update_own_status`, the status trigger) shall behave
  exactly as before the flip, and all existing task error codes shall be unchanged. Zero regression for
  every existing client. *(This is P1's critical risk: the task-repository wiring must not perturb the
  non-ClickUp path — mirrors P0 FR-EAS-010/AC-EAS-001, re-asserted because P1 wires the REAL repository.)*

### 3.6 Change-feed engine — webhook ingress (for latency)

- **FR-CUA-040** (ubiquitous) The system shall provide a **ClickUp webhook ingress edge function**
  (`supabase/functions/clickup-webhook`) that receives ClickUp task webhooks
  (`taskCreated`/`taskUpdated`/`taskDeleted`/`taskStatusUpdated`) for employing orgs and applies each to the
  tasks read-model via the sync service role.
- **FR-CUA-041** (event-driven — **security**) When a webhook request arrives, the function shall verify the
  ClickUp **signature** (`X-Signature` HMAC-SHA256 of the raw body with the per-org webhook secret) before
  any processing, and shall reject an absent/invalid signature with `401` and no side effect — the webhook
  is an unauthenticated public surface, so signature verification is its sole trust boundary (STRIDE
  spoofing/tampering).
- **FR-CUA-042** (event-driven — **idempotency**) When a webhook event is applied, the function shall be
  **idempotent**: re-delivery of the same ClickUp event (same event/webhook id) shall not double-apply — the
  read-model converges to the same state whether an event is delivered once or many times (at-least-once
  webhook delivery is assumed).
- **FR-CUA-043** (event-driven) When a valid webhook event is applied, the function shall resolve the org +
  the mapped record from `external_refs`, upsert/delete the tasks read-model row via the service role, and
  advance the org's `(tasks, clickup)` watermark to at least the event's ClickUp modification timestamp — so
  a subsequent sweep does not re-fetch already-applied changes.
- **FR-CUA-044** (state-driven) While a webhook references a ClickUp task with no `external_refs` mapping (an
  adoption gap — e.g. created natively before the List was fully adopted), the function shall treat it as a
  **pull-adopt** of a new mirrored task (FR-CUA-062), not drop it.

### 3.7 Change-feed engine — watermark reconciliation sweep (for truth)

- **FR-CUA-045** (ubiquitous) The system shall provide a **reconciliation sweep** (a scheduled job) that, per
  employing org, reads the `(tasks, clickup)` watermark from `external_sync_watermarks`, invokes the
  adapter's `listChangesSinceWatermark('tasks', cursor)`, applies each change to the read-model via the
  service role, and advances the watermark to the returned `nextCursor` — the safety net that catches
  webhook gaps (ADR-0055 §3: webhooks for latency, sweep for truth).
- **FR-CUA-046** (event-driven) When the sweep applies a change already applied by a webhook (overlap), the
  apply shall be idempotent (FR-CUA-042 mechanism) so double-coverage is harmless; the watermark shall only
  ever advance (monotonic cursor), never rewind.
- **FR-CUA-047** (state-driven) While ClickUp is unreachable during a sweep, the sweep shall fail that org's
  cycle without advancing its watermark and shall retry on the next schedule; reads keep serving the
  existing read-model, and PMO-owned domains are entirely unaffected (ADR-0055 §4).
- **FR-CUA-048** (ubiquitous) The sweep schedule shall be conservative enough to stay within the ~100
  req/min free-tier budget across employing orgs (NFR-CUA-PERF-001) and shall be the cursor-of-record even
  when webhooks are healthy (webhooks accelerate; the sweep is authoritative).

### 3.8 Onboarding — push-seed (PMO → ClickUp at flip time)

- **FR-CUA-050** (event-driven) When a project's tasks are flipped to ClickUp-owned and the mapped List is
  empty on the ClickUp side, the system shall **push-seed**: for each existing PMO task in that project,
  issue a ClickUp `create` command, write the returned ClickUp id into `external_refs`, and leave the
  read-model row in place (now a mirror). The project's native task fields become ClickUp-owned only after
  its tasks are seeded/adopted.
- **FR-CUA-051** (ubiquitous — **idempotent + resumable**) Push-seed shall be idempotent and resumable: a
  task already carrying an `external_refs` mapping shall be skipped (never double-created), so a re-run after
  a partial failure completes the remainder without duplicating ClickUp tasks — `external_refs` is the
  resumption ledger.
- **FR-CUA-052** (ubiquitous) Push-seed shall push only the mapping-set fields (FR-CUA-010); PMO enhancements
  (milestone grouping, dependencies, weights) are **not** pushed — they remain PMO-side over the now-mirrored
  tasks (FR-CUA-024).

### 3.9 Onboarding — pull-adopt + List provisioning (ClickUp → read-model)

- **FR-CUA-060** (event-driven) When a project's tasks are flipped to ClickUp-owned and the mapped List
  already contains ClickUp tasks, the system shall **pull-adopt**: enumerate the List's tasks
  (`listChangesSinceWatermark` from a null cursor), upsert each as a mirrored read-model `tasks` row (via the
  service role), and record its `external_refs` mapping.
- **FR-CUA-061** (ubiquitous — **idempotent + resumable**) Pull-adopt shall be idempotent and resumable,
  keyed on `external_refs (org, 'tasks', pmo_record_id)` / the ClickUp task id, so a re-run reconciles rather
  than duplicates, and a partial run resumes from the watermark.
- **FR-CUA-062** (event-driven) When a ClickUp task with no existing mapping is adopted (via pull-adopt, the
  sweep, or a webhook — FR-CUA-044), the system shall mint a new PMO `tasks` read-model row (new
  `pmo_record_id`) belonging to the project's mapped List and record the mapping — so natively-created
  ClickUp tasks appear in PMO.
- **FR-CUA-063** (event-driven) When tasks are flipped to ClickUp-owned for a project and **no** ClickUp List
  is yet mapped, the system shall provision (or bind) one ClickUp List per PMO project under the client's
  configured Space/Folder, capture the per-List status map (FR-CUA-011) + member map (FR-CUA-013), and store
  the List binding — one List per project is the mapping unit (owner intake).

### 3.10 Pending-push state on task surfaces

- **FR-CUA-070** (event-driven) When a task native-field write is submitted on a task surface while tasks are
  externally-owned, that surface shall reflect the P0 shared pending-push behavior (`pendingPush.ts`:
  `idle`→`pushing`→`pushed`|`push-failed`) — composed, not re-implemented — on the **task board**, the
  **task list**, and the **task detail** surfaces (glossary Task surfaces).
- **FR-CUA-071** (state-driven) While tasks are PMO-owned for the org, no task surface shall introduce any
  pending-push state — a write has no in-flight external-push indicator (byte-for-byte; FR-CUA-030; P0
  FR-EAS-062).
- **FR-CUA-072** (event-driven) When a task write fails externally, the surface shall show `push-failed` with
  the classified error via the shared `{headline, detail}` contract (`external-unreachable` → "external
  system unreachable — try again"; `commit-rejected` → ClickUp's validation message) and shall leave the
  read-model row at its prior (pre-write) state (P0 FR-EAS-035/063).
- **FR-CUA-073** (event-driven) Where a surface needs snappiness (the task **board** drag), it may apply
  optimistic UI showing `pushing` immediately and reconcile on ClickUp's answer, reverting the card on
  `push-failed` (ADR-0055 §4 optimistic-per-surface; composes the shared behavior, semantics unchanged).

### 3.11 Enhancement integrity (mirrored-task deletion)

- **FR-CUA-080** (event-driven) When a mirrored task is deleted natively in ClickUp (webhook `taskDeleted`
  or discovered by the sweep), the system shall apply the deletion to the tasks read-model so it reflects
  ClickUp truth, and shall handle the task's PMO enhancements per **OD-CUA-2** (default: cascade-remove
  dependency edges referencing the task — the existing `task_dependencies` FK-cascade — and drop the row's
  milestone grouping with the row, surfacing the removal rather than silently vanishing it).
- **FR-CUA-081** (ubiquitous) Dependency edges and milestone/weight/rollup enhancements shall reference the
  mirrored task by its PMO `pmo_record_id` (stable across ClickUp edits), so an update-in-ClickUp preserves
  the PMO enhancement graph — only a **deletion** triggers FR-CUA-080.
- **FR-CUA-082** (event-driven) When a rollup or milestone-progress computation runs over a project whose
  tasks are mirrored, it shall compute over the read-model exactly as for PMO-owned tasks — the rollup engine
  is ownership-agnostic because it reads the read-model (FR-CUA-021).

### 3.12 Rate limits, batching, backoff, error surfaces

- **FR-CUA-090** (state-driven) While issuing ClickUp calls, the adapter shall respect a **~100 req/min
  budget** (free-tier floor) via a token-bucket/rate limiter, so bulk operations (push-seed, pull-adopt,
  sweep) do not exceed the budget.
- **FR-CUA-091** (event-driven) When ClickUp returns `429 Too Many Requests` (or a 5xx transient), the
  adapter shall **back off** (respecting `Retry-After` when present) and retry up to a bounded budget before
  surfacing `external-unreachable`; a `429` mid-bulk shall pause and resume, never drop, the remaining work.
- **FR-CUA-092** (ubiquitous) Bulk operations (push-seed, pull-adopt, sweep) shall **batch/paginate** within
  the budget and be resumable from `external_refs`/the watermark (FR-CUA-051/061/046), so a rate-limit
  interruption never corrupts or duplicates state.
- **FR-CUA-093** (ubiquitous) Every error surface shall be classified per the P0 contract: `commit-rejected`
  (ClickUp validation/4xx) → in-form `{headline, detail}` toast carrying ClickUp's message;
  `external-unreachable` (unreachable / budget-exhausted / 5xx) → "external system unreachable — try again";
  PMO-owned task errors → unchanged existing codes (FR-CUA-030).

## 4. Non-functional requirements

- **NFR-CUA-SEC-001** (tenancy + authority) The tasks flip shall keep RLS the enforcement authority: while
  tasks are externally-owned, user-JWT writes to `tasks` native fields are denied and only the dispatch/sync
  service role writes the read-model (FR-CUA-020); `external_refs`/`external_sync_watermarks` stay
  machine-written only (P0); `org_id` is never sent by the client. The FE routing branch may be stricter but
  is never the authority (ADR-0016). Proven by pgTAP.
- **NFR-CUA-SEC-002** (webhook trust boundary) The ClickUp webhook ingress shall treat the request as
  untrusted until the `X-Signature` HMAC is verified against the per-org secret (FR-CUA-041); secrets live in
  1Password vault `AS` / Supabase function secrets, never in the DB or client, never logged (env-file-privacy
  rule). No signature ⇒ no side effect.
- **NFR-CUA-SEC-003** (no secret leakage / least privilege) The ClickUp API token and webhook secret are
  per-client, server-only (edge function env); no ClickUp credential shall reach the browser bundle or any
  read-model column. The adapter runs PMO-side in edge functions only (ADR-0055 §2).
- **NFR-CUA-PERF-001** (rate budget) The adapter shall stay within ClickUp's ~100 req/min free-tier budget
  under bulk load (push-seed/pull-adopt/sweep) via rate-limiting + batching (FR-CUA-090/092); the sweep
  schedule shall be sized so concurrent employing orgs collectively stay within budget.
- **NFR-CUA-PERF-002** (no added latency on the invariant path) The task-repository routing decision shall
  add **no round-trip** for PMO-owned orgs: it consults the cached (TanStack) own-org ownership map and
  short-circuits in-memory; the non-ClickUp write path is byte-for-byte the direct DAL with no dispatch hop
  (FR-CUA-030; P0 NFR-EAS-PERF-001).
- **NFR-CUA-CONTRACT-001** (single coupling seam) ClickUp is the sole external system named in P1, and
  **only** under `adapterSeam/clickup/**` + the webhook edge function; no code above the adapter contract
  references any ClickUp shape (FR-CUA-012; P0 NFR-EAS-CONTRACT-001).
- **NFR-CUA-REV-001** (reversibility) The tasks-flip migration (generalizing 0090 onto `tasks`) shall be
  reversible (drop the added `domain_externally_owned` gates + trigger changes, restoring 0002/0016
  behavior), follow additive migration discipline, and ship pgTAP proofs; releasing the tasks domain
  (Operator `release`) restores PMO-owned writes for that org with no data change.
- **NFR-CUA-LOCALITY-001** (stated data-locality asymmetry) The product/client-facing material shall state
  that ClickUp is **US-hosted SaaS** — task-domain data resides with ClickUp, unlike self-hosted ERPs
  (ADR-0055 §7); the Integrations view shall note this for the ClickUp tier. (Client-comms NFR, not a runtime
  test — verified at doc review.)
- **NFR-CUA-TEST-001** (pyramid, MOCKED-only) All ClickUp interaction shall be provable against
  recorded/mocked ClickUp REST v2 responses (owner intake): Vitest with a mocked `fetch`/HTTP boundary for
  adapter mapping, rate-limit/backoff, webhook-apply idempotency, sweep-cursor, and onboarding
  idempotency/resumability; **pgTAP** for the tasks-flip RLS + org isolation; **≤2 curated e2e** for the
  genuine cross-stack task-write-through journey against a mock ClickUp HTTP server. No test requires a live
  ClickUp token or a real ClickUp workspace. A live-smoke checklist (Appendix A) is deferred until a token
  exists in 1Password.

## 5. Acceptance criteria (Given/When/Then)

> The byte-for-byte invariant (AC-CUA-001) and the tasks-flip RLS (AC-CUA-020..022) are the heart of P1.
> Flip-RLS + org-isolation ACs are **pgTAP**; adapter mapping / commands / reads / rate-limit / webhook-apply
> / sweep / onboarding / pending-push ACs are **Vitest** (mocked ClickUp); the one cross-stack write-through
> journey is **e2e**. Each AC is owned by exactly one test at its lowest sufficient layer (ADR-0010).

### The byte-for-byte invariant (critical regression)

- **AC-CUA-001** — No ClickUp employed ⇒ task writes take the direct-DAL path (byte-for-byte).
  **Given** an org with no `tasks`→`clickup` assignment (the shipped default) and any task write
  (create/update/status/delete/dependency),
  **When** the write is performed,
  **Then** it executes through the existing direct DAL — no adapter dispatch is invoked, no dispatch
  edge-function is called, no pending-push state is produced — and the observable result (row written,
  returned shape, error `code` on failure) is identical to the pre-P1 system. (FR-CUA-030, FR-CUA-023,
  FR-CUA-071)

- **AC-CUA-002** — The pre-P1 task acceptance suite remains green (zero regression).
  **Given** the ClickUp adapter + tasks-flip migration are installed and no org employs ClickUp,
  **When** the existing suite (Vitest + pgTAP + e2e) runs unchanged,
  **Then** every previously-passing task test still passes. (FR-CUA-030) *(Owning layer: cross-layer
  regression gate — the unchanged existing suite IS the proof; a meta-AC, see traceability.)*

### Tasks-flip RLS (pgTAP)

- **AC-CUA-020** — While tasks externally-owned, a user-JWT native-field write is RLS-denied; the service
  role writes.
  **Given** org A has `tasks`→`clickup` and a mirrored `tasks` row,
  **When** a member of org A (user JWT) attempts to `INSERT`/`UPDATE`(name/status/assignee/dates)/`DELETE`
  the row, **then** the write is denied (`42501`); **and when** the dispatch/sync service role writes,
  **then** it succeeds. (FR-CUA-020, NFR-CUA-SEC-001)

- **AC-CUA-021** — While tasks externally-owned, the enhancement column stays user-writable.
  **Given** org A has `tasks`→`clickup` and a mirrored `tasks` row,
  **When** a delivery-role member updates the row's `milestone_id` (grouping) or writes a
  `task_dependencies` edge, **then** it succeeds (enhancements are PMO-side); **and when** the same member
  changes a native field on that row, **then** it is denied (`42501`). (FR-CUA-024, OD-CUA-1)

- **AC-CUA-022** — Releasing the tasks domain restores PMO-owned writes (reversibility).
  **Given** org A previously had `tasks`→`clickup` and the Operator `release`s it,
  **When** a delivery-role member performs a native-field task write,
  **Then** it succeeds under the restored 0002/0016 behavior with no data change. (NFR-CUA-REV-001)

- **AC-CUA-023** — The tasks flip is org-scoped (org B unaffected).
  **Given** org A has `tasks`→`clickup` and org B does not,
  **When** a delivery-role member of org B performs a native-field task write,
  **Then** it succeeds via the direct path (org B is byte-for-byte pre-P1). (FR-CUA-030, FR-CUA-020)

### Adapter — commands, reads, mapping (Vitest, mocked ClickUp)

- **AC-CUA-030** — The ClickUp adapter implements the contract in PMO domain language.
  **Given** the ClickUp adapter,
  **When** its contract surface is inspected,
  **Then** `tier === 'clickup'`, `capabilityMap === {'tasks'}`, and it exposes `commit` +
  `listChangesSinceWatermark` + `getByExternalId` typed only in PMO domain language (no ClickUp vocabulary
  crosses the contract). (FR-CUA-001, FR-CUA-012)

- **AC-CUA-031** — A create command maps to ClickUp and returns the external id + canonical record.
  **Given** the adapter with a mocked ClickUp returning a created task,
  **When** a `create` command for the tasks domain is issued,
  **Then** the adapter calls `POST /list/{list_id}/task` with the mapping-set fields and returns the ClickUp
  task id as `externalRecordId` plus the canonical PMO record. (FR-CUA-002, FR-CUA-010)

- **AC-CUA-032** — Update/transition/delete map to the right ClickUp calls via `external_refs`.
  **Given** the adapter with an existing `external_refs` mapping,
  **When** `update`, `transition`, and `delete` commands are issued,
  **Then** the adapter calls `PUT /task/{id}` (fields), `PUT /task/{id}` (mapped status), and `DELETE
  /task/{id}` respectively, resolving the ClickUp id from the mapping. (FR-CUA-003/004/005)

- **AC-CUA-033** — A ClickUp rejection vs unreachability surfaces as the right classified error.
  **Given** the adapter with mocked ClickUp returning (a) `400` validation then (b) repeated `5xx`/timeout,
  **When** a command is issued in each mode,
  **Then** (a) raises `AdapterError('commit-rejected', <message>)` and (b) raises
  `AdapterError('external-unreachable', …)` after the retry budget. (FR-CUA-006, FR-CUA-091)

- **AC-CUA-034** — Status mapping is bounded by the per-List status map.
  **Given** a per-List status map covering PMO statuses `{S1,S2}`,
  **When** a `transition` to a mapped `S1` and to an unmapped `S3` are issued,
  **Then** `S1` maps to the List's configured status and `S3` raises `commit-rejected` (config). (FR-CUA-011)

- **AC-CUA-035** — `listChangesSinceWatermark` pages modified-since and advances the cursor.
  **Given** the adapter with mocked ClickUp returning two pages of tasks modified after a cursor,
  **When** `listChangesSinceWatermark('tasks', cursor)` is invoked and iterated,
  **Then** it returns canonical PMO records for the changed tasks and a `nextCursor` that advances, `null` at
  exhaustion. (FR-CUA-007)

- **AC-CUA-036** — `getByExternalId` returns the canonical record or null on 404.
  **Given** the adapter with mocked ClickUp returning a task then a `404`,
  **When** `getByExternalId('tasks', id)` is invoked in each,
  **Then** it returns the canonical PMO record, then `null`. (FR-CUA-008)

- **AC-CUA-037** — Unmapped assignee pushes as unassigned (surfaced), not a hard failure.
  **Given** a command whose assignee has no member-map entry,
  **When** the create/update command is issued,
  **Then** the ClickUp call omits the assignee (unassigned) and the outcome is surfaced, not thrown.
  (FR-CUA-013)

### Change-feed — webhook ingress + sweep (Vitest, mocked)

- **AC-CUA-040** — Webhook signature verification is the trust boundary.
  **Given** the webhook ingress handler and a per-org secret,
  **When** a request arrives with (a) a valid `X-Signature` HMAC and (b) an absent/invalid one,
  **Then** (a) is processed and (b) is rejected `401` with no read-model side effect. (FR-CUA-041,
  NFR-CUA-SEC-002)

- **AC-CUA-041** — Webhook apply is idempotent under re-delivery.
  **Given** a valid `taskUpdated` event,
  **When** it is delivered twice,
  **Then** the read-model converges to the same single state (no double-apply) and the watermark advances
  monotonically. (FR-CUA-042, FR-CUA-043)

- **AC-CUA-042** — A webhook for an unmapped task adopts it as a new mirror.
  **Given** a `taskCreated` webhook for a ClickUp task with no `external_refs` mapping,
  **When** it is applied,
  **Then** a new mirrored PMO `tasks` row + mapping are created (pull-adopt path), not dropped. (FR-CUA-044,
  FR-CUA-062)

- **AC-CUA-043** — The sweep applies changes since the watermark and advances it monotonically.
  **Given** a stored `(tasks, clickup)` watermark and the adapter returning changes since it,
  **When** the sweep runs,
  **Then** each change is applied to the read-model (service role) and the watermark advances to
  `nextCursor`; overlap with a prior webhook apply is harmless (idempotent). (FR-CUA-045, FR-CUA-046)

- **AC-CUA-044** — ClickUp-unreachable sweep does not advance the watermark and leaves PMO-owned domains
  unaffected.
  **Given** the adapter configured unreachable during a sweep,
  **When** the sweep runs,
  **Then** the org's watermark is not advanced, the read-model is unchanged, and a concurrent PMO-owned
  write succeeds. (FR-CUA-047)

### Onboarding — push-seed + pull-adopt (Vitest, mocked)

- **AC-CUA-050** — Push-seed creates ClickUp tasks for PMO tasks and records mappings, idempotently.
  **Given** a project with PMO tasks flipping to ClickUp and an empty mapped List,
  **When** push-seed runs and is then re-run,
  **Then** the first run creates one ClickUp task per PMO task and records `external_refs`; the re-run
  creates nothing new (already-mapped tasks skipped). (FR-CUA-050, FR-CUA-051)

- **AC-CUA-051** — Push-seed is resumable after a partial failure.
  **Given** a push-seed that failed after seeding a subset,
  **When** it is resumed,
  **Then** only the unmapped remainder is created — no ClickUp task is duplicated. (FR-CUA-051, FR-CUA-092)

- **AC-CUA-052** — Push-seed pushes only mapping-set fields, not enhancements.
  **Given** PMO tasks carrying milestone grouping + dependencies,
  **When** push-seed runs,
  **Then** only name/status/assignee/dates are pushed; no milestone/dependency data is sent to ClickUp.
  (FR-CUA-052, FR-CUA-024)

- **AC-CUA-053** — Pull-adopt mirrors existing ClickUp tasks idempotently + resumably.
  **Given** a project flipping to ClickUp whose mapped List already has tasks,
  **When** pull-adopt runs and is re-run,
  **Then** the first run upserts one mirrored `tasks` row + mapping per ClickUp task; the re-run reconciles
  without duplicating; a partial run resumes from the watermark. (FR-CUA-060, FR-CUA-061)

### Pending-push on task surfaces (Vitest / RTL)

- **AC-CUA-060** — A task-board write shows pushing→pushed on success and push-failed on failure.
  **Given** the task board with tasks externally-owned (composing the shared pending-push behavior),
  **When** a card write commits, **then** the card shows `pushing` then `pushed`; **when** the next write is
  submitted with ClickUp unreachable, **then** it shows `push-failed` and reverts to the prior read-model
  state. (FR-CUA-070, FR-CUA-072, FR-CUA-073)

- **AC-CUA-061** — PMO-owned task writes show no pending-push on any surface.
  **Given** tasks PMO-owned,
  **When** a write is submitted on board / list / detail,
  **Then** no `pushing`/`pushed`/`push-failed` state appears. (FR-CUA-071, FR-CUA-030)

- **AC-CUA-062** — `push-failed` surfaces the classified ClickUp error via the shared contract.
  **Given** an externally-owned task write that fails (unreachable / rejected),
  **When** `push-failed` is reached,
  **Then** the shared `{headline, detail}` contract is shown (`external-unreachable` → "external system
  unreachable — try again"; `commit-rejected` → ClickUp's message). (FR-CUA-072, FR-CUA-093)

### Enhancement integrity (Vitest, mocked)

- **AC-CUA-070** — A ClickUp deletion removes the mirror and cascades dependency edges (non-silent).
  **Given** a mirrored task with a dependency edge and milestone grouping, and a `taskDeleted` webhook,
  **When** it is applied,
  **Then** the read-model row is removed, its dependency edges are cascade-removed, and the removal is
  surfaced (not silent) per OD-CUA-2. (FR-CUA-080, FR-CUA-081)

- **AC-CUA-071** — Update-in-ClickUp preserves the PMO enhancement graph.
  **Given** a mirrored task with dependencies + milestone grouping and a `taskUpdated` webhook,
  **When** it is applied,
  **Then** the native fields update and the dependency/milestone enhancements (keyed on `pmo_record_id`)
  remain intact. (FR-CUA-081)

- **AC-CUA-072** — Rollup computes identically over mirrored tasks.
  **Given** a project whose tasks are mirrored (externally-owned) with weights/milestones,
  **When** milestone-progress/rollup is computed,
  **Then** the result equals the computation over an equivalent PMO-owned project (ownership-agnostic read).
  (FR-CUA-082, FR-CUA-021)

### Rate limits (Vitest, mocked)

- **AC-CUA-080** — Bulk operations stay within the request budget and back off on 429.
  **Given** a push-seed/pull-adopt of N tasks with a mocked rate limiter and a mocked `429` mid-run,
  **When** the bulk operation runs,
  **Then** it never exceeds the ~100 req/min budget, backs off on the `429` (respecting `Retry-After`), and
  resumes to completion without dropping or duplicating work. (FR-CUA-090, FR-CUA-091, FR-CUA-092)

### The cross-stack journey (e2e — ≤2, mocked ClickUp HTTP server)

- **AC-CUA-090** — Employed-ClickUp task write-through journey (the one genuine cross-stack flow).
  **Given** a running app + a mock ClickUp HTTP server, an org with `tasks`→`clickup` for a project with a
  mirrored task,
  **When** a user changes the task's status on the board,
  **Then** the card shows `pushing`, the dispatch commits to (mock) ClickUp, the read-model updates from
  ClickUp's answer, the card settles to `pushed`, and a reload shows the mirrored status — proving
  repository→dispatch→adapter→ClickUp→read-model end to end. (FR-CUA-022, FR-CUA-025, FR-CUA-070)

- **AC-CUA-091** *(optional 2nd e2e — plan may fold into AC-CUA-090)* — Webhook-driven read-model update
  reflected in the UI.
  **Given** the same employed-ClickUp project and an open task board,
  **When** the mock ClickUp posts a signed `taskUpdated` webhook,
  **Then** the ingress applies it and the board reflects the mirrored change on refresh. (FR-CUA-040,
  FR-CUA-043)

## 6. Traceability

| AC | Requirement(s) | Owning layer | Planned test file |
|---|---|---|---|
| AC-CUA-001 | FR-CUA-030, FR-CUA-023, FR-CUA-071 | Vitest (unit) | `pmo-portal/src/lib/repositories/task.external.test.ts` |
| AC-CUA-002 | FR-CUA-030 | **Cross-layer regression gate** — the unchanged existing task suite (`npm run verify` + pgTAP + e2e) staying green IS the proof; no single new test |
| AC-CUA-020 | FR-CUA-020, NFR-CUA-SEC-001 | pgTAP | `supabase/tests/tasks_external_owned_rls.test.sql` |
| AC-CUA-021 | FR-CUA-024, OD-CUA-1 | pgTAP | `supabase/tests/tasks_external_owned_rls.test.sql` |
| AC-CUA-022 | NFR-CUA-REV-001 | pgTAP | `supabase/tests/tasks_external_owned_rls.test.sql` |
| AC-CUA-023 | FR-CUA-030, FR-CUA-020 | pgTAP | `supabase/tests/tasks_external_owned_rls.test.sql` |
| AC-CUA-030 | FR-CUA-001, FR-CUA-012 | Vitest (unit) | `pmo-portal/src/lib/adapterSeam/clickup/adapter.test.ts` |
| AC-CUA-031 | FR-CUA-002, FR-CUA-010 | Vitest (unit) | `pmo-portal/src/lib/adapterSeam/clickup/commands.test.ts` |
| AC-CUA-032 | FR-CUA-003/004/005 | Vitest (unit) | `pmo-portal/src/lib/adapterSeam/clickup/commands.test.ts` |
| AC-CUA-033 | FR-CUA-006, FR-CUA-091 | Vitest (unit) | `pmo-portal/src/lib/adapterSeam/clickup/commands.test.ts` |
| AC-CUA-034 | FR-CUA-011 | Vitest (unit) | `pmo-portal/src/lib/adapterSeam/clickup/statusMap.test.ts` |
| AC-CUA-035 | FR-CUA-007 | Vitest (unit) | `pmo-portal/src/lib/adapterSeam/clickup/reads.test.ts` |
| AC-CUA-036 | FR-CUA-008 | Vitest (unit) | `pmo-portal/src/lib/adapterSeam/clickup/reads.test.ts` |
| AC-CUA-037 | FR-CUA-013 | Vitest (unit) | `pmo-portal/src/lib/adapterSeam/clickup/memberMap.test.ts` |
| AC-CUA-040 | FR-CUA-041, NFR-CUA-SEC-002 | Vitest (unit) | `pmo-portal/src/lib/adapterSeam/clickup/webhookApply.test.ts` |
| AC-CUA-041 | FR-CUA-042, FR-CUA-043 | Vitest (unit) | `pmo-portal/src/lib/adapterSeam/clickup/webhookApply.test.ts` |
| AC-CUA-042 | FR-CUA-044, FR-CUA-062 | Vitest (unit) | `pmo-portal/src/lib/adapterSeam/clickup/webhookApply.test.ts` |
| AC-CUA-043 | FR-CUA-045, FR-CUA-046 | Vitest (unit) | `pmo-portal/src/lib/adapterSeam/clickup/sweep.test.ts` |
| AC-CUA-044 | FR-CUA-047 | Vitest (unit) | `pmo-portal/src/lib/adapterSeam/clickup/sweep.test.ts` |
| AC-CUA-050 | FR-CUA-050, FR-CUA-051 | Vitest (unit) | `pmo-portal/src/lib/adapterSeam/clickup/onboarding.test.ts` |
| AC-CUA-051 | FR-CUA-051, FR-CUA-092 | Vitest (unit) | `pmo-portal/src/lib/adapterSeam/clickup/onboarding.test.ts` |
| AC-CUA-052 | FR-CUA-052, FR-CUA-024 | Vitest (unit) | `pmo-portal/src/lib/adapterSeam/clickup/onboarding.test.ts` |
| AC-CUA-053 | FR-CUA-060, FR-CUA-061 | Vitest (unit) | `pmo-portal/src/lib/adapterSeam/clickup/onboarding.test.ts` |
| AC-CUA-060 | FR-CUA-070, FR-CUA-072, FR-CUA-073 | Vitest (unit, RTL) | `pmo-portal/src/components/tasks/TaskBoard.pendingPush.test.tsx` |
| AC-CUA-061 | FR-CUA-071, FR-CUA-030 | Vitest (unit, RTL) | `pmo-portal/src/components/tasks/TaskSurfaces.pendingPush.test.tsx` |
| AC-CUA-062 | FR-CUA-072, FR-CUA-093 | Vitest (unit) | `pmo-portal/src/lib/adapterSeam/pendingPush.clickup.test.ts` |
| AC-CUA-070 | FR-CUA-080, FR-CUA-081 | Vitest (unit) | `pmo-portal/src/lib/adapterSeam/clickup/deletion.test.ts` |
| AC-CUA-071 | FR-CUA-081 | Vitest (unit) | `pmo-portal/src/lib/adapterSeam/clickup/webhookApply.test.ts` |
| AC-CUA-072 | FR-CUA-082, FR-CUA-021 | Vitest (unit) | `pmo-portal/src/lib/rollup/mirroredTasks.test.ts` |
| AC-CUA-080 | FR-CUA-090, FR-CUA-091, FR-CUA-092 | Vitest (unit) | `pmo-portal/src/lib/adapterSeam/clickup/rateLimit.test.ts` |
| AC-CUA-090 | FR-CUA-022, FR-CUA-025, FR-CUA-070 | **e2e** | `pmo-portal/e2e/AC-CUA-090-clickup-task-writethrough.spec.ts` |
| AC-CUA-091 | FR-CUA-040, FR-CUA-043 | **e2e** (optional) | `pmo-portal/e2e/AC-CUA-091-clickup-webhook-reflect.spec.ts` |

> NFR-CUA-CONTRACT-001 / SEC-003 / PERF-002 are structural — proven transitively (contract-shape +
> confinement + cached-map short-circuit are preconditions exercised by the rows above) and reviewed at the
> plan/gate. NFR-CUA-LOCALITY-001 is a doc-review NFR (no runtime test). NFR-CUA-PERF-001 is exercised by
> AC-CUA-080. AC-CUA-002 is a regression-gate meta-AC by nature.

## 7. Error handling

| Error condition | Classification | User-facing surface | Notes |
|---|---|---|---|
| No ClickUp employed (default) | — (no error) | Normal direct-DAL task path; identical to pre-P1 | The invariant path (FR-CUA-030) |
| ClickUp rejects a task command (validation / 4xx) | `commit-rejected` | `{headline, detail}` toast carrying ClickUp's message; `push-failed` on the surface | Read-model not updated; row stays at prior state (FR-CUA-072) |
| ClickUp unreachable / budget-exhausted / 5xx after retries | `external-unreachable` | "external system unreachable — try again"; `push-failed` | Write fails honestly; reads keep serving the read-model; PMO-owned domains unaffected (FR-CUA-047/093) |
| `429 Too Many Requests` mid-bulk | (transient) | (none — internal backoff) | Back off + `Retry-After`, resume; never drop/duplicate (FR-CUA-091/092) |
| Unmapped assignee on a command | (surfaced, not thrown) | pushes as unassigned + notice | Best-effort member map (FR-CUA-013) |
| Unmappable target status | `commit-rejected` (config) | "this status has no ClickUp equivalent" | Per-List status map bound (FR-CUA-011) |
| Webhook: absent/invalid `X-Signature` | `401` | (none — rejected at ingress) | Trust boundary; no side effect (FR-CUA-041) |
| User-JWT native-field write while tasks externally-owned | `42501` | "you don't have permission" | RLS flip authority (FR-CUA-020) |
| Mirrored task deleted in ClickUp | (applied) | mirror + dependency edges removed, surfaced | OD-CUA-2 default (FR-CUA-080) |
| PMO-owned task error | unchanged | existing error `code` + existing classifier | Byte-for-byte preserved (FR-CUA-030) |

## 8. Implementation TODO (build-plan inputs — docs only here)

### ClickUp adapter (`pmo-portal/src/lib/adapterSeam/clickup/**` — pure, Deno-importable, mocked-testable)
- [ ] Adapter object: `tier='clickup'`, `capabilityMap={'tasks'}`, `commit`/`listChangesSinceWatermark`/
      `getByExternalId` (AC-CUA-030..036); ClickUp REST v2 client behind an injected `fetch` boundary.
- [ ] Field mapping (mapping set only), per-List status map + member map (AC-CUA-031/034/037); vocabulary
      confined here (FR-CUA-012).
- [ ] Rate limiter (token bucket) + backoff/retry (`Retry-After`) (AC-CUA-080).
- [ ] Register the adapter in `supabase/functions/adapter-dispatch/index.ts` keyed by `tasks` (replace the
      P0 `// P1 routes per domain` seam).

### Tasks-flip migration + pgTAP (generalize 0090 onto the real `tasks` table)
- [ ] Migration (next number ≥0091): add `and not domain_externally_owned(auth_org_id(),'tasks')` to
      `tasks_write` + `tasks_update_own_status` USING/WITH CHECK, and to the `enforce_assignee_status_only`
      trigger's user-path; keep the enhancement column(s) user-writable per OD-CUA-1; permit service-role
      read-model writes. Reversible (restore 0002/0016). (AC-CUA-020..023)
- [ ] pgTAP: deny user-JWT native write / permit service role / enhancement writable / release restores /
      org-scoped (AC-CUA-020..023).

### Repository wiring (interface UNCHANGED — ADR-0017)
- [ ] Branch `createTask`/`updateTask`/`updateTaskStatus`/`deleteTask` through
      `executeWriteWithPendingPush` (externally-owned ⇒ dispatch ClickUp command; PMO-owned ⇒ direct DAL
      short-circuit); reads unchanged; dependency/milestone writes stay direct (AC-CUA-001/021/024).

### Change-feed engine (new in P1)
- [ ] `supabase/functions/clickup-webhook` ingress: signature verify → idempotent apply → watermark advance
      (AC-CUA-040..042); pure apply logic in `clickup/webhookApply.ts` (unit-tested).
- [ ] Reconciliation sweep (scheduled): read watermark → `listChangesSinceWatermark` → apply → advance
      (AC-CUA-043/044); pure cursor logic in `clickup/sweep.ts`.

### Onboarding
- [ ] Push-seed + pull-adopt + List/status/member provisioning; idempotent + resumable via `external_refs`/
      watermark (AC-CUA-050..053).

### Pending-push on task surfaces
- [ ] Compose `pendingPush.ts` on board/list/detail; optimistic board drag (AC-CUA-060..062).

### Enhancement integrity
- [ ] Apply ClickUp deletion to read-model + cascade dependencies, non-silent (OD-CUA-2); rollup over mirror
      (AC-CUA-070..072).

### Verification (final gate — from `pmo-portal/` + repo root)
- [ ] `npm run verify` green (incl. the AC-CUA-002 regression net).
- [ ] `scripts/with-db-lock.sh supabase test db` green (tasks-flip pgTAP band).
- [ ] `scripts/with-db-lock.sh npx playwright test` green for AC-CUA-090 (mock ClickUp HTTP server).

## 9. Out of scope (explicit — later phases)

- **ERPNext (P2/P3) and Odoo (P4) adapters** and any of their API specifics (Frappe REST, Odoo JSON-RPC).
- **ClickUp custom fields beyond the mapping set** — comments, checklists, tags, attachments, priority,
  time-tracking, custom fields; ClickUp sub-tasks / nested hierarchy beyond PMO's two-level milestone→task
  model.
- **Real-time collaborative editing / presence** in ClickUp (change-feed is webhook + sweep, not live sync).
- **Deep user/member directory sync** — assignee mapping is best-effort per FR-CUA-013; a full profile↔member
  sync is later.
- **A write-capable Integrations admin surface** — the Operator provisions the tasks flip + per-client
  ClickUp config via the P0 RPC/secrets (the read-only Integrations view from P0 shows state).
- **Per-client secret provisioning wiring in 1Password** beyond naming the pattern (ClickUp API token +
  webhook secret in vault `AS` / function secrets) — operational, per-client.
- **Live ClickUp smoke** — deferred to Appendix A until a real token exists in 1Password (owner intake:
  mocked-only in P1).
- **The generic backfill/promote runbook** for domains other than tasks (ADR-0055 consequence).

## 10. Open questions / owner-decision flags

- **[OWNER-DECISION] OD-CUA-1 — Enhancement-column write mechanism on the mirrored `tasks` row.** The
  `tasks` row carries native ClickUp-owned fields **and** the PMO enhancement column `milestone_id`
  (grouping). While tasks are externally-owned we must deny user writes to the native fields yet keep
  `milestone_id` (and future weight) user-writable. **Recommended default:** extend the existing
  `enforce_assignee_status_only` column-pin trigger pattern (0016) so that, while
  `domain_externally_owned(...,'tasks')`, a user-JWT `UPDATE` may change **only** enhancement columns
  (`milestone_id`) and native-field changes raise `42501` — no schema migration of `milestone_id`, matches
  the shipped column-pin idiom. **Alternative:** move enhancements to a separate `task_enhancements` table
  (task_id → milestone_id/weight) so the `tasks` table is a pure native-field read-model (cleanest per
  ADR-0055 "enhancements are additive, never a native field", but a larger refactor touching milestones /
  gantt / rollup). Decision governs AC-CUA-021.
- **[OWNER-DECISION] OD-CUA-2 — Mirrored-task deletion policy.** When a mirrored task is deleted natively in
  ClickUp, what happens to the PMO read-model row and its enhancements? **Recommended default:** hard-remove
  the read-model row (read-model must reflect ClickUp truth), cascade-remove dependency edges (existing
  `task_dependencies` FK cascade), drop the milestone grouping with the row, and **surface** the removal (a
  notice / audit event) — never silent. **Alternative:** soft-tombstone the mirrored row (`deleted_at`,
  retained read-only for audit + to preserve dependency/rollup lineage) until an Operator prunes it.
  Decision governs FR-CUA-080 / AC-CUA-070.
- **[OWNER-DECISION] OD-CUA-3 — Mixed-onboarding matching (both sides non-empty).** Owner intake supports
  both directions cleanly: push-seed when the mapped List is empty, pull-adopt when the PMO project has no
  tasks. When **both** the PMO project AND the mapped ClickUp List already hold tasks at flip time, how do we
  reconcile (avoid creating duplicate mirrors)? **Recommended default:** P1 supports only the two clean
  directions — a project flips either by seeding an empty List or adopting into an empty project; the
  mixed case is **rejected at provisioning** with an operator-facing "List and project both non-empty —
  choose a clean direction" and deferred to a later reconcile/matching runbook (name-match heuristics are
  error-prone). **Alternative:** best-effort name-match dedupe in P1. Decision governs FR-CUA-050/060 and
  whether an extra AC is added.
- **OQ-1 — Watermark cursor type for ClickUp.** ClickUp exposes `date_updated` (unix-ms); P1 will use it as
  the modified-since cursor (`date_updated_gt`). Confirm at plan time this is monotonic + stable under the
  free tier; the P0 `external_sync_watermarks.watermark_cursor` is text and accommodates it (P0 OQ-1).
- **OQ-2 — Sweep scheduler substrate.** Whether the reconciliation sweep runs on `pg_cron` (like the agent
  automations tick) or an external scheduler is a plan detail; either satisfies FR-CUA-045/048 within the
  rate budget.

---

## Appendix A — Live-smoke checklist (DEFERRED — owner intake: mocked-only in P1)

> Not part of P1's acceptance surface. To be run once a real ClickUp API token + webhook secret exist in
> 1Password vault `AS` and a throwaway ClickUp workspace is available. Until then every AC above is proven
> against recorded/mocked ClickUp REST v2 responses.

- [ ] Provision a test ClickUp Space/Folder + List; store token + webhook secret in vault `AS`.
- [ ] Flip a test project's tasks to `clickup`; push-seed; confirm ClickUp tasks appear 1:1.
- [ ] Edit a task in PMO (status on the board) → confirm the change lands in ClickUp; pending-push settles.
- [ ] Edit a task natively in ClickUp → confirm the webhook applies + the board reflects it.
- [ ] Delete a task in ClickUp → confirm the mirror + dependency edges are removed (OD-CUA-2).
- [ ] Drive the ~100 req/min budget with a bulk seed → confirm backoff, no drops/duplicates.
- [ ] Confirm the US-hosted data-locality note renders on the ClickUp Integrations tier (NFR-CUA-LOCALITY-001).
