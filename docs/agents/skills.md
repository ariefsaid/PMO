# Skills — where to edit, and why it looks confusing

Skills are third-party and **vendored**. `scripts/vendor-skills.sh` pulls them from upstream into
`.claude/skills/`, then overlays ours on top.

| directory | tracked | what it is |
|---|---|---|
| `.claude/skills/<name>/` | no — generated | vendored upstream **plus** our overlay. **Never edit.** |
| `.claude/skill-overrides/<name>/` | **yes — in THIS repo** | **ours — the only place to edit a skill** |
| `.claude/skill-original/<name>/` | no — snapshot | pristine upstream, captured at vendor time |

Unlike the sibling MOS repo, `.claude/` here is **not** a separate git repo — overrides are ordinary
tracked files in the main repo, reviewed in ordinary PRs. (MOS's nested-repo variant produced an
incident where all five overrides sat deleted-but-tracked and no skill customisation was applying;
tracking them in the main repo makes that state visible to `git status` like everything else.)

## Why it is an overlay and not a fork

On each run `vendor-skills.sh` snapshots the pristine upstream skill to `skill-original/`, then
copies `skill-overrides/<name>/` over the vendored copy. **Our `SKILL.md` wins; upstream siblings**
(`tests.md`, `agents/…`) **survive.** Upstream can be re-pulled at any time and our additions
reapply — never a fork, only a delta.

```bash
diff .claude/skill-original/<name>/SKILL.md .claude/skill-overrides/<name>/SKILL.md
```

That is our exact delta. After a re-vendor the same diff shows upstream drift. The snapshot only
exists for skills vendored at the last run — a fresh override diffs only after the next
`vendor-skills.sh`.

**Overridden today:** `implement`, `tdd`, `to-spec`, `code-review`, `handoff`, `ask-matt`.

## Ownership boundaries (collisions resolved by CLAUDE.md's table)

- **superpowers (plugin)** owns planning/TDD/debugging **in Claude Director sessions**. The
  vendored `tdd`/`implement` carry the same discipline to **pi dispatches**, which cannot load
  plugins. Same rules, two delivery mechanisms — the overrides keep them in sync.
- **feature-forge** stays the loop's step-2 interview owner; `to-spec` is the no-interview
  synthesis path. **spec-miner** owns reverse-engineering. All emit the same spec format.
- The design/UI family and gstack ownership rows in CLAUDE.md are unchanged by the Matt set.

## Re-vendor checklist

1. `scripts/vendor-skills.sh` (network: clones upstreams).
2. **Re-vet** the mattpocock set: `find .claude/skills -name '*.sh' -o -name '*.mjs' -o -name '*.py'`
   — anything executable and new gets read before first use.
3. `diff` each override against its refreshed `skill-original/` snapshot for upstream drift worth
   folding in.
