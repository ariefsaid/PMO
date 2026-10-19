# Source this file to define classify(exit-code, log-file, [minimum-bytes]).
# The function runs in a subshell and only prints one of: ok, retry, next.
classify() (
  exit_code=${1-}
  log_file=${2-}
  minimum_bytes=${3:-120}

  case "$exit_code" in
    ''|*[!0-9]*) printf '%s\n' next; return 0 ;;
  esac
  case "$minimum_bytes" in
    ''|*[!0-9]*) printf '%s\n' next; return 0 ;;
  esac
  if [ -z "$log_file" ] || [ ! -f "$log_file" ] || [ ! -r "$log_file" ]; then
    printf '%s\n' next
    return 0
  fi

  byte_count=$(wc -c < "$log_file" 2>/dev/null | tr -d '[:space:]')
  case "$byte_count" in
    ''|*[!0-9]*) printf '%s\n' next; return 0 ;;
  esac

  # Quoted Markdown blocks and fenced examples are not evidence of either a
  # completed report or an observed transport failure.
  filtered_text=$(awk '
    BEGIN { in_fence = 0; fence = ""; fence_length = 0 }
    {
      line = $0
      sub(/^[[:space:]]+/, "", line)
      fence_char = substr(line, 1, 1)
      run_length = 0
      if (fence_char == "`" || fence_char == "~") {
        while (substr(line, run_length + 1, 1) == fence_char) run_length++
      }
      if (run_length >= 3) {
        remainder = substr(line, run_length + 1)
        if (!in_fence) {
          in_fence = 1
          fence = fence_char
          fence_length = run_length
          next
        } else if (fence == fence_char && run_length >= fence_length && remainder ~ /^[[:space:]]*$/) {
          in_fence = 0
          fence = ""
          fence_length = 0
          next
        }
      }
      if (in_fence || line ~ /^>/) next
      print line
    }
  ' "$log_file" 2>/dev/null) || {
    printf '%s\n' next
    return 0
  }

  if [ "$exit_code" = 0 ] && [ "$byte_count" -ge "$minimum_bytes" ] && printf '%s\n' "$filtered_text" | awk '
    function is_terminal(line, lower, heading, hashes) {
      lower = tolower(line)
      if (lower ~ /^[[:space:]]*(\*\*)?all-tasks-done(\*\*)?([[:space:][:punct:]]|$)/) return 1
      if (lower ~ /^[[:space:]]*(\*\*)?verdict:[[:space:]]*(\*\*)?(ship|fix)(\*\*)?([[:space:][:punct:]]|$)/) return 1

      if (lower !~ /^[[:space:]]*#+[[:space:]]/) return 0
      sub(/^[[:space:]]*/, "", lower)
      heading = lower
      sub(/[^#].*$/, "", heading)
      hashes = length(heading)
      if (hashes < 1 || hashes > 6) return 0
      sub(/^#+[[:space:]]+/, "", lower)
      return lower ~ /(^|[[:space:]])verdict:[[:space:]]*(\*\*)?(ship|fix)(\*\*)?([[:space:][:punct:]]|$)/
    }
    { if (is_terminal($0)) found = 1 }
    END { exit !found }
  '; then
    printf '%s\n' ok
    return 0
  fi

  # Quota and authentication failures cannot be repaired by retrying this rung.
  if printf '%s\n' "$filtered_text" | grep -Eiq 'Usage limit reached for 5 hour|"code"[[:space:]]*:[[:space:]]*1308|invalid api key|unauthorized'; then
    printf '%s\n' next
    return 0
  fi

  # Preserve the launcher's short silent-no-op handling. A long warning can
  # accompany a successful run, so only size-short responses take this branch.
  if [ "$byte_count" -lt 120 ] && printf '%s\n' "$filtered_text" | grep -Eiq 'model not found'; then
    printf '%s\n' next
    return 0
  fi

  # Numeric status values count only when framed as transport diagnostics.
  if printf '%s\n' "$filtered_text" | grep -Eiq 'ResourceExhausted|Worker local total request limit|try again in|(HTTP([ /]| status[ :=]+)|status([ _]code)?[ :=]+|error([ _]code)?[ :=]+)(429|500|502|503)([^0-9]|$)|(^|[[:space:]])(429|500|502|503)[[:space:]]+(Too Many Requests|Internal Server Error|Bad Gateway|Service Unavailable|rate limit)|fetch failed|overloaded|connection error|ECONNRESET|ETIMEDOUT'; then
    printf '%s\n' retry
    return 0
  fi

  if [ "$exit_code" != 0 ] || [ "$byte_count" -lt "$minimum_bytes" ]; then
    printf '%s\n' next
    return 0
  fi

  printf '%s\n' ok
)
