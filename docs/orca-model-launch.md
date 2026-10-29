# Launching each model through Orca: recipes and gotchas (portable, any project)

Verified on this Mac, 2026-10-28. Project-neutral: copy or point another project's agents here.

## Order: cheapest first

Gemini Flash → GLM-5.3-flash → GPT Luna → GPT Terra (planners, reviewers) → GPT Sol (lane orchestrators) → Claude Sonnet → Claude Opus. Stop at the first
model that does the job well; Opus is for the orchestrator. Only a used-up quota moves work up a
rung. Route before `worker-start`: never stop a running worker to re-route it.

**Intelligence ranking (owner, 2026-10-29):** GPT Sol > GPT Terra > Gemini 3.8 Flash > GLM-5.3-flash > GPT Luna. Cost order
is separate from capability: pick the cheapest model whose intelligence fits the task, and move a
slice one rung up the intelligence ranking after two failed attempts.

## Recipes

| Model | How | Effort |
|---|---|---|
| GPT Luna / Terra / Sol | `orca orchestration worker-start --agent codex --model gpt-6-luna` (or `gpt-6.1-terra`, `gpt-6.1-sol`) `--effort …` | Luna xhigh · Terra medium · Sol medium |
| Claude | `--agent claude --model claude-sonnet-5-5` (or `claude-opus-5-5`) `--effort …` | Sonnet medium/high · Opus medium |
| Gemini (Flash, Argon) | `--agent antigravity` — takes its model from its own config | Argon high; Argon quota is small |
| GLM-5.3-flash | **not** `--agent pi` and **not** `--agent zcode` — see below | max |

**GLM through pi on the Z.AI coding plan** (the working path):

```
orca worktree create --repo path:<repo> --name <name> --base-branch origin/dev --setup skip --json
orca terminal create --worktree path:<that worktree> --title "GLM" \
  --command "pi --provider zai --model glm-5.3-flash:max" --json        # → handle
orca orchestration worker-start --run <run> --spec "<brief>" \
  --terminal <handle> --worktree path:<that worktree> --json
```

Pi reports `worker_done` to Orca by itself when it finishes (verified 2026-10-28). Smoke test first: `pi --provider zai --model glm-5.3-flash -p --no-session --no-tools "Reply with exactly: OK" < /dev/null`.

## Gotchas

- **`--agent pi` ignores `--model`.** Orca passes a model only to claude, codex, cursor, antigravity
  and muse; pi then runs its own default provider (`~/.pi/agent/settings.json`), which is not GLM
  here and fails auth. Always launch pi yourself with `--provider zai --model glm-5.3-flash:max`.
- **Nested orchestrators can't attach a terminal.** A worker that starts its own helpers gets `invalid_argument` on
  `--terminal`: helpers must be new agents. So GLM-via-pi helpers are dispatched by the top-level coordinator; a lane
  orchestrator sends it the brief path (or falls back to Luna).
- **Wait for pi to finish starting before `worker-start --terminal`.** If the brief arrives during pi's startup
  banner it is lost and pi sits idle at its prompt (`0.0%` context). Check with `orca terminal read`; if idle, type the
  brief in with `orca terminal send --terminal <handle> --text "<prompt>" --enter`. Prevent it: `orca terminal wait --terminal <handle> --for tui-idle --timeout-ms 60000` before `worker-start`.
- **`worker-start --terminal` needs `--worktree` matching the terminal's worktree**, or it fails
  with `terminal_worktree_mismatch`.
- **zcode does not start from the command line or Orca** (CLI 0.17.0 bundled in ZCode.app 3.16.2):
  "cannot locate CLI ZCode Built-in Provider Config". The bundled CLI
  (`/Applications/ZCode.app/Contents/Resources/glm/zcode.cjs`) looks for
  `Resources/glm/provider/zcode-builtin.json`; the app now ships it at
  `Resources/config/provider/zcode-builtin.json`. Under Orca it shows as a readiness timeout with
  an empty, exited terminal. Use pi for GLM. (A symlink `glm/provider → ../config/provider` inside
  the app would fix it until the next ZCode update.)
- **Never use NVIDIA NIM models for GLM** (slow enough to read as a hang); Z.AI only.
- **Antigravity print mode** needs the prompt attached: `agy --model gemini-4-argon-high -p='<prompt>'`.
- **Fresh worker per task**, own child worktree off `origin/dev`; never reuse a worker for another job.
- **Never stop a running worker** except on the owner's explicit "stop": its tokens (and any agents
  it spawned) are lost.
- **Quiet coordination.** Heartbeats are liveness only, so never answer or relay them. A coordinator waits
  with `~/.local/bin/orca-wait <run_id>` in the background, which acks heartbeat-only deliveries silently
  and wakes it only for a real message. Gaps between waits are when Orca's "you have N messages"
  prompts wake the coordinator, so keep one wait running. Workers and lane orchestrators message
  upward only for a decision, a blocker or completion. The same rule sits in each harness's global
  file (`~/.claude/CLAUDE.md`, `~/.codex/AGENTS.md`, `~/.gemini/GEMINI.md`, `~/.pi/agent/AGENTS.md`).
