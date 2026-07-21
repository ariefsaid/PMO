# ClickUp live-smoke (Phase 0) — provisional wire shapes verified against the real API

**Date:** 2026-07-17 · **Script:** `scripts/clickup-live-smoke.sh` (re-runnable) · **Credential:** 1Password `clickup-api` / vault `AS` / field `credential`

This is the **Phase 0** validation the admin-connect plan deferred as owner-gated
(`docs/plans/2026-07-14-external-admin-connect.md` line 35). Until now **every** ClickUp test in the
repo was fetch-mocked — those mocks are *hypotheses* about ClickUp's payloads: they prove our handlers
behave correctly **given** an assumed response, and cannot detect that the assumption is wrong.
`clickup-webhook` / `clickup-onboard` say so in-source ("PROVISIONAL wire shape").

**Secret handling:** the token is piped from 1Password straight into `curl` via an env var — never
echoed, never written to a file, never in argv (visible in `ps`) or a URL. Every response is reduced to
**key names / counts** before printing, so no task titles, emails, or ids reach a transcript.

## Result: shapes VALIDATED ✅

| Our assumption (`adapterSeam/clickup/types.ts`) | Real API | Verdict |
|---|---|---|
| `GET /user` → `{ user }` (external-connect token validation) | `user` w/ `id, username, email, …` | ✅ |
| `GET /team` → `{ teams }` | `teams` | ✅ |
| `GET /team/{id}/space` → `{ spaces }` | `spaces` | ✅ |
| `GET /space/{id}/folder` → `{ folders }` | `folders` | ✅ |
| `GET /space/{id}/list` → `{ lists }`, item has `id,name` | `lists`; item `id,name,orderindex,status,…,task_count,folder,space,archived` | ✅ (we read a correct subset) |
| `GET /list/{id}/task` → `ClickUpTaskListResponse{ tasks, last_page }` | `tasks,last_page` | ✅ exact |
| `ClickUpTask{ id,name,status,assignees,start_date,due_date,date_updated,date_done }` | all present (+~34 fields we ignore) | ✅ correct subset |
| `ClickUpTaskStatus{ status }` | `status,id,color,type,orderindex` | ✅ correct subset |
| Rate-limit backoff (`clickup/client.ts`) | `x-ratelimit-limit: 100`, `x-ratelimit-remaining`, `x-ratelimit-reset` present | ✅ real headers exist |

Live workspace observed: 1 team · 1 space · 0 folders · 3 folderless lists.

## NOT verified (do not treat as green)

1. **`include_closed` semantics — INCONCLUSIVE.** With/without `include_closed=true` both returned the
   same count on the list tested, because that list contains **no closed tasks**. The P1 finding
   (ClickUp omits closed statuses unless `include_closed=true`) is therefore **unretested**. It matters:
   `external-link`'s push-seed rule treats a non-empty List as a conflict, so if "empty" is computed
   without `include_closed`, a List full of *closed* tasks reads as empty and push-seed would wrongly
   proceed. **Re-run against a list containing a closed task before enabling the flag.**
2. **Webhook envelope still PROVISIONAL.** `clickup-webhook` assumes `event`/`task_id`/`list_id`/`task`
   and an `X-Signature` HMAC. Verifying it needs a real webhook delivery (a public callback URL), which
   this read-only smoke cannot do. This is the **largest remaining unknown** on the ClickUp side.
3. **Write paths untested.** Task create/update/delete (`adapter-dispatch`) were deliberately not
   exercised — this smoke is read-only so it cannot mutate the owner's workspace.
4. **Assignee/member mapping** and status-map conventions were not exercised.

## Observation worth acting on later

A real List object carries **`task_count`**. `external-link`'s direction check currently *fetches tasks*
to decide emptiness; `task_count` may be a cheaper signal — but confirm whether it counts closed tasks
before relying on it (same trap as #1).

## Re-run

```
./scripts/clickup-live-smoke.sh                    # read-only shape checks
./scripts/clickup-live-smoke.sh --list-id <id>     # + task/status shapes on a real List
```
