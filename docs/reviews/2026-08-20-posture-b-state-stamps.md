# Posture-B state stamps — the audit (#479)

**Date:** 2026-08-20 · **Issue:** #479 (re-scoped) · **Graduated from:** #475 (`DD-XING-3`)

## Why this exists

`DD-XING-3` rules that the standalone → connected catch-up is **the ordinary Posture-B push, run over
records whose side-mirror row is missing** — no bespoke backfill. That is safe *by construction*
because an ADR-0059 §4 key is **derived, not minted**: a re-run derives the same key, the outbox
single-use constraint (`0134`) rejects the duplicate, and no ERP document is written twice.

**The guarantee inverts if the state stamp is weak.** A stamp that does not move when the pushable
content moves derives the *same* key for a *different* command ⇒ `23505` ⇒ the write is **silently
suppressed**. Not a duplicate — a **missing** write, with no error anywhere. A catch-up over months of
accumulated records is precisely the workload that turns one such stamp into plural, silent loss.

So: for every Posture-B kind, what is the stamp, and what proves it moves?

## The set is exactly two

`isPmoSoTKind` (`supabase/functions/_shared/erpnextFeedDeps.ts:556-558`) — `timesheet` and `budget`.
Nothing else is Posture-B, so nothing else is in scope. Verified against the code, not assumed.

## The audit table

| | **timesheets** | **budget** |
|---|---|---|
| **Stamp** | `timesheets.approved_at` | `budget_versions.activated_at` (+ the encoded fiscal year) |
| **Key** | `ts:<id>:<approved_at>` (`timesheetPushKey.ts`) | `bud:<vid>:<fy>:<epochMs>` (`budgetPushKey.ts`) |
| **The stamp MOVES because…** | `transition_timesheet` re-stamps it on **every** Approved transition — `0007_timesheet_approval.sql:128` writes `approved_at = case when p_to in ('Approved','Rejected') then now() else approved_at end`. A second approval is therefore a distinct command by construction. | `activate_budget_version` stamps it on every activation (`0139:98`). |
| **Content cannot change under a frozen stamp because…** | Entries mutate only while the sheet is Draft — `timesheets_update_own` pins `status = 'Draft'` in **both** USING and WITH CHECK (`0021_lint_hardening.sql:47-49`), and `timesheet_entries_write` follows it (`0021:53-64`). Reopen-to-edit refuses once a push exists (`0161_timesheet_reopen_unpushed.sql:9-13`). | `budget_line_items_draft_guard` (`0005:88-100`) blocks INSERT/UPDATE/DELETE unless the owning version is `Draft`. |
| **The stamp is unforgeable because…** | `authenticated` holds column UPDATE on `(id, org_id, user_id, week_start_date, status, submitted_at)` only — `approved_at` is **not** in the list (`0175_update_path_sod_class.sql:164-166`). | `budget_versions`' client UPDATE grant is column-level and covers `status` alone (`0178:188`), so `activated_at` is not client-writable. `assert_budget_version_update` (`0178:189-227`) closes the status round-trip. |
| **Verdict** | **Sound.** Nothing to change. | **Sound as a KEY.** Two gaps below, neither in the stamp itself. |

⚑ **`OQ-BUD-2` is CLOSED**, and the issue that produced this audit was filed because a stale comment
said otherwise. `0139` shipped `budget_versions.activated_at`; `0171_sod_class_completeness.test.sql`
(:114, :149-152) proves it. `0137_budget_push_seam.sql`'s "DEFERRED / inert slot" note was false from
the day `0139` landed and has been corrected in the same change as this document — a header is a
comment, and this one cost a whole issue.

## The two real budget gaps

Neither is a weak stamp. Both are things the stamp cannot see.

### (a) `activated_at_witness` is never written — **fixed in this change**

ADR-0059 §6 (`docs/adr/0059-pmo-sot-with-external-side-mirror.md:192-193`) requires *"a server-resolved
witness of the state stamp the push was keyed on"*. `budget_version_erp_mirror.activated_at_witness`
exists (`0137`) and **no writer ever set it**. So there was no record of **which activation** the ERP
`Budget` corresponds to, and no monotonicity fence.

The timesheet twin ships exactly this — `timesheet_erp_mirror.approved_at_pushed`, written with a
fence by `0163:115-124` and `0164:226-236`. Budget had the column, the gate and the audit trail all
missing. The witness is now written from the gate's **server-read** `version.activated_at`, never from
the command payload — ADR-0059 §6's own rule, and the discipline `readModelWriters.ts` already applies
to `project_start_date`/`project_end_date`.

### (b) Pushed content that is **outside the key**, with no originator at all — *not* fixed here

The pushed `accounts[]` is built from `ctx.config.category_account_map` — i.e.
`budget_category_account_map`, which is Admin-writable `FOR ALL` (`0137:129-133`) — and the overspend
`action_if_*` fields come from binding config (`bodies/budget.ts:26-46`). **Neither is in the derived
key, and neither has any originator.**

An Admin re-mapping a category after a push leaves ERPNext enforcing the old account, with nothing to
detect it and nothing to re-drive it.

⚑ **The failure class here is different from the one this issue was filed about**, and the issue's
framing needs correcting: it is not "a needed write is suppressed" but **"no write is ever
attempted"**. Same silence, different mechanism — and a fix would be a re-push triggered by a config
change, which is a money write with no owner ruling behind it. `0137:129-133` makes that map
Admin-only *precisely because* it is accounting config. Recorded as a ruling candidate, deliberately
not built: see `docs/decisions.md`.

## ⛔ What this audit could not close: `DD-XING-3` is falsified

`DD-XING-3` asserts the crossing needs no backfill machinery because the ordinary Posture-B push can
be run over records with no side-mirror row. **That mechanism does not exist, and is deliberately
disabled:**

- `erpnext-sweep/index.ts:1491-1494, 1503, 1511` — timesheets **refuse pre-binding hours by design**.
- `erpnext-sweep/index.ts:1180-1182` — budget writes no mirror row before a dispatch.

Either `DD-XING-3` changes, or the crossing needs the machinery it says it does not. **#481's dev-bed
proof of the crossing ("seed, skip the push, then catch up") cannot be written honestly until this is
settled** — it is a build, not a test plan.

Escalated as its own item rather than folded in here, because the honest version of the fix posts
months of accumulated payroll costing into a client's ledger on the day they connect. That is a
commercial decision about someone else's books.
