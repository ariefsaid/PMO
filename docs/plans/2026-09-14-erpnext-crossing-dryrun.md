# ERPNext standalone → connected crossing dry-run (#481, step 4 of #590)

- **Issue:** [#481](https://github.com/ariefsaid/PMO/issues/481) (parent [#590](https://github.com/ariefsaid/PMO/issues/590))
- **Rulings that bind this plan:** `OD-XING-1` (supersedes `DD-XING-3`), `DD-XING-2`, `DD-XING-4`, `DD-XING-5`,
  ADR-0059 (Posture B; §4 derived keys, §5 the SoT-inversion guard, invariant 7), ADR-0058 (the fenced outbox).
- **Executor:** ⛔ **Director-dispatched, never the factory** (`DD-XING-5`) — this run writes money-shaped
  documents into a real ERP.
- **Nothing in this plan is authorised against the hosted Supabase project or against `production`.** The PMO
  side is the LOCAL Docker stack only.

---

## Premises I could not confirm

Written first, because a plan built on any of these would be worse than no plan. Each was checked against the
artefact that decides it, not against a document describing it.

**P-1 — "the version handshake stamps `external_org_bindings.version_major`" is not a live code path.**
The handshake helpers live in `pmo-portal/src/lib/adapterSeam/erpnext/binding.ts`, and at the time this
plan was written `grep -rn activateBinding` found **no production call site** — only `binding.test.ts`.
Every binding that exists
today (`supabase/seed.sql`, the served-fn e2e helpers, operator SQL) writes `version_major` and `activated_at`
**by hand**. *(Review follow-up, #650: the dead `activateBinding` twin has since been deleted;
`activate_external_binding` is the one writer.)* Consequences for this run:

- the constant is `SUPPORTED_VERSION_MAJOR = 15` (`binding.ts:11`), so if the handshake were ever wired it would
  return `activatedAt: null` against a v16 site and **refuse to activate**;
- nothing at runtime reads `version_major` as a gate. `resolveErpDispatchAdapter`
  (`dispatchFactory.ts:831-844`) gates only on `activated_at`; the sweep uses `version_major` purely as aging-
  snapshot provenance (`reportVersionFromOrg`, `erpnext-sweep/index.ts:976`).

So a v16 target is reachable **today** without a code change, and the v15 pin is a latent trap rather than a
blocker. The dry-run must therefore also *record* that the handshake is unwired — that is a real #590 finding.

**P-2 — `external-connect` cannot, by itself, produce a binding the money path can use.**
Its ERPNext branch (`supabase/functions/external-connect/index.ts:340-378`) validates the credential
(HTTPS + SSRF guard + `GET /api/resource/User/<apiKey>`) and calls `create_vault_secret_for_org`. That RPC
(`0180_rpc_active_member_gate.sql:1066`) inserts the binding with **`site_url = ''`, no `config`, no
`activated_at`, no `version_major`**, and — unlike the ClickUp branch — the ERPNext branch calls neither
`finalize_external_connect` nor `admin_change_domain_ownership`. The result is a fail-closed binding: correct,
but not connected. The brief's "ingress via `external-connect`, never a direct insert" is therefore achievable
only as *credential* ingress; the connect state itself still needs operator SQL. The plan does both, in that
order, and asserts each half separately (task R2/R3).

**P-3 — the two credential resolvers disagree, so the run needs BOTH.**
The sweep's *poll* path is Vault-first (`erpnext-sweep/index.ts:660-716`, falling back to the env resolver on
`no-binding` / `binding-vault-miss`). Every *write* path — `adapter-dispatch`'s ERPNext adapter
(`adapter-dispatch/index.ts:233,274`), the sweep's outbox reconcile (`erpnext-sweep/index.ts:1857`) and its
fiscal-calendar read (`:2012`) — is **env-only** `resolveErpCredentials(secret_ref, Deno.env.get)`, resolving
`<PREFIX>_KEY` / `<PREFIX>_SECRET` from the normalised `secret_ref`. A Vault-only credential cannot push.
Recorded as a finding; the run supplies both.

**P-4 — `organizations.pmo_epoch_at` (`DD-XING-2`) does not exist.**
`0198_locale_preference_columns.sql:163` still carries `⛔ NEXT COLUMN GOES HERE. Remaining companions:
pmo_epoch_at (DD-XING-2)`. The only epoch any shipped code reads is `external_org_bindings.activated_at`. A3 is
therefore written against **`activated_at`**, and the plan asserts nothing about `pmo_epoch_at`.

**P-5 — the brief's migration numbers are half right.** `0134` is
`0134_outbox_serialization_and_key_single_use.sql` (the single-use key index — correct). `external_refs` is
created in **`0088_external_refs.sql`**, not `0093` (`0093_clickup_tasks_flip.sql` adds the reverse-direction
adopt-dedupe constraint `DD-XING-3` referred to).

**P-6 — no `docs/specs/*.spec.md` owns A1–A4.** There is no crossing spec. A1–A4 are ticket assertions, not
`AC-###` from a signed spec. This plan assigns them provisional ids `AC-XING-001..004` and the graduation tasks
create tests carrying those ids; **a one-page `docs/specs/erpnext-crossing.spec.md` should be written and signed
before or alongside task T1** so the ids have an owner. Flagged in Open questions, not invented around.

**P-7 — `ERP_EMPLOYEE = 'HR-EMP-00001'` is hard-coded** (`pmo-portal/e2e/serial/_tspHelpers.ts:41`) and is not
env-overridable. On the local v15 bed that name is the smoke Employee. On the shared v16 site it is whatever
Employee happened to be created first, **which may belong to the other company on that site**. This is the
single most dangerous premise in the run and is gated by precondition P4 below plus task T0.

---

## Design

### What is being proved

`OD-XING-1` fixed the default: **the ERP starts at connect; nothing authored before the binding is pushed.**
That reinterprets A1 into a two-sided assertion — the pre-binding refusal must *happen*, and a post-connect
record must *land*. The tree already refuses pre-binding hours by design
(`erpnext-sweep/index.ts:1491-1511`, `approved_at >= activated_at`); the dry-run's job is to observe that
refusal against a real v16 site rather than assert a mechanism that does not exist.

The deliberate **gap** `DD-XING-5` demands is already the shipped shape of the timesheet backstop: approve a week
with the push path unreachable, leave it stranded (no mirror row, no outbox row), then let the sweep alone catch
it up. So the dry-run does not invent a backfill harness — it drives the shipped second originator.

### Why timesheets is the vehicle

Posture B, and the exact surface `OD-XING-1` cites. It is the only domain where all four assertions have a real
oracle in shipped code:

| Assertion | Mechanism in the tree |
|---|---|
| A1 pre-binding refusal | `listApprovedSheetsWithoutMirror`'s `floor = max(lookback, activated_at)` (`erpnext-sweep/index.ts:1503-1527`) |
| A1 post-connect push | `mintTimesheetOutboxRow` → `dispatchMoneyWrite` (`:1444`, `:1720`) |
| A2 re-run writes nothing | derived key `ts:<id>:<approved_at>` + `0134`'s `external_command_outbox_key_single_use` |
| A3 never adopt | `mintMirrorRow` throws `native-timesheet-not-adopted` (`_shared/erpnextFeedDeps.ts:363-374`) |
| A4 reversibility | `timesheet_erp_mirror` (`0136`) + `budget_version_erp_mirror` (`0137`) are the only `%_erp_mirror` tables |

Budget (the other Posture-B kind) is deliberately **out of scope**: it additionally needs the fiscal-year fan-out,
`budget_category_account_map` and a real COA mapping, and it holds rather than mints on an absent mirror
(`erpnext-sweep/index.ts` budget backstop). Adding it doubles the run for no new crossing evidence.

### Confinement to `PMO Smoke Co`

A second company on that site holds a real client's books. It is **never named, never selected, never listed**.
Confinement is structural, in four independent layers — the run must verify each rather than assume it:

1. **The binding names one company.** `config.company = 'PMO Smoke Co'` (`_tspHelpers.ts:39`), read as
   `org.company` by the sweep (`erpnext-sweep/index.ts:638`).
2. **The inbound poll is company-filtered server-side.** `companyDocFilters(kind, company)` conjoins
   `['company','=','PMO Smoke Co']` onto every list query for a company-scoped kind, and
   `admitsDocForBindingCompany` re-checks each returned row — `timesheet`, `budget` and `employee` are all in
   `COMPANY_SCOPED_KINDS` (`companyScope.ts:45-58`).
3. **Outbound documents inherit the company** from the Employee and the Project, both of which this run creates
   or verifies inside `PMO Smoke Co` (`createErpProject` stamps `company: ERP_COMPANY`, `_tspHelpers.ts:116`).
4. ⛔ **Domain ownership is `timesheets` ONLY.** `supplier` and `customer` are *global masters* and are
   deliberately **not** company-filtered (`companyScope.ts:30-33`, `companyDocFilters` returns `[]`). Granting
   the `companies` domain would sweep every Customer and Supplier on the site — including the other client's —
   into the local PMO org. **Never grant `companies`, `revenue`, or `procurement` for this run.** This is the
   single hardest confinement rule in the plan.

### Reuse: what already exists (do not duplicate)

The 41 served-fn specs are not inert scaffolding — three of them already *are* these assertions and have simply
never been pointed at a v16 site:

| Existing spec | Covers | Reuse verdict |
|---|---|---|
| `e2e/serial/AC-TSP-022-sweep-backstop.spec.ts` | the `absent` arm = seed-approve-strand-sweep, plus "a second tick must not mint a second week" | **A1 (post-connect half) + A2 — reuse verbatim** |
| `e2e/serial/AC-TSP-040-native-timesheet-not-adopted.spec.ts` | a Desk-created Timesheet mints no `timesheets` / `timesheet_entries` / `timesheet_erp_mirror` row, acks, surfaces `action-required` | **A3 — reuse verbatim; the new spec adds only the pre-epoch date** |
| `e2e/serial/AC-TSP-020-push-idempotency.spec.ts` | the derived key + `0134` on the foreground path | **A2 (foreground) — reuse verbatim** |
| `e2e/serial/AC-TSP-011-timesheet-push.spec.ts` | a valid ERP Timesheet from a PMO approval | **A1 shape — reuse verbatim** |

Only **two** things are genuinely uncovered and need new tests: the **pre-binding refusal** (nothing tests the
`approved_at >= activated_at` floor at any layer — `grep -rn listApprovedSheetsWithoutMirror` finds the
implementation and `timesheetBackstopMint.test.ts`, which does not exercise the floor) and **A4**.

### Durable Layer-1 gate vs one-time runbook step

| | Layer | Why |
|---|---|---|
| A1 pre-binding refusal | **curated e2e**, `AC-XING-001` | it is a cross-stack behaviour of the sweep against a real binding row; a unit test on the query builder would not prove the SQL anti-join |
| A1 post-connect push | **runbook only** (existing e2e covers it locally) | the *v16 compatibility* half is a one-time environment fact, not a regression surface |
| A2 | **curated e2e**, `AC-XING-002` + the existing `AC-TSP-020` | the multi-tick no-duplicate oracle is worth pinning at the served boundary |
| A3 | **curated e2e**, `AC-XING-003` (variant of the shipped `AC-TSP-040`) | same reason |
| A4 | **pgTAP**, `AC-XING-004` | a pure schema property; pgTAP already runs inside a rolled-back transaction, so `drop table` is free and reversible. ⛔ It must never run against the hosted project — `supabase test db` is local-only by construction |
| the v15 pin / unwired handshake (P-1) | **follow-up issue**, not a gate | it is a wiring gap, not a behaviour to lock |

### No ADR

Nothing here decides architecture. `OD-XING-1` already made the crossing decision, ADR-0059 already holds the
mechanism, and `DD-XING-6` explicitly ruled the crossing gets an ADR-0055 §5 **addendum** (#480), not a third
ADR. The findings this run produces feed that addendum and #590.

---

## Traceability

| Assertion | Provisional AC | Proved by | Artefact left behind |
|---|---|---|---|
| **A1a** nothing authored before the binding is pushed; the refusal is visible | `AC-XING-001` | `pmo-portal/e2e/serial/AC-XING-001-pre-binding-not-pushed.spec.ts` (T1) run at R6 | `docs/runs/2026-09-14-481/R6.log`; SQL: `select count(*) from timesheet_erp_mirror where timesheet_id = '<pre>'` → `0` |
| **A1b** a record authored after connect pushes to a valid ERPNext document | `AC-XING-002` | existing `AC-TSP-022` `absent` arm + `AC-XING-002` at R7 | `docs/runs/2026-09-14-481/R7.log`; the ERP `TS-#####` name recorded in `timesheet_erp_mirror.ts_number` |
| **A2** a re-run of the sweep writes nothing | `AC-XING-002` (ticks 2 and 3) | `AC-XING-002` at R7 | `R7.log` line `anchor docs after tick 3: 1` |
| **A3** a pre-epoch ERPNext document mints no PMO process record | `AC-XING-003` | `pmo-portal/e2e/serial/AC-XING-003-pre-epoch-not-adopted.spec.ts` (T3) at R8 | `R8.log`; `notifications` row with `metadata->>'action_required' = 'timesheet-native-not-adopted'` |
| **A4** `drop table <side_mirror>` loses no PMO data | `AC-XING-004` | `supabase/tests/0136_posture_b_side_mirror_droppable.test.sql` (T4) at R9 | `R9.log` (`supabase test db` TAP output, `ok 1..8`) |

The side mirror is exactly **`timesheet_erp_mirror`** (`0136_p3b_timesheet_erp_storage.sql`) and
**`budget_version_erp_mirror`** (`0137_budget_push_seam.sql`). `sales_invoices`, `incoming_payments`,
`procurement_invoices` etc. are **Posture-A read-models**, not side mirrors, and are out of A4's scope.

---

## Preconditions (verify, do not assume)

> **Verified on the v16.33 site 2026-09-14 (Director, Administrator session, no key file needed):**
> **P4 FAILS** — `HR-EMP-00001` is `404 DoesNotExistError` and the site has **no Employee records at all**, so
> **T0 and R4 are mandatory**, not conditional. P5 ✓ (`PMO Smoke Co`, `default_currency = IDR`, FY 2025 + 2026).
> P6 ✓ (`Activity Type/Execution` → 200). P7 ✓ (`Timesheet?fields=[name,note,company,total_hours]` → 200 with
> zero rows — the `note` anchor survives v16). P1 ✓ from this Mac at the time of writing (`ping` → 200; the
> Fortinet block is network-dependent, re-check per session). P2/P3/P8/P9 are per-run.

Every one is a hard stop. Run them from the repo root of this worktree.

- **P1 — network.** The Director's office network blocks `sslip.io` (Fortinet). Run from a network that
  reaches the host. Verify: `curl -sS -o /dev/null -w '%{http_code}\n' "$DRYRUN_ERP_URL/api/method/ping"` prints
  `200`. Anything else (`000`, `403` from a filter) ⇒ stop and change network.
- **P2 — credentials present, never printed.** `$DRYRUN_KEYS_FILE` is a local `600` JSON `{apiKey, apiSecret}`.
  Verify: `test -f "$DRYRUN_KEYS_FILE" && jq -e 'has("apiKey") and has("apiSecret")' "$DRYRUN_KEYS_FILE" >/dev/null && echo 'keys file OK'`
  prints `keys file OK`. ⛔ Never `cat` it, never echo a value, never paste one into a log, a fixture, a commit
  or an issue.
- **P3 — the host URL is never written down.** `$DRYRUN_ERP_URL` is exported by the operator for the session.
  ⛔ It is an internal hostname and this repo is public: it must not appear in this plan, in any run log that
  gets committed, in a test fixture, or in an issue comment.
- **P4 — the Employee is ours.** ⚠ **The riskiest single check in the run.**
  `curl -sS -H "Authorization: token $(jq -r .apiKey "$DRYRUN_KEYS_FILE"):$(jq -r .apiSecret "$DRYRUN_KEYS_FILE")" "$DRYRUN_ERP_URL/api/resource/Employee/HR-EMP-00001?fields=%5B%22name%22%2C%22company%22%5D" | jq -r '.data.company'`
  must print exactly `PMO Smoke Co`. If it prints anything else — **stop**, do task T0 first, and do not run any
  ERP write. If it 404s, create a dedicated Employee in `PMO Smoke Co` (R4) and do T0 anyway.
- **P5 — the company and calendar exist.** `.../api/resource/Company/PMO%20Smoke%20Co` returns `200` and
  `.data.default_currency == "IDR"`; `.../api/resource/Fiscal Year?filters=[["name","in",["2025","2026"]]]&fields=["name"]`
  returns both. (Fiscal Year is only read by the budget path, which is out of scope — this is a #590 fact, logged
  not gated.)
- **P6 — the Activity Type exists.** `.../api/resource/Activity Type/Execution` returns `200`.
  `_tspHelpers.ts:40` sends `Execution` as `default_activity_type`; without it every push is
  `commit-rejected: binding config has no default_activity_type` (`bodies/timesheet.ts:45`).
- **P7 — the anchor field survives v16.**
  `.../api/resource/Timesheet?limit_page_length=1&fields=["name","note","company","total_hours"]` returns `200`.
  Frappe errors on an unknown field even with zero rows, so a `200` proves `note` (the ADR-0058 §3 recovery
  anchor, stamped by `stampAnchor`) still exists. A non-200 here is a **v16 drift finding**, not something to
  work around.
- **P8 — locks.** Acquire outermost-first per CLAUDE.md: `erpnext → db → test`. Every command below that touches
  the DB or the served lane is wrapped accordingly.
- **P9 — the local stack is at head.** `scripts/with-db-lock.sh bash -c 'supabase db reset'` completes, and
  `supabase migration list` shows the same head as `git log -1 --name-only -- supabase/migrations`.

---

## Environment (exact, secret-free)

Exported once per session, in the shell that runs everything below. Nothing here is committed.

```bash
export EXTERNAL_CONNECT_ENABLED=true
export ERPNEXT_SWEEP_SECRET=e2e-erpnext-sweep-secret
export DEMO_ERP_WEBHOOK_SECRET=local-e2e-webhook-secret   # ⚑ must equal the Vault value seed.sql creates under that name (corrected 2026-09-14)
export ERPNEXT_TEST_FAULTS=1
export ERPNEXT_TEST_FAULTS_ALLOW_HOST=localhost,127.0.0.1   # ⚑ Kong forwards the host WITHOUT the port; `localhost:54321` alone never matches (verified 2026-09-14)
export ERPNEXT_SITE_URL="$DRYRUN_ERP_URL"     # the URL the served fn calls (public TLS ⇒ same as host-side)
export ERPNEXT_BENCH_URL="$DRYRUN_ERP_URL"    # the URL the test process calls
export ERPNEXT_BENCH_API_KEY="$(jq -r .apiKey "$DRYRUN_KEYS_FILE")"
export ERPNEXT_BENCH_API_SECRET="$(jq -r .apiSecret "$DRYRUN_KEYS_FILE")"
export LOCAL_BENCH_KEY="$ERPNEXT_BENCH_API_KEY"     # secret_ref 'local-bench' ⇒ LOCAL_BENCH_KEY/_SECRET (P-3)
export LOCAL_BENCH_SECRET="$ERPNEXT_BENCH_API_SECRET"
export SUPABASE_URL=http://127.0.0.1:54321
export VITE_SUPABASE_ANON_KEY="$(supabase status -o json | jq -r .ANON_KEY)"
export SUPABASE_SERVICE_ROLE_KEY="$(supabase status -o json | jq -r .SERVICE_ROLE_KEY)"
mkdir -p docs/runs/2026-09-14-481
```

Verify without printing values:
`for v in ERPNEXT_BENCH_API_KEY LOCAL_BENCH_SECRET ERPNEXT_SITE_URL SUPABASE_SERVICE_ROLE_KEY; do [ -n "${!v}" ] || echo "MISSING $v"; done; echo 'env check done'`
→ must print only `env check done`.

`scripts/serve-functions.sh:48` already forwards `LOCAL_BENCH_KEY`, `LOCAL_BENCH_SECRET`,
`ERPNEXT_SWEEP_SECRET`, `DEMO_ERP_WEBHOOK_SECRET`, `EXTERNAL_CONNECT_ENABLED`, `ERPNEXT_TEST_FAULTS` and
`ERPNEXT_TEST_FAULTS_ALLOW_HOST` from the shell into the function env — **no `supabase/functions/.env.local`
edit is needed.** `ERPNEXT_SITE_URL` is read by the *test process* (it writes it into the binding row), not by
the function, so it does not need forwarding.

---

## Implementation tasks (TDD, before the run)

Each task is 2–5 minutes. Every behaviour task names its AC. **No task in this section writes to ERPNext.**

### T0 — make the Employee name overridable (only if P4 failed) — no AC (enabling change)

**File:** `pmo-portal/e2e/serial/_tspHelpers.ts`

1. Change line 41 from `export const ERP_EMPLOYEE = 'HR-EMP-00001';` to:

```ts
export const ERP_EMPLOYEE = process.env.ERPNEXT_TSP_EMPLOYEE ?? 'HR-EMP-00001';
```

2. Add to the file's `Requires (process env…)` header block (line ~24) the sentence:
   `ERPNEXT_TSP_EMPLOYEE (optional — the Employee name to push against; defaults to the local bench's HR-EMP-00001).`
3. Verify (typecheck only; no behaviour change on the default path):

```bash
cd pmo-portal && npx tsc --noEmit -p tsconfig.json
```

Expected output: no lines before the shell prompt returns (tsc prints nothing on success).

### T1 — the failing pre-binding e2e (AC-XING-001)

**File (new):** `pmo-portal/e2e/serial/AC-XING-001-pre-binding-not-pushed.spec.ts`

Header comment must open with `// @e2e-isolation: serial — flips the shared org's external_domain_ownership + org bindings (org-global state).`
and the gate block must copy `AC-TSP-022`'s exactly (throw when `SUPABASE_FUNCTIONS_URL` is set but the rest is
not; `test.skip(!READY, …)`) — ⛔ never gate on `process.env.CI` (`check-e2e-isolation.sh`).

The oracle is **differential** — two sheets, one tick — so that "the sweep did nothing at all" cannot pass:

```ts
test('AC-XING-001 a week approved BEFORE the binding activated is never pushed, while a week approved after it is', async () => {
  const admin = createClient(AUTH_URL, SERVICE_KEY);
  const suffix = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const seeded = await seedTsp(admin, suffix);
  try {
    // Back-date activation by one day. The 14-day lookback floor (ABSENT_SHEET_LOOKBACK_MS) is far
    // wider than that, so `activated_at` — not the lookback — is the only thing that can exclude the
    // pre-binding sheet. That is what makes this a test of the crossing rule and not of the lookback.
    const activatedAt = new Date(Date.now() - 24 * 3600_000).toISOString();
    const { error: bindErr } = await admin.from('external_org_bindings')
      .update({ activated_at: activatedAt })
      .eq('org_id', ORG_ID).eq('external_tier', 'erpnext');
    expect(bindErr).toBeNull();

    const before = runWeek();
    const preId = await seedTimesheet(admin, seeded, {
      status: 'Approved',
      weekStartDate: before.weekStartDate,
      entries: [{ projectId: seeded.projectAId, entryDate: before.day1, hours: '4.00' }],
      approvedAt: new Date(Date.parse(activatedAt) - 12 * 3600_000).toISOString(),
    });
    const after = runWeek();
    const postId = await seedTimesheet(admin, seeded, {
      status: 'Approved',
      weekStartDate: after.weekStartDate,
      entries: [{ projectId: seeded.projectAId, entryDate: after.day1, hours: '4.00' }],
    });
    const preKey = timesheetPushKeyFor(preId, await readApprovedAt(admin, preId));
    const postKey = timesheetPushKeyFor(postId, await readApprovedAt(admin, postId));

    expect((await runSweep(FUNCTIONS_URL)).status).toBe(200);

    // The post-connect week lands — this is what makes the pre-connect silence meaningful.
    expect(await listErpTimesheetsByAnchor(postKey), 'a week approved after connect must reach ERP').toHaveLength(1);
    expect((await readTsMirror(admin, postId))?.push_state).toBe('pushed');

    // The pre-connect week is refused: no ERP document, no mirror row, no outbox row.
    expect(await listErpTimesheetsByAnchor(preKey), 'nothing authored before the binding may reach ERP').toHaveLength(0);
    expect(await readTsMirror(admin, preId), 'and no mirror row is minted for it').toBeNull();
    const { data: preOutbox } = await admin.from('external_command_outbox').select('id, state')
      .eq('org_id', ORG_ID).eq('domain', 'timesheets').eq('pmo_record_id', preId);
    expect(preOutbox ?? [], 'and no outbox row that could later succeed').toHaveLength(0);
  } finally {
    await cleanupTsp(admin, seeded);
  }
});
```

Imports come from `./_tspHelpers`: `ORG_ID, cleanupTsp, listErpTimesheetsByAnchor, readApprovedAt, readTsMirror,
runSweep, runWeek, seedTimesheet, seedTsp, timesheetPushKeyFor`.

Verify it is **red for the right reason** before any implementation exists — with no served lane it must SKIP,
not pass:

```bash
cd pmo-portal && npx playwright test --project=serial --workers=1 e2e/serial/AC-XING-001 --reporter=list
```

Expected output contains `1 skipped` (served lane absent). The red/green judgement happens at R6.

### T2 — the multi-tick no-duplicate e2e (AC-XING-002)

**File (new):** `pmo-portal/e2e/serial/AC-XING-002-catchup-rerun-no-duplicate.spec.ts`

Same header + gate block. Body: seed one Approved week with **no** mirror and **no** outbox row (assert both
preconditions, as `AC-TSP-022`'s `absent` arm does), then:

```ts
    for (let tick = 1; tick <= 3; tick++) {
      expect((await runSweep(FUNCTIONS_URL)).status, `tick ${tick}`).toBe(200);
      const docs = await listErpTimesheetsByAnchor(week.idempotencyKey);
      expect(docs, `after tick ${tick} the week exists exactly once`).toHaveLength(1);
      expect(docs[0].docstatus, 'submitted, not left a draft').toBe(1);
    }
    const { data: rows } = await admin.from('external_command_outbox')
      .select('id, idempotency_key, state')
      .eq('org_id', ORG_ID).eq('domain', 'timesheets').eq('pmo_record_id', week.timesheetId);
    expect(rows ?? [], 'the derived key + 0134 single-use index admit exactly one command').toHaveLength(1);
    expect((rows ?? [])[0].idempotency_key).toBe(week.idempotencyKey);
    expect((rows ?? [])[0].state).toBe('confirmed');
```

Verify:

```bash
cd pmo-portal && npx playwright test --project=serial --workers=1 e2e/serial/AC-XING-002 --reporter=list
```

Expected: `1 skipped`.

### T3 — the pre-epoch never-adopt e2e (AC-XING-003)

**File (new):** `pmo-portal/e2e/serial/AC-XING-003-pre-epoch-not-adopted.spec.ts`

Copy the structure of `e2e/serial/AC-TSP-040-native-timesheet-not-adopted.spec.ts` and change exactly two
things:

1. back-date the binding's `activated_at` by one day (same `update` as T1), and
2. create the Desk `Timesheet` with `time_logs` dated **before** that `activated_at` (use
   `new Date(Date.parse(activatedAt) - 48*3600_000)` for `from_time`, `+1h` for `to_time`), with
   `company: ERP_COMPANY`, `employee: ERP_EMPLOYEE`, `activity_type: ERP_ACTIVITY_TYPE`, submitted
   (`docstatus: 1` via `benchPut`).

Assertions, unchanged in kind from `AC-TSP-040`: `countPmoTimesheetState` before and after the sweep tick is
**identical** (`sheets`, `entries`, `mirrors`), and
`actionRequiredNotifications(admin, 'timesheet-native-not-adopted', { erpName })` is non-empty.

⚑ State honestly in the file header: *the date is not the mechanism.* Never-adopt (ADR-0059 §5) is
date-independent; the pre-epoch date makes the crossing story concrete and proves the pre-epoch document is a
read-model/notification event and never a PMO record. There is no epoch filter in the tree (see P-4).

Verify:

```bash
cd pmo-portal && npx playwright test --project=serial --workers=1 e2e/serial/AC-XING-003 --reporter=list
```

Expected: `1 skipped`.

### T4 — the A4 pgTAP proof (AC-XING-004)

**File (new):** `supabase/tests/0136_posture_b_side_mirror_droppable.test.sql`

```sql
begin;
select plan(8);

-- 1. The side mirror is EXACTLY these two tables. A third one appearing must break this test, not
--    silently escape A4's scope.
select set_eq(
  $$ select table_name::text from information_schema.tables
      where table_schema = 'public' and table_name like '%\_erp\_mirror' $$,
  $$ values ('timesheet_erp_mirror'), ('budget_version_erp_mirror') $$,
  'AC-XING-004 the Posture-B side mirror is exactly timesheet_erp_mirror + budget_version_erp_mirror'
);

-- 2. Record the PMO SoT row counts BEFORE the drop.
create temporary table xing_before as
select 'timesheets'         as t, count(*)::bigint as n from public.timesheets
union all select 'timesheet_entries',  count(*) from public.timesheet_entries
union all select 'budget_versions',    count(*) from public.budget_versions
union all select 'budget_line_items',  count(*) from public.budget_line_items
union all select 'projects',           count(*) from public.projects;

-- 3. RESTRICT, not CASCADE: invariant 7 says the mirror carries only external-side state, so nothing
--    PMO owns may depend on it. A dependency here is the finding, and it must be loud.
select lives_ok(
  'drop table public.timesheet_erp_mirror restrict',
  'AC-XING-004 timesheet_erp_mirror drops with RESTRICT — nothing PMO owns depends on it'
);
select lives_ok(
  'drop table public.budget_version_erp_mirror restrict',
  'AC-XING-004 budget_version_erp_mirror drops with RESTRICT — nothing PMO owns depends on it'
);

-- 4. Every PMO SoT table still exists and still holds every row.
select has_table('public', 'timesheets',        'AC-XING-004 timesheets survives the drop');
select has_table('public', 'budget_versions',   'AC-XING-004 budget_versions survives the drop');
select is_empty(
  $$ select b.t from xing_before b
       join (select 'timesheets' as t, count(*)::bigint as n from public.timesheets
             union all select 'timesheet_entries', count(*) from public.timesheet_entries
             union all select 'budget_versions',   count(*) from public.budget_versions
             union all select 'budget_line_items', count(*) from public.budget_line_items
             union all select 'projects',          count(*) from public.projects) a
         on a.t = b.t
      where a.n <> b.n $$,
  'AC-XING-004 dropping both side mirrors changes no PMO row count'
);
select is_empty(
  $$ select external_record_id from public.external_refs where domain = 'timesheets' limit 1 $$,
  'AC-XING-004 (context) the seed carries no timesheets external_refs, so the count check above is not vacuous'
);

select * from finish();
rollback;
```

⛔ **Local only.** `supabase test db` runs against the local Docker DB by construction; it is never pointed at
the hosted project. Do not add a `--db-url`.

Verify — reset and test in **one lock hold**:

```bash
scripts/with-db-lock.sh bash -c 'supabase db reset && supabase test db'
```

Expected output: the TAP block for `0136_posture_b_side_mirror_droppable` ends with `ok 8 - AC-XING-004 …` and
the run ends `All tests successful.` — read the **body**, never `$?` through a pipe.

If the last assertion (`is_empty` on `external_refs`) fails, the seed has changed: replace it with a count
assertion on whatever the seed now holds; do not delete it (it is the anti-vacuity guard).

### T5 — allowlist the three new served-lane specs

**File:** `scripts/check-e2e-skips.mjs`

The prefix map at line 63 covers `AC-BFY-`, `AC-BUD-`, `AC-ENA-`, `AC-SAR-`, `AC-TSP-` only, so an `AC-XING-`
spec that skips locally fails the gate. Add `'AC-XING-'` to that array:

```js
  ...['AC-BFY-', 'AC-BUD-', 'AC-ENA-', 'AC-SAR-', 'AC-TSP-', 'AC-XING-'].map((prefix) => ({
```

Verify (the gate self-tests, then runs):

```bash
node scripts/check-e2e-skips.mjs --self-test
```

Expected output ends with a line naming the self-test as passing; a non-zero body is a hard stop.

### T6 — full verify before anything is pushed anywhere

```bash
cd pmo-portal && npm run verify:locked
```

Expected: every gate in `pmo-portal/package.json`'s `verify` script reports success and the final line is the
shell prompt with no `ERR!`. ⛔ Read `package.json` for the gate list; do not trust a count written in a doc.

---

## The run (Director-dispatched, one sitting)

Log every step to `docs/runs/2026-09-14-481/<step>.log`. ⛔ Before committing any log, grep it for the host and
for credentials: `grep -rniE 'sslip|token [A-Za-z0-9]|apiSecret' docs/runs/2026-09-14-481/ && echo 'REDACT BEFORE COMMIT'`
must print nothing.

| Step | ⚠ writes to ERPNext? | What |
|---|---|---|
| R1 | no | preconditions P1–P9 |
| R2 | no (read-only ERP call) | `external-connect` credential ingress |
| R3 | no | operator SQL completes the binding |
| R4 | ⚠ **YES** | create the dedicated Employee (only if P4 failed) |
| R5 | ⚠ **YES** | serve functions + the seed's ERP Projects |
| R6 | ⚠ **YES** | A1 — `AC-XING-001` |
| R7 | ⚠ **YES** | A1b + A2 — `AC-XING-002` |
| R8 | ⚠ **YES** | A3 — `AC-XING-003` |
| R9 | no | A4 — pgTAP |
| R10 | ⚠ **YES** (cancels) | cleanup |

### R1 — preconditions

Run every command in **Preconditions** above, appending to `docs/runs/2026-09-14-481/R1.log`. Any hard stop
ends the run. Additionally record, as the #590 handshake finding (P-1):

```bash
curl -sS -H "Authorization: token $(jq -r .apiKey "$DRYRUN_KEYS_FILE"):$(jq -r .apiSecret "$DRYRUN_KEYS_FILE")" \
  "$DRYRUN_ERP_URL/api/method/frappe.utils.change_log.get_versions" | jq -r '.message.erpnext.version'
```

Expected: a `16.…` string. Record it. **This is the number `SUPPORTED_VERSION_MAJOR = 15` would refuse** — the
run proceeds because nothing calls the handshake (P-1), and that fact is itself a deliverable.

### R2 — credential ingress through the shipped path ⚠ no ERP write

Prove the product's own connect surface accepts this credential against v16 (after #647 it issues a read-only
`GET /api/method/frappe.auth.get_logged_user`; before #647 the probe fetched `User/<apiKey>`, a document Frappe
cannot serve, and every live connect answered 422 — the run needs #647's fix in the served function):

```bash
scripts/with-db-lock.sh scripts/serve-functions.sh -- bash -c '
  TOKEN=$(curl -sS -X POST "$SUPABASE_URL/auth/v1/token?grant_type=password" \
    -H "apikey: $VITE_SUPABASE_ANON_KEY" -H "Content-Type: application/json" \
    -d "{\"email\":\"admin@acme.test\",\"password\":\"Passw0rd!dev\"}" | jq -r .access_token);
  jq -n --arg u "$ERPNEXT_SITE_URL" --arg k "$LOCAL_BENCH_KEY" --arg s "$LOCAL_BENCH_SECRET" \
    "{tier:\"erpnext\",credential:{siteUrl:\$u,apiKey:\$k,apiSecret:\$s}}" \
  | curl -sS -X POST "$SUPABASE_FUNCTIONS_URL/functions/v1/external-connect" \
      -H "apikey: $VITE_SUPABASE_ANON_KEY" -H "Authorization: Bearer $TOKEN" \
      -H "Content-Type: application/json" --data-binary @- | jq -r ".ok"
' | tee docs/runs/2026-09-14-481/R2.log
```

Pass = the log's last line is `true`. A `422` body `{"error":"config-rejected"}` means v16 rejected the
credential or the SSRF/HTTPS guard refused the URL — stop and record which.

Then record what the ingress did **not** do (P-2), by reading the row rather than trusting the response:

```bash
scripts/with-db-lock.sh psql "postgresql://postgres:postgres@127.0.0.1:54322/postgres" -At -c \
"select coalesce(nullif(site_url,''),'<empty>'), coalesce(activated_at::text,'<null>'), coalesce(version_major::text,'<null>')
 from external_org_bindings where external_tier='erpnext';" | tee -a docs/runs/2026-09-14-481/R2.log
```

Expected: `<empty>|<null>|<null>`. That is the P-2 finding, captured from the deciding artefact.

### R3 — complete the binding (operator SQL, the `DD-ORG-1` interim path)

The e2e helper `upsertTspBinding` (`_tspHelpers.ts:207`) writes exactly the missing fields — `site_url`,
`config.company/default_activity_type/timesheet_day_start/project_map`, `webhook_secret_ref`, `activated_at` —
and sets `secret_ref = 'local-bench'` so the env resolver (P-3) can serve the write path. It runs automatically
inside `seedTsp` at R5/R6/R7/R8, so **no separate R3 command is needed**; R3 is the decision to let the helper
own it, recorded here so nobody hand-writes a second copy.

⛔ It also overwrites the Vault `secret_ref` minted at R2. That is deliberate and must be stated in the report:
the shipped Vault ingress is proved, then superseded, because the ERPNext write path cannot read Vault (P-3).

⛔ `seedTsp` grants **only** `external_domain_ownership(domain='timesheets')` (`_tspHelpers.ts:159`). Confirm no
other row was ever added:

```bash
scripts/with-db-lock.sh psql "postgresql://postgres:postgres@127.0.0.1:54322/postgres" -At -c \
"select domain from external_domain_ownership where external_tier='erpnext' order by 1;"
```

Expected: exactly one line, `timesheets`. Any other domain ⇒ **stop and delete it** before any sweep tick —
`companies` would pull the whole site's Customers and Suppliers, including the other company's.

### R4 — dedicated Employee ⚠ **WRITES TO ERPNEXT** (only if P4 failed)

Create it explicitly inside our company, then export its name:

```bash
curl -sS -X POST "$DRYRUN_ERP_URL/api/resource/Employee" \
  -H "Authorization: token $(jq -r .apiKey "$DRYRUN_KEYS_FILE"):$(jq -r .apiSecret "$DRYRUN_KEYS_FILE")" \
  -H "Content-Type: application/json" \
  -d '{"first_name":"PMO Dryrun","company":"PMO Smoke Co","date_of_joining":"2025-01-01","date_of_birth":"1990-01-01","gender":"Other","status":"Active"}' \
  | jq -r '.data.name, .data.company' | tee docs/runs/2026-09-14-481/R4.log
export ERPNEXT_TSP_EMPLOYEE="$(head -1 docs/runs/2026-09-14-481/R4.log)"
```

Pass = the second log line is exactly `PMO Smoke Co`. Requires T0.

### R5–R8 — the assertions ⚠ **WRITES TO ERPNEXT**

One command per step, each holding all three locks outermost-first and each serving the functions for its own
window. `--reporter=list` so the pass/fail is decided by the printed test titles.

```bash
# R6 — A1 (pre-binding refusal + the post-connect control)
scripts/with-erpnext-lock.sh scripts/with-db-lock.sh scripts/serve-functions.sh -- \
  bash -c 'cd pmo-portal && npx playwright test --project=serial --workers=1 e2e/serial/AC-XING-001 --reporter=list' \
  2>&1 | tee docs/runs/2026-09-14-481/R6.log
```

Pass = the log contains `✓` on the `AC-XING-001 …` title and ends `1 passed`. ⛔ `1 skipped` is a **fail** here —
it means the served lane never came up, and the assertion proved nothing.

```bash
# R7 — A1b + A2 (catch-up push, three ticks, one document)
scripts/with-erpnext-lock.sh scripts/with-db-lock.sh scripts/serve-functions.sh -- \
  bash -c 'cd pmo-portal && npx playwright test --project=serial --workers=1 e2e/serial/AC-XING-002 e2e/serial/AC-TSP-022 --reporter=list' \
  2>&1 | tee docs/runs/2026-09-14-481/R7.log
```

Pass = `6 passed` (1 new + `AC-TSP-022`'s 5), no skips.

```bash
# R8 — A3 (pre-epoch Desk document is never adopted)
scripts/with-erpnext-lock.sh scripts/with-db-lock.sh scripts/serve-functions.sh -- \
  bash -c 'cd pmo-portal && npx playwright test --project=serial --workers=1 e2e/serial/AC-XING-003 e2e/serial/AC-TSP-040 --reporter=list' \
  2>&1 | tee docs/runs/2026-09-14-481/R8.log
```

Pass = `2 passed`, no skips.

**⚑ A rejected required ERPNext field is a #478-class finding, never something to paper over.** If any push
fails with a Frappe validation error (`MandatoryError`, "is required", a `Tax`/`currency` field), then:

1. capture the **raw ERP response body verbatim** into `docs/runs/2026-09-14-481/finding-<n>.log`;
2. record the PMO record that could not supply the field and **why it cannot be reconstructed** (the
   `DD-XING-4` argument: tax-inclusive vs exclusive is recorded nowhere and no later inference recovers it);
3. file it against [#478](https://github.com/ariefsaid/PMO/issues/478) and stop that assertion;
4. ⛔ do **not** edit `bodies/timesheet.ts`, do not add a default, do not stub the field in a fixture. The whole
   value of the dry-run is that it finds this before the first real invoice.

### R9 — A4 ⚠ no ERP write, local DB only

```bash
scripts/with-db-lock.sh bash -c 'supabase db reset && supabase test db' \
  2>&1 | tee docs/runs/2026-09-14-481/R9.log
```

Pass = `R9.log` contains `ok 8 - AC-XING-004 dropping both side mirrors changes no PMO row count` **and** ends
`All tests successful.`. Read the body; never `$?` through the pipe.

### R10 — cleanup ⚠ **WRITES TO ERPNEXT** (cancels)

`cleanupTsp` (`_tspHelpers.ts:298`) already runs in every spec's `finally`: it cancels each pushed
`Timesheet` (`docstatus: 2`), and deletes the PMO rows, the mirror rows, the outbox rows, the `external_refs`,
the notifications, the `erp_employees` link, the domain-ownership row and the binding. So after R6–R8 the PMO
side is clean by construction. Verify rather than assume:

```bash
scripts/with-db-lock.sh psql "postgresql://postgres:postgres@127.0.0.1:54322/postgres" -At -c \
"select 'bindings', count(*) from external_org_bindings where external_tier='erpnext'
 union all select 'ownership', count(*) from external_domain_ownership where external_tier='erpnext'
 union all select 'mirror', count(*) from timesheet_erp_mirror
 union all select 'outbox', count(*) from external_command_outbox where domain='timesheets';" \
 | tee docs/runs/2026-09-14-481/R10.log
```

Expected: every count `0`.

**What stays behind in `PMO Smoke Co`, and why it cannot be removed over REST:**

| Residue | Why | Purge |
|---|---|---|
| Cancelled `Timesheet` docs (`docstatus: 2`) | v16 refuses `DELETE` on a cancelled submittable over REST; and a *non*-cancelled one would poison later runs via `validate_overlap_for('employee')` | in-container only |
| The two `Project` docs per spec run (`PMO-E2E-TSP-A/B-<suffix>`) | `cleanupTsp` deletes the PMO projects, not the ERP ones | in-container or REST `DELETE` (Projects are deletable) |
| The Vault secret + audit rows from R2 | local DB only, wiped by the next `supabase db reset` | none needed |

In-container purge, owner-run on the ERPNext host (⛔ **never** as part of an automated step, and never with a
filter that could match the other company):

```
bench --site <site> console
>>> import frappe
>>> names = [d.name for d in frappe.get_all("Timesheet", filters={"company": "PMO Smoke Co", "docstatus": 2})]
>>> for n in names: frappe.delete_doc("Timesheet", n, force=1)
>>> frappe.db.commit()
```

Every filter must carry `"company": "PMO Smoke Co"`. A purge without it is out of scope of this run and must not
be issued.

---

## Risks, ranked

1. **`HR-EMP-00001` belongs to the other company** (P-7). Mitigated by P4 + T0 + R4; unmitigated it posts hours
   against a real client's books. Highest-consequence step in the plan.
2. **A domain-ownership row other than `timesheets`.** `companies` is unfiltered for Customer/Supplier
   (`companyScope.ts:30-33`) and would adopt the whole site's party master. Checked explicitly at R3.
3. **v16 drift in a field the adapter depends on** — most likely `note` (the recovery anchor) or the Timesheet
   `time_logs` shape. Probed read-only at P7; a failure is a finding for #590, not a workaround.
4. **A false green from a skipped spec.** The served lane silently skips when `SUPABASE_FUNCTIONS_URL` is
   unset; `1 skipped` is treated as a failure at R6–R8, and T5 keeps the CI skip-gate honest.
5. **The `activated_at` floor passing for the wrong reason** (the 14-day lookback rather than the binding
   lifetime). Neutralised by T1's one-day back-date and its differential post-connect control.
6. **Concurrency with another agent's local stack.** All three locks, outermost-first (`erpnext → db → test`),
   and `db reset && supabase test db` chained in ONE hold.

## Findings this run must report back (independent of pass/fail)

- P-1: the version handshake is unwired and pinned to 15; the live site reports the version recorded at R1.
- P-2: `external-connect` leaves an ERPNext binding fail-closed (`site_url ''`, `activated_at null`, no domain
  ownership) — a client cannot self-serve an ERPNext connect end-to-end today.
- P-3: Vault-first read path vs env-only write path; a Vault-only credential cannot push.
- P-4: `organizations.pmo_epoch_at` is still a TODO in `0198`.
- Any #478-class required-field rejection, verbatim.

---

## Open questions (human decisions only)

1. **Does #481 close on timesheets alone, or must the budget push cross too?** This plan proves the crossing on
   the one Posture-B domain `OD-XING-1` cites. Budget is the other Posture-B kind and behaves differently on an
   absent mirror (it holds rather than mints). *Stated default: timesheets only; budget becomes its own dry-run
   ticket under #590.*
2. **Should `SUPPORTED_VERSION_MAJOR` move to 16, or become a range?** The handshake is unwired today, so this
   is free to defer — but the moment anyone wires it, a v16 client cannot activate. *Stated default: file it as
   a #590 follow-up; do not change it inside this dry-run.*
3. **Is a fail-closed `external-connect` acceptable for the first ERPNext client, or does P-2 become a build
   ticket before RIS connects?** *Stated default: build ticket, sequenced after the dry-run reports.*
4. **A4's invariant 7 is about data, not availability.** Dropping the side mirrors loses no PMO row, but the
   RPCs added by `0149`/`0162`/`0163`/`0166` reference them and would error until the corresponding code is
   removed. Is "reversible by `drop table`" meant to include "and the app keeps running"? *Stated default: no —
   the ADR's claim is data loss, and the plan proves exactly that; if the owner wants availability too, that is
   a separate teardown-path issue.*
5. **Who runs it, and from which network?** P1 requires a network that reaches the host; the office network
   blocks it. *No default — this is an owner/Director scheduling fact.*
