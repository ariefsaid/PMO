# #2349 Capture preview names why System Settings could not be read

When the purchase-capture preview, apply or report cannot read the ERP's System Settings (needed for the
amount scale), the `source_settings_unreadable` entry carries one cause class and a guidance code. Nothing
defaults to a scale: the reason stays in `missing` and nothing is offered as ready. The cause is a class
only; no ERP reply body, host or error detail is returned or logged. The read keeps the calling client's
retry budget (`maxRetries`, default 3, linear backoff) and retries in the client's safe mode.

| Cause | HTTP / condition | Guidance |
|---|---|---|
| `refused` | 401, 403 | `grant_integration_user_read_system_settings` |
| `not_found` | 404 | `check_erp_site_address_and_product` |
| `unreachable` | network failure, timeout, redirect, 429 or 5xx after retries | `check_erp_reachable_then_retry` |
| `malformed_reply` | any other 4xx, or a reply not shaped as a settings record (an oversized 200 included) | `check_erp_system_settings_reply_then_retry` |
| `version_unknown` | the binding's ERP major version is not recorded or not supported | `rerun_integration_version_check` |

## Acceptance

Unit tests: `pmo-portal/src/lib/adapterSeam/erpnext/captureEvidence.test.ts` (U). Edge-function tests importing
the shipped handler: `supabase/functions/purchase-capture/index.test.ts` (E). CLI: `scripts/pmo.test.mjs` (C).

- **AC-2349-01 refused.** Given System Settings answers 401 or 403, when capture reads precision, then the result
  is `source_settings_unreadable` with cause `refused`, and the preview/apply/report reply carries guidance
  `grant_integration_user_read_system_settings`.
  Owner: U `#2349 HTTP %i is source_settings_unreadable, cause refused`; E `#2349 refused System Settings names the cause refused and the read access the integration user needs`.
- **AC-2349-02 not_found.** Given System Settings answers 404, when capture reads precision, then the cause is
  `not_found` with guidance `check_erp_site_address_and_product`.
  Owner: U `#2349 HTTP 404 is source_settings_unreadable, cause not_found`; E `#2349 a System Settings address the ERP does not know names the cause not_found`.
- **AC-2349-03 unreachable.** Given the read fails by network error, timeout, redirect, 429 or 5xx on every attempt,
  when capture reads precision, then the cause is `unreachable` with guidance `check_erp_reachable_then_retry`.
  Owner: U `#2349 a network failure is source_settings_unreadable, cause unreachable`, `#2349 a timed-out read …`, `#2349 HTTP %i … cause unreachable`, `#2349 a redirect …`; E `#2349 an unreachable or timed-out ERP names the cause unreachable`.
- **AC-2349-04 malformed_reply.** Given System Settings answers another 4xx (400, 405, 409, 417), a 200 whose body is
  not a settings record, or a 200 over the size cap, when capture reads precision, then the cause is
  `malformed_reply` with guidance `check_erp_system_settings_reply_then_retry`.
  Owner: U `#2349 HTTP %i is source_settings_unreadable, cause malformed_reply`, `#2349 an oversized 200 reply …`, `#2349 an invalid body %j …`; E `#2349 a malformed System Settings reply names the cause malformed_reply`.
- **AC-2349-05 version_unknown.** Given the binding's ERP major is null, not an integer or below 15, when capture
  reads precision, then the cause is `version_unknown` with guidance `rerun_integration_version_check`.
  Owner: U `#2349 version %s is source_settings_unreadable, cause version_unknown`; E `#2349 an unknown binding version names the cause version_unknown`.
- **AC-2349-06 a transient failure is retried.** Given a client with the default retry budget, when System Settings
  answers 503 (or the network fails) and then 200 with a readable record, then the read succeeds with its scale.
  Owner: U `#2349 a 503 followed by a 200 is retried and the read succeeds`, `#2349 a network failure followed by a 200 is retried and the read succeeds`.
- **AC-2349-07 retries exhausted.** Given a client with the default retry budget, when every attempt (1 + 3 retries,
  backoff 500/1000/1500 ms) answers 503, then the cause is `unreachable`.
  Owner: U `#2349 failures on every retry are source_settings_unreadable, cause unreachable`.
- **AC-2349-08 nothing leaks.** Given any failed read, including retried ones, when capture reads precision, then
  nothing from the ERP reply, host or error text is logged or returned.
  Owner: U `#2349 a failed read logs no ERP reply, host or error detail`, `#2349 the cause carries no ERP reply text`; E (every cause row asserts the log and body).
- **AC-2349-09 the CLI prints the cause.** Given a preview reply naming a cause, when `pmo purchases capture --dry-run`
  runs, then stderr carries one fixed sentence naming the cause and what to do; a cause the CLI does not know
  prints a generic line and never echoes the reply's text.
  Owner: C `#2349 capture preview prints why the ERP settings could not be read and what to do`.

The deployed purchase-capture function builds its ERP client with `maxRetries: 0` (`supabase/functions/_shared/erpClientForOrg.ts`),
as it did before this change, so in that function the read makes one attempt; the retry budget is the caller's.
