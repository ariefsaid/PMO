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

echo "==> mattpocock/skills (grill-with-docs only — stress-test a plan against the project's domain docs)"
git clone --depth 1 --filter=blob:none --sparse https://github.com/mattpocock/skills.git "$TMP/mp"
git -C "$TMP/mp" sparse-checkout set skills/engineering/grill-with-docs
rm -rf "${DEST:?}/grill-with-docs"
cp -R "$TMP/mp/skills/engineering/grill-with-docs" "$DEST/grill-with-docs"
# caveat: retarget the glossary output. ADRs already land in docs/adr/ (matches this repo);
# the root CONTEXT.md glossary -> docs/glossary.md (do NOT use docs/decisions.md — that's locked OD-* decisions, not a glossary).
sed -i.bak 's#CONTEXT\.md#docs/glossary.md#g' "$DEST/grill-with-docs/SKILL.md"
rm -f "$DEST/grill-with-docs/SKILL.md.bak"

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

echo
echo "Vendored: careful freeze guard cso design-review design-consultation feature-forge spec-miner grill-with-docs agent-browser impeccable taste ui-ux-pro-max design-system ui-styling"
echo "==> mirror generated skill surfaces (.agents/skills, and .pi/skills if project .pi exists)"
node "$ROOT/scripts/sync-agent-surfaces.mjs" --write --skills-only
echo "superpowers (plugin) — install once with:"
echo "  claude plugin install superpowers@claude-plugins-official --scope project"
