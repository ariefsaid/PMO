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
# Content check is BATCHED (one, or a few size-split, `xargs -0 perl` invocations) instead of a
# per-file tr+wc pair — the per-file version cost ~3 process spawns * every tracked file (~57s
# over 2515 files, on the mandatory pre-push `verify` plus three CI jobs); this is sub-second.
#
# A gate that can silently scan ZERO files and still print "OK" is the exact failure class this
# gate exists to prevent (a grep-based check going quiet with no warning) — so a non-repo path,
# an empty tree, or "everything got extension-filtered" all hard-fail rather than green-by-absence.
# An unreadable tracked file hard-fails too, rather than being silently skipped.
#
# Run with --self-test to prove: NUL-in-text caught, real binaries skipped, an unreadable file
# fails loudly, and a non-repo / zero-scanned path fails loudly instead of reporting OK.
set -euo pipefail
shopt -s nocasematch # lets the extension match below be case-insensitive without a subprocess

BINARY_EXTENSIONS='png|jpg|jpeg|gif|ico|webp|bmp|avif|icns|heic|pdf|zip|gz|tgz|tar|7z|woff|woff2|ttf|otf|ttc|eot|mp3|mp4|mov|wav|ogg|webm|wasm|exe|dll|so|dylib|class|jar|sqlite|db|xlsx'

is_binary_ext() {
  local f="$1" ext="${f##*.}"
  [[ "$ext" == "$f" ]] && return 1 # no dot in the name -> nothing to match
  [[ "$ext" =~ ^(${BINARY_EXTENSIONS})$ ]]
}

# Populates the global SCANNED_COUNT with the number of non-binary tracked files actually
# content-checked. Echoes each violation (a NUL-bearing text file, or one that couldn't even be
# read) to stderr, `%q`-quoted so a maliciously-named tracked file can't inject extra log lines /
# forge a GitHub Actions ::error:: annotation via a crafted filename.
scan() {
  local root="$1" rc=0 f
  local -a candidates=()
  SCANNED_COUNT=0

  if ! git -C "$root" rev-parse --git-dir >/dev/null 2>&1; then
    echo "ERROR: $root is not inside a git working tree — cannot enumerate tracked files." >&2
    return 1
  fi

  while IFS= read -r -d '' f; do
    is_binary_ext "$f" && continue
    [[ -f "$root/$f" ]] || continue # deleted-but-still-in-the-index edge case
    if [[ ! -r "$root/$f" ]]; then
      printf '  UNREADABLE (treated as a failure, not a skip): %q\n' "$f" >&2
      rc=1
      continue
    fi
    candidates+=("$root/$f")
  done < <(git -C "$root" ls-files -z)

  SCANNED_COUNT=${#candidates[@]}

  if [[ "$SCANNED_COUNT" -gt 0 ]]; then
    # $ARGV is perl's current-file-being-read inside the implicit `while (<>)` from -n, and it
    # stays correct across xargs' batches even if a long candidate list forces xargs to split
    # into several perl invocations — every invocation shares this pipeline's single stdout, so
    # the read loop below still sees every hit from every batch. NUL-delimited output (not \n)
    # so a NUL-bearing OR newline-bearing filename can't corrupt the hit list either.
    while IFS= read -r -d '' f; do
      printf '  NUL byte(s) found: %q\n' "${f#"$root"/}" >&2
      rc=1
    done < <(printf '%s\0' "${candidates[@]}" | xargs -0 perl -0777 -ne 'print "$ARGV\0" if /\0/')
  fi

  if [[ "$SCANNED_COUNT" -eq 0 && "$rc" -eq 0 ]]; then
    echo "ERROR: 0 tracked files scanned under $root (not a repo? empty tree? everything" >&2
    echo "  extension-filtered?). A gate that scanned nothing and reported OK is the exact" >&2
    echo "  silent-pass class this gate exists to prevent." >&2
    return 1
  fi

  return $rc
}

if [[ "${1:-}" == "--self-test" ]]; then
  # Isolate from the machine's ambient git config (e.g. a global core.excludesFile matching
  # *.png would silently drop the binary-skip half of this test while still printing "OK").
  export GIT_CONFIG_GLOBAL=/dev/null
  export GIT_CONFIG_SYSTEM=/dev/null

  tmp=$(mktemp -d) && trap 'rm -rf "$tmp"' EXIT
  (cd "$tmp" && git init -q)
  printf 'const x = 1;\n' > "$tmp/clean.ts"
  printf 'FAKEPNG\x00BINARYBYTES' > "$tmp/asset.png"
  (cd "$tmp" && git add -A)
  scan "$tmp" >/dev/null 2>&1 || { echo "self-test FAIL: clean text + real binary asset flagged" >&2; exit 1; }
  [[ "$SCANNED_COUNT" -eq 1 ]] || { echo "self-test FAIL: expected 1 scanned (asset.png excluded), got $SCANNED_COUNT" >&2; exit 1; }

  printf 'const key = `a\x00b`;\n' > "$tmp/bad.ts"
  (cd "$tmp" && git add -A)
  if scan "$tmp" >/dev/null 2>&1; then echo "self-test FAIL: NUL byte in a tracked text file not caught" >&2; exit 1; fi
  rm "$tmp/bad.ts" && (cd "$tmp" && git add -A)

  # An unreadable tracked file must hard-fail, not be silently skipped.
  printf 'const y = 2;\n' > "$tmp/locked.ts"
  (cd "$tmp" && git add -A)
  chmod 000 "$tmp/locked.ts"
  if scan "$tmp" >/dev/null 2>&1; then
    chmod 644 "$tmp/locked.ts"
    echo "self-test FAIL: unreadable tracked file was not treated as a failure" >&2
    exit 1
  fi
  chmod 644 "$tmp/locked.ts"
  rm "$tmp/locked.ts" && (cd "$tmp" && git add -A)

  # A path that scans ZERO files must hard-fail, never print a green "0 tracked files scanned".
  notrepo=$(mktemp -d) && trap 'rm -rf "$tmp" "$notrepo"' EXIT
  if scan "$notrepo" >/dev/null 2>&1; then echo "self-test FAIL: non-repo path did not fail" >&2; exit 1; fi
  emptyrepo=$(mktemp -d) && trap 'rm -rf "$tmp" "$notrepo" "$emptyrepo"' EXIT
  (cd "$emptyrepo" && git init -q)
  if scan "$emptyrepo" >/dev/null 2>&1; then echo "self-test FAIL: empty repo (0 tracked files) did not fail" >&2; exit 1; fi

  echo "self-test OK"
  exit 0
fi

root="${1:-$(dirname "$0")/..}"
if scan "$root"; then
  echo "nul-byte gate OK ($SCANNED_COUNT tracked files scanned)"
else
  echo "ERROR: tracked file(s) above are a NUL-byte or readability violation — see" >&2
  echo "  scripts/check-nul-bytes.sh's own comment for why (grep -rn silently skips these files;" >&2
  echo "  compare grep -ran over the same path). Replace a raw NUL byte with the JS unicode" >&2
  echo "  escape for NUL in source; runtime behaviour is unchanged. If this is a genuine binary" >&2
  echo "  asset, add its extension to BINARY_EXTENSIONS in scripts/check-nul-bytes.sh." >&2
  exit 1
fi
