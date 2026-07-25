## Verdict: **NO SHIP**

Scope: committed `HEAD=2ee0acd2`. The worktree was already dirty; I made no changes. The uncommitted `0114` WIP is not counted as a fix.

### Claimed-fix verification

| Fix | Verdict |
|---|---|
| Human retries reuse `CommandIntent` | **Partial** — shipped UI paths do; repository fallbacks still mint per attempt. |
| Sweep in-flight adoption guard | **Failed/partial** — capped and snapshot-based; see B3. |
| Rejected transitions terminal | **Partial** — `failed` transitions excluded, but pending/stale rows still auto-run. |
| Append-only author set | **Mechanism present; security not closed** — see B1. |
| SoD TOCTOU locking | **Failed** — clearance expires/release is caller-controlled. |
| Native amend convergence | **Pass on normal feed path**. |
| Partial webhook status oracle | **Pass**. |
| Revenue/list pagination | **Pass for PMO reads**. |
| Payment Entry discriminator | **Pass**. |
| Claim budget / Retry-After cap | **Pass for non-idempotent POSTs**. |

### Ranked blockers

#### B1 — **SoD clearance can be bypassed; self-approval remains possible**

`supabase/migrations/0113_si_author_set_and_submit_authorization.sql:212-243` uses a five-minute TTL. ERP submit PUTs use four attempts with 120-second per-attempt timeouts:

- `pmo-portal/src/lib/adapterSeam/erpnext/client.ts:238-244`
- `pmo-portal/src/lib/adapterSeam/erpnext/client.ts:368-369`

Sequence:

1. Approver B passes `submit_sales_invoice`; clearance is recorded.
2. ERP submit remains retrying for over five minutes.
3. B calls `claim_sales_invoice_author` for an update.
4. The clearance has expired, so B is appended to the author set and rewrites the body.
5. The still-running submit can submit B’s body under B’s earlier approval.

The uncommitted WIP is worse: `0114` exposes `release_sales_invoice_submit_authorization` to every authenticated grantee (`supabase/migrations/0114_si_revenue_write_roles_and_clearance_release.sql:159-174`). B can directly release the clearance during the in-flight submit. The edge function also releases it in `supabase/functions/adapter-dispatch/index.ts:636-651,782-786`.

Expected protection error is `55006` / `si-submit-in-progress`; the bypass removes it.

#### B2 — **Committed HEAD still lets Executive/Project Manager issue revenue money writes**

`supabase/functions/adapter-dispatch/authGuard.ts:12-14,61-64` permits:

```text
Admin, Executive, Project Manager, Finance
```

The UI is narrower, but a direct edge request from an Executive or Project Manager can create, submit, or cancel revenue documents. The SoD RPC also permits those roles:

- `supabase/migrations/0113_si_author_set_and_submit_authorization.sql:150-154,225-229`

A PM can directly cancel a submitted Sales Invoice and reverse AR. The uncommitted `authGuard.ts`/`0114` changes attempt to fix this, but they are not in `HEAD`.

#### B3 — **Concurrent creates for one PMO record are not serialized**

The target check is a read-then-write race:

- `supabase/functions/adapter-dispatch/transitionTargetGuard.ts:108-128`
- `supabase/functions/adapter-dispatch/index.ts:577-591`

The outbox uniqueness is only:

- `supabase/migrations/0096_erpnext_seam_tables.sql:77`

```text
(org_id, domain, pmo_record_id, idempotency_key)
```

Two requests using the same `record.id` but different keys both see no mapping, insert separate outbox rows, and POST two ERP documents. For an incoming Payment Entry, both can become submitted cash/AR documents.

Finalization then races through `record_outbox_ref` (`0096:210-230`) and eventually returns PostgreSQL `23505` or leaves one outbox row permanently `committed`.

#### B4 — **Multi-company ERP data is not scoped during sweep/webhook adoption**

The binding’s configured company is loaded at:

- `supabase/functions/erpnext-sweep/index.ts:486-495`

but never added to the document filters. The sweep only sends modified/payment-type filters:

- `supabase/functions/erpnext-sweep/index.ts:590-607`
- `pmo-portal/src/lib/adapterSeam/erpnext/sweepCursor.ts:91-104`

Webhook admission likewise checks only HMAC and domain ownership:

- `supabase/functions/erpnext-webhook/index.ts:163-174,214-226`

If the ERP site contains Company A and Company B, a Company B Sales Invoice or Receive Payment can be adopted into Company A’s PMO tenant. The row becomes visible in Company A’s revenue/AR views with no error.

#### B5 — **The in-flight adoption guard is not a correctness barrier**

Committed HEAD reads only 1,000 arbitrary rows:

- `supabase/functions/erpnext-sweep/index.ts:150-160`

The dirty WIP attempts `LIMIT 1001`, but `supabase/config.toml:18` sets PostgREST `max_rows = 1000`; saturation therefore cannot be observed.

Additionally, keys are read once at:

- `supabase/functions/erpnext-sweep/index.ts:537-543`

and reused for the later ERP poll at `:590-606`.

Sequence:

1. Sweep reads the key set.
2. A user starts a new ERP create.
3. The ERP document appears before the poll.
4. The stale key set does not contain it.
5. Sweep pull-adopts it as a second PMO row.
6. Original finalization later hits `23505` / duplicate external mapping.

#### B6 — **Sweep recovery bypasses current authorization and target binding**

`0112` still auto-selects:

- recent `pending` rows,
- stale `committing` rows,
- expired `quarantined` rows,
- non-transition `failed` rows.

See `supabase/migrations/0112_outbox_rejection_terminal.sql:42-61`.

`reconcileOrgOutbox` only checks the domain snapshot:

- `supabase/functions/erpnext-sweep/index.ts:322-342`

It does not re-run role authorization, SoD, `claim_sales_invoice_author`, or `checkTransitionTargetBinding`. `actor_user_id` is used only for mirror attribution:

- `supabase/functions/erpnext-sweep/index.ts:800-840,863-868`

A user can initiate a command, lose their role, and still have the cron sweep post it within 24 hours. Domain revocation is also TOCTOU-prone: ownership can be revoked after the snapshot but before the ERP POST.

#### B7 — **Idempotency keys are reusable across PMO records**

The key is scoped to the four-column outbox tuple (`0096:77`), while every active org member can read keys and payloads (`0096:107-109`).

A user can reuse key `K` from another in-flight row with a new PMO record ID. `probeErpByAnchorKey` adopts the first ERP document carrying `K`:

- `pmo-portal/src/lib/adapterSeam/erpnext/recoveryProbe.ts:54-72`

The payload digest only protects reuse within the same outbox tuple (`dispatch.ts:449-465`). During the unresolved window, the attacker’s row can claim and map another command’s ERP document to attacker-chosen PMO links.

#### B8 — **`require_project_on_si` still does not gate submit**

The signed spec requires the gate on SI create **and submit** (`docs/specs/erpnext-adapter-p3a-sales-ar.spec.md:713-718`).

Current code deliberately excludes submit:

- `pmo-portal/src/lib/adapterSeam/erpnext/dispatchFactory.ts:209-213,229-237`
- `supabase/functions/adapter-dispatch/index.ts:524-550`

An SI created while the gate was off, or an inbound unassigned SI, can later be submitted after the gate is turned on. The expected `422 project-required` is not returned.

#### B9 — **ERP-tier ownership is checked too generically**

`domain_externally_owned()` ignores `external_tier`:

- `supabase/migrations/0087_external_domain_ownership.sql:48-51`

The adapter authorization calls it without a tier:

- `supabase/functions/adapter-dispatch/authGuard.ts:67-70`

If `revenue` is assigned to another tier while an ERPNext binding exists, the ERPNext edge can still accept and post the command. The factory only selects an ERPNext binding (`dispatchFactory.ts:435-440`).

#### B10 — **Procurement service-role writers accept cross-org foreign keys**

Procurement resolution does not constrain `procurementId` by org:

- `pmo-portal/src/lib/adapterSeam/erpnext/dispatchFactory.ts:81-92,375-386`

The service-role mirror writers insert the caller’s `org_id` with the client-supplied foreign key:

- `supabase/functions/adapter-dispatch/readModelWriters.ts:169-173,229-239,271-280,401-410`

A direct command can use another tenant’s known `procurementId`; the ERP write and PMO mirror can then carry cross-tenant procurement links. The normal user RLS checks do not protect these service-role writes.

#### SHOULD-FIX — Sweep pagination can silently skip ERP rows

`pmo-portal/src/lib/adapterSeam/erpnext/sweepCursor.ts:63-74,97-118` pages with `limit_start` but sends no deterministic `order_by`. Concurrent ERP writes can shift rows between pages; the watermark then advances past skipped documents, permanently omitting revenue or payment changes.

**Final decision remains NO SHIP.**
