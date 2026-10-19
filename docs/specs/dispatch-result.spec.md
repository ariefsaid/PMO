# Dispatch result classification (#1103)

Status: approved bounded engineering scope, v0.24.0; no product behavior or permissions change.

A transport result decides whether a completed report is delivered, not whether its claims are correct. Use a portable pure classifier; operator-specific integration remains separate.


FR-OPS-009: When a successful sufficiently complete provider process returns a supported terminal
report, classification shall deliver it once regardless of numeric test data or quoted diagnostic
words. Successful transport is separate from the report's SHIP/FIX content; Director assesses claims.
FR-OPS-010: Where a response is incomplete or transport has actually failed, classification shall
retain existing retry/fallback outcomes. Numeric codes require transport framing, not standalone
429/500/502/503 text. A nonzero exit is not converted to ok because text contains a terminal marker.
FR-OPS-011: When terminal markers are parsed, retain ALL-TASKS-DONE, ordinary/bold Verdict:SHIP/FIX
and Markdown heading verdict forms including comma/conditional suffixes, case-insensitively.
Quoted marker examples and a bare number alone do not establish completion. Preserve the shared
launcher's existing minimum report size, rung limits/backoff, quota/no-op and exit behavior.
AC-OPS-1103-1 (isolated classifier subprocess unit): Given complete rc0 reports containing numeric
429/500/502/503 fixture values, quoted error words, ordinary/bold Verdict and heading verdict with
conditional suffix, when classified, then each returns ok with exactly one final delivery.
AC-OPS-1103-2 (same owner): Given actual HTTP status errors, network/congestion diagnostics,
incomplete responses, quota/no-op forms, nonzero rc with completion text and short messages,
when classified, then original retry/next behavior holds and no false successful delivery occurs.


No model roster, provider configuration, credentials or machine-specific path belongs in the public core. All tests use temporary synthetic logs and fake processes; no network or global launcher execution. Dev remains the ceiling.
