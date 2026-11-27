# Project navigation probe

Build from the repository root with `node scripts/perf/build-project-page.mjs`.
This uses Vite production build plus source maps and diagnostic lifecycle/query marks,
and restores the original source bytes in a finally block. Serve with Vite preview.
Run the navigation probe under `scripts/with-db-lock.sh` with `PERF_URL`,
`PERF_EMAIL`, `PERF_PASSWORD`, and `PERF_OUTPUT` supplied by the caller.
The output directory must be private and outside tracked files. Never publish traces:
they contain runtime request metadata. Use only the local Supabase stack.

`PERF_RUNS` defaults to five per mode. The throttled mode pins CPU to 4x and network
to Chrome DevTools Fast 4G (165ms CDP latency, 1,012,500 bytes/s down, 168,750 bytes/s up); the comparison disables both throttles.
Each navigation uses a fresh browser context, session storage captured after real login,
disabled HTTP cache, blocked service workers, and the same viewport/timezone.
The profile language is persisted as Indonesian for the run and restored afterward.
`PERF_STATEMENT_FIXTURE=1` installs the existing layout fixture only for statement
catalogue/totals, allowing comparison with that layout journey when local statement
snapshots are absent. Other application reads remain real. Record this flag in reports.

Run `node scripts/perf/summarize-project-page.mjs <private-output-directory>` while
source maps still match the recorded build. It writes per-task sampled attribution
and prints median milestones. DOM milestones are insertion/visibility observations,
not compositor paint times; the Paint Timing entries are reported separately.
A missing Periode is recorded as a failed observation, never a zero-time success.
Long-task sampling can attribute native work only to the available V8 frames; inspect
the retained Chrome timeline for causality before turning a correlation into a fix.
