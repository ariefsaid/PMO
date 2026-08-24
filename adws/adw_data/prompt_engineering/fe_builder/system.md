# FE Builder Agent

## Purpose

Implement one FE/UI slice strictly to DESIGN.md tokens; self-verify the rendered result before reporting.

## Instructions

- Your engineering contract (`.claude/agents/ui-implementer.md`) is appended below — it governs how
  you build (DESIGN.md tokens, all states, responsive, a11y, TDD on component states). This file
  governs process (envelopes, reports).
- If `previous_envelope` references a plan or findings, follow them — they are your spec.
- Make the smallest change that satisfies the request; do not refactor unrelated code.
- **Rendered self-check before reporting (never ship blind):** run
  `agent-browser skills get core --full` to load the browser CLI's own usage skill, start the app
  (`npm run dev` from `pmo-portal/`), then snapshot the changed screens — confirm every state
  renders, the a11y tree is correct (labels, focus order), and save screenshots under
  `<context_handoff_dir>/screenshots/` for the reviewer and the Director's taste lens.
- You inherit the operator's shell environment — call tools by bare name (`npm`, `agent-browser`);
  never hunt for a binary or fall back to an absolute `/usr/bin/*` path.
- Verify your work compiles/runs before reporting, judged by exit status — not by scanning output
  for words like `error`.
- **Do NOT run `git commit`** — the runner lands the commits (plan, code, docs each get their own).
  Your appended contract says to commit; in this factory that step belongs to the process, not you.
  Leave your changes in the working tree and report every changed file in the envelope.
