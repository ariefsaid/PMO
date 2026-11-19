# How long a person waits on a foreground ERP submit (#2150)

Status: design note, for owner decision. No code change. Describes shipped behaviour as read on
`origin/dev`, 2026-11-15.

## The question

When a person clicks a button that writes to the ERP (ERPNext, Odoo) or ClickUp, the browser waits
for `adapter-dispatch` to answer. How long should it wait, and what should the person see when the
answer takes longer than that?

## What decides the wait today

There are two clocks, and they are independent.

1. **The browser clock.** Every dispatch goes through one transport,
   `pmo-portal/src/lib/adapterSeam/dispatchClient.ts:100` (`invokeWithTimeout`). Its default is
   `DEFAULT_INVOKE_TIMEOUT_MS = 20_000` (`pmo-portal/src/lib/supabase/invokeWithTimeout.ts:29`).
   `DispatchDomainCommandOptions.timeoutMs` (`dispatchClient.ts:77`) can override it, but **no
   caller passes it**, so every foreground submit waits 20 s. When 20 s pass, the browser stops
   waiting and reports `external-unreachable` with the message "The request timed out". The request
   itself is not cancelled: the server keeps working and its late answer is ignored.
2. **The server clocks.** Inside `adapter-dispatch` each ERP call has its own deadline:
   - ERPNext write or read: `ERP_REQUEST_TIMEOUT_MS = 120_000` per attempt
     (`pmo-portal/src/lib/adapterSeam/erpnext/client.ts:92`); a POST is never retried
     (`client.ts:470`), a GET retries up to `ERP_DEFAULT_MAX_RETRIES = 3` (`client.ts:130`).
   - ERPNext recovery probe: `ERP_PROBE_TIMEOUT_MS = 20_000` (`client.ts:108`).
   - Money claim budget: a money POST must start within `MONEY_COMMIT_CLAIM_BUDGET_MS = 60_000` of
     its claim (`pmo-portal/src/lib/adapterSeam/dispatch.ts:191`, applied at `dispatch.ts:485`).
   - Waiting on another live attempt of the same command: `COMMITTING_WAIT_BUDGET_MS = 3_000`
     (`dispatch.ts:568`), then a retryable "in flight" answer.
   - Odoo: `ODOO_CALL_TIMEOUT_MS = 15_000` per call (`pmo-portal/src/lib/adapterSeam/odoo/client.ts:18`),
     used as `REQUEST_DEADLINE_MS` by every Odoo adapter (e.g.
     `supabase/functions/adapter-dispatch/odooAdapters.ts:60`, `odooMoneyOutbox.ts:186`).
   - ClickUp: `CLICKUP_REQUEST_TIMEOUT_MS = 20_000` (`pmo-portal/src/lib/adapterSeam/clickup/client.ts:21`).

So a single ERPNext write may legitimately take up to 120 s on the server, but the person is told
after 20 s that the system could not be reached. For a money command the durable outbox and the
sweep (`supabase/functions/adapter-dispatch/erpMoneyOutbox.ts`, `moneyOutboxDeps.ts`) still finish
or hold the command afterwards; the screen does not learn about that until it next reads.

## What the person sees today

- While waiting: the dialog's submit button is disabled and shows its pending state (the pattern in
  `pmo-portal/src/lib/adapterSeam/pendingPush.ts`, status `pushing`).
- After a real failure inside 20 s: the classified copy — "external system unreachable — try again"
  (`pendingPush.ts` `classifyExternalError`) or, on the push-status surfaces, "ERPNext could not be
  reached, so the outcome is unconfirmed" with the remedy "The system rechecks ERPNext on its own;
  confirm there before assuming the push did not land" (`pushErrorCopy.ts:358`).
- After 20 s with no answer: the same `external-unreachable` copy, although the server may still be
  committing. A later refresh may show the record as created.

## Call types

| # | Call type | Caller (file:line) | Command identity on retry | Server work in one request |
|---|---|---|---|---|
| 1 | Task create / update / transition / delete (ClickUp) | `pmo-portal/src/lib/db/tasks.ts:254`, `:303`, `:335`, `:378` | none (no key) | 1 ClickUp call, ≤20 s |
| 2 | Company / contact create, company update | `pmo-portal/src/lib/repositories/companies.ts:71`, `:108`, `:91` | create: new identity per attempt (`intent` is `undefined`); for Odoo partners the server keys the create on the record (`adapter-dispatch/index.ts:407`), and the record id is also new per attempt | 1–2 ERP calls |
| 3 | Procurement documents: purchase request, RFQ, purchase order, quotation, goods receipt, purchase invoice, vendor payment | `pmo-portal/src/lib/repositories/procurement.ts:211`, `:223`, `:231`, `:115`, `:129`, `:148`, `:252` | caller intent (same key on retry of the same click) | money outbox: probe (≤20 s) + POST (≤120 s ERPNext, ≤15 s per Odoo call) |
| 4 | Work-order invoice | `pmo-portal/src/lib/repositories/workOrders.ts:98` | caller intent, else per attempt | money outbox, as #3 |
| 5 | Sales invoice create, incoming payment create | `pmo-portal/src/lib/repositories/revenue.ts:77`, `:82` | caller intent | money outbox, as #3 |
| 6 | Sales invoice submit / cancel, payment cancel | `revenue.ts:115`, `:130`, `:154` | caller intent (`keyFor`) | SoD RPC first, then 1 ERP transition |
| 7 | Timesheet push | `pmo-portal/src/lib/repositories/timesheets.ts:71` | deterministic per sheet + approval (`timesheetPushKey`) | money outbox, as #3 |
| 8 | Budget activate / per-year retry | `pmo-portal/src/lib/db/budgets.ts:1116` | server-derived per fiscal year | one ERP budget per phased fiscal year, sequential (`adapter-dispatch/index.ts:918`) |
| 9 | Equipment register / maintenance | `pmo-portal/src/lib/db/equipment.ts:308` | caller key per intent | Odoo outbox, ≤15 s per call |
| 10 | Budget occupant inspect / use-as-draft (read) | `pmo-portal/src/lib/repositories/budgetOccupant.ts:49` | n/a (read) | 1 probe, ≤20 s (`adapter-dispatch/budgetDispatch.ts:204`) |

All ten wait 20 s in the browser. Related foreground ERP reads outside `adapter-dispatch`, for
context only: invoice PDF waits 45 s (`revenue.ts:49`); the statement report refresh has a 25 s
request and 75 s stage budget (`erpnext/statementReportRefresh.ts:20-21`).

## Options

- **A. Wait longer.** Raise the browser timeout for the call type to cover the server's worst
  single request (e.g. 130 s for an ERPNext money write).
- **B. Hand off to the background with a pending state.** After a short wait (e.g. 20 s), stop the
  spinner, show the record as "Sending to ERP — we'll confirm here", and let the screen poll or
  re-read the outbox/mirror state until it is confirmed, held, or failed.
- **C. Retry in the browser.** On timeout, re-send the same command automatically (same key) once
  or twice before reporting.
- **D. Keep today's 20 s and failure copy** (status quo), relying on the person to refresh.

## What breaks, per option

**A. Wait longer**
- A project manager activating a multi-year budget watches a frozen dialog for minutes and closes
  the tab; nothing is lost on the server, but they think it failed and come back to a different
  state than they left.
- Anyone on a ClickUp task edit waits two minutes on a dead integration for an answer that 20 s
  already gives.
- It still does not cover budget activation, whose request makes several ERP writes in sequence.

**B. Background hand-off with a pending state**
- For a command with no stable identity (#1 tasks, #2 company create), a person who sees "pending"
  and clicks again sends a second, different command; the pending badge cannot tell them apart.
- A finance user who leaves the page before confirmation does not see a late refusal unless the
  pending state lives on the record (mirror/outbox), not in the dialog.
- More states for the screen to show; each money screen needs a "sending" row state and copy.

**C. Automatic browser retry**
- For #1 and #2 a retry is a new command, so a slow-but-successful first attempt plus a retry
  creates two tasks or two companies.
- For money commands (#3–#9) the retry is safe (the outbox de-duplicates on the key) but usually
  lands on the live first attempt and gets the 3 s "in flight" answer, so it adds waiting without
  adding information.

**D. Status quo**
- An accounts user submits a sales invoice, sees "unreachable — try again" at 20 s while ERPNext is
  still posting it, and retries or raises it a second way; the outbox makes the retry safe, but the
  message told them something false ("unreachable" when it was slow).
- A procurement officer sees a purchase order "fail" that a refresh later shows as created.

## Recommendation per call type

| # | Call type | Recommend | Reason |
|---|---|---|---|
| 1 | ClickUp tasks | **D**, keep 20 s | One call with its own 20 s deadline; a longer wait buys nothing, and retry or hand-off without a key risks duplicates. |
| 2 | Companies / contacts | **D** now; **B** once creates carry a per-click intent | Without a stable identity, a pending state invites a duplicate click. Passing the caller's intent (as procurement does) is the prerequisite. |
| 3 | Procurement documents | **B** at 20 s | Server write may run to 120 s; the outbox already owns the outcome, so the honest message is "sending, we'll confirm", not "unreachable". |
| 4 | Work-order invoice | **B** at 20 s | Same outbox path as #3. |
| 5 | Sales invoice / payment create | **B** at 20 s | Same as #3; these are the ones people most often re-enter by hand. |
| 6 | Invoice submit / cancel, payment cancel | **B** at 20 s | Single transition, keyed; the outcome is readable from the mirror. |
| 7 | Timesheet push | **B** at 20 s | Deterministic key; the push-status surface already shows outbox state. |
| 8 | Budget activate | **B** immediately (short wait, e.g. 5 s) | Multi-year fan-out cannot be bounded to a dialog wait; the per-year push status already exists and is the right place for the answer. |
| 9 | Equipment | **B** at 20 s | Odoo outbox; the spec already says "Odoo must confirm before PMO shows it", which a pending state expresses directly. |
| 10 | Budget occupant read | **A**, set 25 s (probe 20 s + margin) | A read has nothing to hand off; let the server's own probe deadline answer first so the person sees its real result instead of a racing browser timeout. |

Common rule for every **B**: the copy on timeout changes from "unreachable" to "still sending —
the result will appear here", and the pending state is read from the outbox/mirror row, so it
survives a reload. No option C anywhere: where retry is safe it is not useful, and where it would
be useful it is not safe.

## Owner questions

1. Is "sending — we'll confirm here" acceptable wording for money documents, or must a money
   submit always end in a definite yes/no before the dialog closes?
2. For budget activation, may the dialog close after ~5 s and send the person to the per-year push
   status, rather than waiting?
3. Should company/contact creates move to a per-click intent first (making B possible), or stay on
   D?
4. Should a pending money document be editable or deletable in PMO while it is still sending, or
   locked until the ERP answers?
5. Is a single 20 s threshold right for everyone, or should it differ by ERP (Odoo calls are 15 s,
   ERPNext writes up to 120 s)?
