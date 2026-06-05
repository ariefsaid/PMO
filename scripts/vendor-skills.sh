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

echo
echo "Vendored: careful freeze guard cso design-review design-consultation feature-forge spec-miner impeccable taste ui-ux-pro-max design-system ui-styling"
echo "superpowers (plugin) — install once with:"
echo "  claude plugin install superpowers@claude-plugins-official --scope project"
