#!/usr/bin/env bash
# Fires on every RemoteTrigger call (PreToolUse). Denies `create`: a one-off cloud session is
# started with `claude --cloud`, never as a routine with a dummy schedule.
#
# Added 2026-11-21. Sixty-odd paused once-a-year routines had piled up because each round's
# lanes were created as routines and fired with "run now". Sessions started that way do not
# show in the owner's session list, and the habit hid the documented way to message a running
# session. Memory and docs did not stop it; this does. docs/orca-dispatch.md § Cloud sessions.
action="$(python3 -c 'import json,sys; print(json.load(sys.stdin).get("tool_input",{}).get("action",""))' 2>/dev/null)"
if [ "$action" = "create" ]; then
  cat <<'JSON'
{"hookSpecificOutput":{"hookEventName":"PreToolUse","permissionDecision":"deny","permissionDecisionReason":"Do not create a routine for one-off cloud work (docs/orca-dispatch.md § Cloud sessions). Start the session with: claude --cloud \"<brief>\" [--environment <id>] from the repo, on a pushed branch. Message a running one with: claude -p \"<message>\" --cloud session_<id> < /dev/null. A genuinely recurring routine is the owner's to create with /schedule."}}
JSON
fi
exit 0
