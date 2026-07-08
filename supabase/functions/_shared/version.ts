/**
 * DEPLOY_VERSION — the git SHA baked into the edge-fn bundle at deploy time.
 *
 * `'dev'` here is the committed placeholder (local `functions serve` / un-stamped).
 * `scripts/stamp-edge-fns.sh` overwrites this line with the real short SHA right
 * before `supabase functions deploy`, then git-reverts it. Because the value is
 * captured into EACH function's bundle at ITS deploy moment, every deployed fn
 * reports the SHA of the code actually running in it — a per-fn-accurate signal.
 *
 * Why baked, not a runtime `DEPLOY_VERSION` secret: a shared secret is set ONCE
 * (globally, at promote) so a fn that was NOT redeployed keeps reporting the new
 * secret while running stale code — it LIES. That is exactly the failure that hid
 * the stale prod agent-chat (memory: agent-multiround-handoff-20260708). Baking
 * per-bundle cannot lie: stale code carries the SHA it was built at.
 */
export const DEPLOY_VERSION = 'dev';
