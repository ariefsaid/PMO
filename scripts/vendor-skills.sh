#!/usr/bin/env bash
# Re-vendor the project's cherry-picked Claude Code skills into .claude/skills/.
# These skills are third-party and GITIGNORED — run this once after cloning.
# (superpowers is a Claude Code plugin, installed separately — see the note at the end.)
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
DEST="$ROOT/.claude/skills"
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT
mkdir -p "$DEST"

echo "==> gstack (cherry-picked; project-scoped — we do NOT run gstack's global ./setup)"
git clone --single-branch --depth 1 https://github.com/garrytan/gstack.git "$TMP/gstack"
for s in careful freeze guard cso design-review design-consultation; do
  rm -rf "${DEST:?}/$s"
  cp -R "$TMP/gstack/$s" "$DEST/$s"
  rm -f "$DEST/$s/SKILL.md.tmpl"
done

echo "==> jeffallan/claude-skills (feature-forge + spec-miner only)"
git clone --depth 1 --filter=blob:none --sparse https://github.com/jeffallan/claude-skills.git "$TMP/jeff"
git -C "$TMP/jeff" sparse-checkout set skills/feature-forge skills/spec-miner
for s in feature-forge spec-miner; do
  rm -rf "${DEST:?}/$s"
  cp -R "$TMP/jeff/skills/$s" "$DEST/$s"
done

echo "==> harden spec-miner: read-only + Write (drop Bash)"
sed -i.bak 's/^allowed-tools:.*/allowed-tools: Read, Grep, Glob, Write/' "$DEST/spec-miner/SKILL.md"
rm -f "$DEST/spec-miner/SKILL.md.bak"

echo "==> mattpocock/skills — full engineering + productivity sets"
# Vetted 2026-07-31 (MOS) and RE-VETTED 2026-08-06 at HEAD — RE-VET ON EVERY RE-VENDOR: eng+prod
# skills are prompt-only .md + a harmless per-skill codex `agents/openai.yaml`; executables as of
# 2026-08-06 are diagnosing-bugs/scripts/hitl-loop.template.sh and wizard/template.sh (both benign
# interactive human-in-the-loop templates — no net/eval/telemetry; wizard writes .env/gh secrets
# only when a HUMAN runs a generated wizard). New since the first vet: wizard, wait-what,
# to-questionnaire, writing-for-agents (renamed from writing-great-skills).
# We vendor ONLY engineering/ + productivity/ (skip deprecated/in-progress/personal/misc).
git clone --depth 1 --filter=blob:none --sparse https://github.com/mattpocock/skills.git "$TMP/mp"
git -C "$TMP/mp" sparse-checkout set skills/engineering skills/productivity
for cat in engineering productivity; do
  for d in "$TMP/mp/skills/$cat"/*/; do            # */ matches dirs only → category README.md skipped
    s="$(basename "$d")"
    rm -rf "${DEST:?}/$s"
    cp -R "$d" "$DEST/$s"
  done
done
# caveat (kept from the grill-with-docs-only era): retarget the glossary output. ADRs already land in
# docs/adr/ (matches this repo); the root CONTEXT.md glossary -> docs/glossary.md (do NOT use
# docs/decisions.md — that's locked OD-* decisions, not a glossary). Upstream refactored: the
# glossary logic now lives in domain-modeling (grill-with-docs merely composes /grilling +
# /domain-modeling), so the sed targets domain-modeling; docs/agents/domain.md states the mapping.
sed -i.bak 's#CONTEXT\.md#docs/glossary.md#g' "$DEST/domain-modeling/SKILL.md"
rm -f "$DEST/domain-modeling/SKILL.md.bak"

# --- UI/UX design skills (vetted SAFE-with-caveats; see docs/design-workflow.md) ---
echo "==> impeccable (pbakaus/impeccable) — design/critique/extract; phone-home DISABLED"
git clone --depth 1 https://github.com/pbakaus/impeccable.git "$TMP/impeccable"
rm -rf "${DEST:?}/impeccable"
cp -R "$TMP/impeccable/skill" "$DEST/impeccable"
[ -f "$DEST/impeccable/SKILL.src.md" ] && mv "$DEST/impeccable/SKILL.src.md" "$DEST/impeccable/SKILL.md"
# caveat: hard-disable the impeccable.style version phone-home in the vendored copy
if [ -f "$DEST/impeccable/scripts/context.mjs" ]; then
  sed -i.bak 's#if (process.env.IMPECCABLE_NO_UPDATE_CHECK) return null;#return null; // vendored: phone-home disabled#' "$DEST/impeccable/scripts/context.mjs"
  rm -f "$DEST/impeccable/scripts/context.mjs.bak"
fi

echo "==> taste (Leonxlnx/taste-skill — v1 stable) — anti-slop craft discipline"
git clone --depth 1 https://github.com/Leonxlnx/taste-skill.git "$TMP/taste"
rm -rf "${DEST:?}/taste"
cp -R "$TMP/taste/skills/taste-skill-v1" "$DEST/taste"

echo "==> ui-ux-pro-max (nextlevelbuilder) — CORE skills only (skip Gemini generative sub-skills)"
git clone --depth 1 https://github.com/nextlevelbuilder/ui-ux-pro-max-skill.git "$TMP/uupm"
for s in ui-ux-pro-max design-system ui-styling; do
  if [ -d "$TMP/uupm/.claude/skills/$s" ]; then
    rm -rf "${DEST:?}/$s"
    cp -R "$TMP/uupm/.claude/skills/$s" "$DEST/$s"
  fi
done
# NOTE: deliberately NOT vendoring design/banner/slides/brand sub-skills (Gemini-API generative; need GEMINI_API_KEY).

# --- agent-browser CLI skill (vercel-labs/agent-browser) — rendered UI/FE verification from Bash ---
# The CLI ships version-matched skills; we vendor only the lightweight DISCOVERY STUB so the Skill
# tool (and pi via path) learn to run `agent-browser skills get core` for always-fresh usage content.
echo "==> agent-browser (vercel-labs) — browser-automation CLI for rendered design-review / qa"
if command -v agent-browser >/dev/null 2>&1; then
  AB_SKILLS="$(agent-browser skills path 2>/dev/null | head -1)"
  if [ -n "$AB_SKILLS" ] && [ -f "$AB_SKILLS/agent-browser/SKILL.md" ]; then
    rm -rf "${DEST:?}/agent-browser"
    cp -R "$AB_SKILLS/agent-browser" "$DEST/agent-browser"
    # un-hide so it lists in the project's Skill picker (the upstream stub is hidden:true)
    sed -i.bak '/^hidden: true$/d' "$DEST/agent-browser/SKILL.md" && rm -f "$DEST/agent-browser/SKILL.md.bak"
  else
    echo "    !! agent-browser skills path not found — skipping stub vendor"
  fi
else
  echo "    !! agent-browser not installed. Install: npm i -g agent-browser && agent-browser install"
fi

# --- skill-creator (claude-plugins-official) — meta-skill for authoring PREDICTABLE agent skills ---
# Used to author the agent-chat query-skills (deterministic "Use when…" recipes) that make the weak
# deepseek-v4-flash reliably map questions to query_entity calls (evals/query-selection-probe.ts is the gate).
echo "==> skill-creator (claude-plugins-official) — author predictable agent query-skills"
SC_SRC="$HOME/.claude/plugins/marketplaces/claude-plugins-official/plugins/skill-creator/skills/skill-creator"
if [ -d "$SC_SRC" ]; then
  rm -rf "${DEST:?}/skill-creator"
  cp -R "$SC_SRC" "$DEST/skill-creator"
else
  echo "    !! skill-creator plugin not found. Install: claude plugin install skill-creator@claude-plugins-official --scope project"
fi

# --- Project overrides (OVERLAY, not replace) — ported from the MOS convention 2026-08-06 ---
# Our upgraded files (git-tracked in THIS repo under .claude/skill-overrides/) are OVERLAID on top of
# the pristine vendored skill — our SKILL.md wins while upstream SIBLINGS (tests.md, agents/…) are
# KEPT. Before overlaying, snapshot the pristine upstream to .claude/skill-original/<name>/
# (gitignored) so `diff .claude/skill-original/<s>/SKILL.md .claude/skill-overrides/<s>/SKILL.md`
# shows exactly our delta, and a re-vendor reveals upstream drift. Edit skills ONLY in
# skill-overrides/ — edits in .claude/skills/ are destroyed by the next run (docs/agents/skills.md).
OVERRIDES="$ROOT/.claude/skill-overrides"
ORIGINAL="$ROOT/.claude/skill-original"
if [ -d "$OVERRIDES" ]; then
  for d in "$OVERRIDES"/*/; do
    [ -d "$d" ] || continue
    s="$(basename "$d")"
    if [ -d "$DEST/$s" ]; then
      mkdir -p "$ORIGINAL"; rm -rf "${ORIGINAL:?}/$s"; cp -R "$DEST/$s" "$ORIGINAL/$s"   # snapshot pristine
    fi
    echo "==> override (overlay): $s — our files win, upstream siblings kept"
    mkdir -p "$DEST/$s"
    cp -R "$d". "$DEST/$s/"                                                              # overlay contents
  done
fi

echo
echo "Vendored: careful freeze guard cso design-review design-consultation feature-forge spec-miner agent-browser skill-creator impeccable taste ui-ux-pro-max design-system ui-styling + mattpocock full eng+prod set"
echo "Project overrides applied from .claude/skill-overrides/ ($(ls "$OVERRIDES" 2>/dev/null | tr '\n' ' '))"
echo "==> mirror generated skill surfaces (.agents/skills, and .pi/skills if project .pi exists)"
node "$ROOT/scripts/sync-agent-surfaces.mjs" --write --skills-only
echo "superpowers (plugin) — install once with:"
echo "  claude plugin install superpowers@claude-plugins-official --scope project"
