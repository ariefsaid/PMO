#!/usr/bin/env bash
# Fail when a tracked TEXT file contains a literal NUL byte (0x00).
#
# A raw NUL byte silently turns a text file "binary" to grep: `grep -rn PATTERN dir/` skips the
# file with NO warning (only `grep -ran` sees it), so a grep-based gate/audit over that path is
# blind to it. If a delimiter genuinely needs to be a NUL character at runtime, spell it as the
# JS unicode escape for NUL (backslash, u, four zeros) in source — never write the raw byte.
# (This bit twice while writing THIS gate's own docs: typing that escape through a file-editing
# tool can itself emit a real 0x00 byte instead of the escape text — always re-verify the bytes
# after editing, `tr -dc '\000' < file | wc -c` must print 0.)
#
# Binary assets (images, fonts, archives, etc.) legitimately contain NUL bytes and must NOT be
# flagged; they are excluded below by extension, not by "does it contain NUL" — checking content
# would just reintroduce the exact blind spot this gate exists to close. Extend the extension list
# if a new binary asset TYPE is added to the repo; never special-case an individual path here.
#
# Run with --self-test to prove it catches a NUL byte in a text file and skips a real binary.
set -euo pipefail

BINARY_EXTENSIONS='png|jpg|jpeg|gif|ico|webp|bmp|avif|pdf|zip|gz|tgz|tar|7z|woff|woff2|ttf|otf|eot|mp3|mp4|wav|ogg|webm|wasm|exe|dll|so|dylib|class|jar'

is_binary_ext() {
  local f="$1" ext="${f##*.}"
  [[ "$ext" != "$f" ]] && printf '%s' "$ext" | grep -qiE "^(${BINARY_EXTENSIONS})\$"
}

scan() {
  local root="$1" rc=0 f nul_count
  while IFS= read -r -d '' f; do
    is_binary_ext "$f" && continue
    [[ -f "$root/$f" ]] || continue # deleted-but-still-in-index edge case
    nul_count=$(LC_ALL=C tr -dc '\000' < "$root/$f" | wc -c | tr -d ' ')
    if [[ "$nul_count" -gt 0 ]]; then
      echo "  NUL byte(s) found: $f" >&2
      rc=1
    fi
  done < <(cd "$root" && git ls-files -z)
  return $rc
}

if [[ "${1:-}" == "--self-test" ]]; then
  tmp=$(mktemp -d) && trap 'rm -rf "$tmp"' EXIT
  (cd "$tmp" && git init -q)
  printf 'const x = 1;\n' > "$tmp/clean.ts"
  printf 'FAKEPNG\x00BINARYBYTES' > "$tmp/asset.png"
  (cd "$tmp" && git add -A)
  scan "$tmp" >/dev/null 2>&1 || { echo "self-test FAIL: clean text + real binary asset flagged" >&2; exit 1; }
  printf 'const key = `a\x00b`;\n' > "$tmp/bad.ts"
  (cd "$tmp" && git add -A)
  if scan "$tmp" >/dev/null 2>&1; then echo "self-test FAIL: NUL byte in a tracked text file not caught" >&2; exit 1; fi
  echo "self-test OK"
  exit 0
fi

root="${1:-$(dirname "$0")/..}"
if scan "$root"; then
  echo "nul-byte gate OK ($(cd "$root" && git ls-files | wc -l | tr -d ' ') tracked files scanned)"
else
  echo "ERROR: tracked file(s) above contain a literal NUL byte — grep silently skips these files" >&2
  echo "  (compare: grep -rn vs grep -ran over the same path). Replace the raw byte with the" >&2
  echo "  \\u0000 escape sequence in source; runtime behaviour is unchanged. If this is a genuine" >&2
  echo "  binary asset, add its extension to BINARY_EXTENSIONS in scripts/check-nul-bytes.sh." >&2
  exit 1
fi
