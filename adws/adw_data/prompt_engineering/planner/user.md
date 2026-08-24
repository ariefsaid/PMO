# Plan Task

## Variables

### prompt

{{prompt}}

### previous_envelope

{{previous_envelope}}

### context_handoff_dir

{{context_handoff_dir}}

## Task

Plan the work described in `prompt`.

1. Write the full plan to `<context_handoff_dir>/plan.md` — this is the copy the builder reads.
2. Copy that file into the repo under `docs/plans/`:
   - **List `docs/plans/` before you pick the name.** A session that plans more than once reuses its `<adw_id>`, so the obvious name may already be taken.
   - Base name: `docs/plans/YYYY-MM-DD-<slug>-<adw_id>.md`, where `YYYY-MM-DD` is today (`date +%F`), `<slug>` is two to four kebab-case words naming the work, and `<adw_id>` is the session directory name inside `context_handoff_dir` (`.../sessions/<adw_id>/context_handoff`).
   - If a file with that name already exists, use `..._v2.md`, then `_v3`, and so on until the name is free. **Never overwrite an existing plan** — the earlier plan is the record of what was asked for then.
   - **Copy it, do not retype it.** One bash call does the whole step:
     `cp "<context_handoff_dir>/plan.md" "docs/plans/$(date +%F)-<slug>-<adw_id>.md"`
     Writing the plan a second time through `write` re-emits every line you already wrote, which costs the whole document again in output tokens and lets the two copies drift.
3. Emit your `Report` JSON, declaring BOTH paths in `artifacts`.

## Report

Respond with ONLY valid JSON matching `PlanOutput` — no prose before or after:

```json
{
  "status": "success",
  "summary": "<one sentence describing the plan>",
  "artifacts": ["<context_handoff_dir>/plan.md", "docs/plans/YYYY-MM-DD-<slug>-<adw_id>.md"],
  "commit_message": "<imperative one-line git subject for committing THIS PLAN DOCUMENT, not the work it describes — e.g. 'Add spec for the /health endpoint'>",
  "notes_for_next_agent": "<what the builder must know>"
}
```

Both `artifacts` entries are the paths you ACTUALLY wrote, `_v2` suffix and all. Gates open these files — a name you meant to use fails them.
