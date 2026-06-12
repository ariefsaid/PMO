# Agent Surface Sync Implementation Plan

**Goal:** Keep Claude-authored project agents and vendored skills mirrored into Codex and optional Pi surfaces.

**Architecture:** Treat `.claude/` as the canonical authoring surface. A Node CLI reads `.claude/agents/*.md`, generates `.codex/agents/*.toml`, optionally mirrors `.pi/agents/` when a project `.pi/` exists, and mirrors ignored skill directories after `scripts/vendor-skills.sh` vendors them.

**Files:**
- Create: `scripts/sync-agent-surfaces.mjs`
- Create: `scripts/sync-agent-surfaces.test.mjs`
- Modify: `scripts/vendor-skills.sh`
- Modify: `.gitignore`

**Tasks:**
- Add failing Node tests for Markdown frontmatter parsing, Codex TOML generation, drift detection, stale-file cleanup, optional Pi agent mirroring, and ignored skill mirroring.
- Implement the CLI with `--check` and `--write` modes. Default mode is `--check`.
- Update `scripts/vendor-skills.sh` to call the sync script after vendoring `.claude/skills/`.
- Extend `.gitignore` for optional generated Pi mirrors.
- Verify with `node --test scripts/sync-agent-surfaces.test.mjs`, `node scripts/sync-agent-surfaces.mjs --check`, and `bash -n scripts/vendor-skills.sh`.
