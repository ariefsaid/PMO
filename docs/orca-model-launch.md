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
| Gemini (Flash, Argon) | `--agent antigravity` — takes its model from its own config; a `--model` id needs the effort suffix (`gemini-3.8-flash-medium`; the bare id is rejected; `agy models` lists them) | Argon high; Argon quota is small |
| GLM-5.3-flash | `--agent pi` (pi's global default is Z.AI `glm-5.3-flash` since 2026-11-04, so nested lane orchestrators can start it); **not** `--agent zcode` | high |
| DeepSeek V4.1 Flash · DSH (DeepSeek's own harness) | `--agent dsh` — takes its model from the `dsh-tui` profile config; no `--model`. Set up 2026-11-23, see below | max |

**GLM through pi on the Z.AI coding plan** (the working path):

```
orca worktree create --repo path:<repo> --name <name> --base-branch origin/dev --setup skip --json
orca terminal create --worktree path:<that worktree> --title "GLM" \
  --command "pi --provider zai --model glm-5.3-flash:max" --json        # → handle
# GLM-5.4 (Z.AI, added 2026-11-24, pi 1.6.0 or newer: `pi update self && pi update --models`): same recipe with
#   --model glm-5.4:max  (no `glm-5.4-flash` id exists). Smoke test: pi --provider zai --model glm-5.4 -p --no-session --no-tools "Reply with exactly: OK" < /dev/null
orca orchestration worker-start --run <run> --spec "<brief>" \
  --terminal <handle> --worktree path:<that worktree> --json
```

Pi reports `worker_done` to Orca by itself when it finishes (verified 2026-10-28). Smoke test first: `pi --provider zai --model glm-5.3-flash -p --no-session --no-tools "Reply with exactly: OK" < /dev/null`.

**DSH, DeepSeek's own harness** (`--agent dsh`, set up 2026-11-23 — verified: a real worker received its
brief and answered `ONE-LINE-OK` on `deepseek/deepseek-v4.1-flash`):

- Orca launches it in **terminal** mode as `dsh-tui .` (it has no structured chat session), so the
  binary Orca finds must be a TUI. That is `deepseek-harness-cli`, which bootstraps the `dsh-tui`
  profile on first run. `dsh` alone is not enough (`--profile <name> is required`).
- Both `dsh` and `dsh-tui` need **Node ≥ 24** (the machine default is 22), so they run through
  `~/bin/dsh`, `~/bin/dsh-tui` (thin Node-24 wrappers, which also export provider keys from
  `~/.dsh/.credentials.yaml` via `~/bin/dsh-env.sh`).
- Orca's hooks must be installed **per profile**, version-matched to the dsh CLI
  (`pnpm add @deepseek-ai/dsh-hooks-claude-code@0.2.2-rc.5 @deepseek-ai/dsh-hook-protocol@0.2.2-rc.5`
  in `~/.dsh/profiles/{web,headless,dsh-tui}`); without them a session sends no events and
  `orca agent hooks status` reports `dsh: partial`.
- Model route: the shipped `deepseek-official` route has no key and the Bitdeer key has unpaid
  charges (402, 2026-11-23), so the profiles' `cordis.patch.yml` default to **OpenCode Go**
  (`https://opencode.ai/inference/go/openai/v1`, model `deepseek-v4.1-flash`, `OPENCODE_API_KEY`),
  which dsh drives as an ordinary OpenAI-compatible provider — its adapter sends the
  `x-opencode-session` header Go requires (a bare curl without it gets `MissingSessionID`).
  OpenRouter (`deepseek/deepseek-v4.1-flash`) stays configured as the fallback route. Keys live in
  `~/.dsh/.credentials.yaml` and reach the process through `~/bin/dsh-env.sh`.
- **Completion: dsh has no Orca tool, but it can report through the CLI.** Its Bash tool can run
  `orca orchestration send --from <handle> --type worker_done --subject … --body … --task-id … --dispatch-id … --outcome succeeded`;
  Orca then settles the dispatch (`state=succeeded`, verified 2026-11-23). A dsh brief must ask for
  that explicitly, otherwise the worker ends its turn silently and the dispatch sits idle. When a
  brief withholds command use, expect no completion report: read the terminal and settle the
  dispatch with `worker-stop` / `worker-release`.
- **Release a settled dsh worker.** The TUI stays alive after `worker_done` and sits on its idle
  "awaiting a task" composer, which Orca raises as a false `needs-input` escalation (a person at the
  terminal, it thinks). On `state=succeeded`, run
  `orca orchestration worker-release --dispatch <id>` so the terminal closes.

## Gotchas

- **`--agent pi` ignores `--model`** (it runs pi's global default, `~/.pi/agent/settings.json`, now set to Z.AI GLM; if it ever changes, GLM via Orca breaks). Orca passes a model only to claude, codex, cursor, antigravity
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
- **zcode does not run under Orca (ZCode.app 3.16.2, re-checked 2026-11-03).** Two faults: the bundled CLI looks for
  `Resources/glm/provider/zcode-builtin.json` (the app ships it in `Resources/config/provider/`; a symlink
  `glm/provider → ../config/provider` fixes that one), and then the TUI import fails, "Cannot find package
  '@zcode/tui'", because that package is packed inside `app.asar`, which plain Node cannot read. `zcode --help` works;
  a real session exits after ~3 s. Use pi for GLM until a ZCode release ships the CLI standalone.
- **Never use NVIDIA NIM models for GLM** (slow enough to read as a hang); Z.AI only.
- **Antigravity print mode** needs the prompt attached: `agy --model gemini-4-argon-high -p='<prompt>'`.
- **Fresh worker per task**, own child worktree off `origin/dev`; never reuse a worker for another job.
- **Never stop a running worker** except on the owner's explicit "stop": its tokens (and any agents
  it spawned) are lost.
- **Quiet coordination.** Heartbeats are liveness only, so never answer or relay them. A coordinator ends its
  turn and lets Orca wake it for each worker message; it never runs `orca-wait`, a watch script or a
  `check` loop, which takes its mail so Orca cannot wake it (`docs/orca-dispatch.md` § Waiting). Workers and lane orchestrators message
  upward only for a decision, a blocker or completion. The same rule sits in each harness's global
  file (`~/.claude/CLAUDE.md`, `~/.codex/AGENTS.md`, `~/.gemini/GEMINI.md`, `~/.pi/agent/AGENTS.md`).
