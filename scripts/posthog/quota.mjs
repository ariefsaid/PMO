/**
 * quota — pure evaluation of PostHog's GET /api/projects/:project_id/quota_limits/ response
 * (personal API key, project:read scope). Split from the CLI so AC-PHG-030 is unit-owned.
 */
export function evaluateQuota(payload, threshold = 0.8) {
  // SECURITY (2026-07-27 review round 2): a malformed 200 (renamed field, schema change,
  // error-shaped 200) must NOT be treated as "zero rows -> all clear". A fail-OPEN alarm is
  // worse than no alarm — it actively reports a safety check that never ran. exitCode 2
  // (matching check-quota.mjs's own "unrecognised env / bad fetch" convention) is distinct
  // from exitCode 1 (a real quota breach) and 0 (a genuinely clean, well-formed response).
  if (!Array.isArray(payload?.quota_limits)) {
    return {
      exitCode: 2,
      lines: [`ERROR: unrecognised quota payload — expected a quota_limits array, got ${typeof payload?.quota_limits}`],
    };
  }
  const rows = payload.quota_limits;
  const lines = [];
  for (const row of rows) {
    const limit = Number(row?.limit);
    const usage = Number(row?.usage);
    if (!Number.isFinite(limit) || limit <= 0) continue; // unlimited / unknown — nothing to breach
    if (!Number.isFinite(usage)) continue;
    const ratio = usage / limit;
    if (ratio >= threshold) {
      lines.push(
        `QUOTA ${row.resource}: ${usage} / ${limit} (${(ratio * 100).toFixed(1)}% of the free allowance)`,
      );
    }
  }
  return { exitCode: lines.length > 0 ? 1 : 0, lines };
}

/**
 * SECURITY (2026-07-27 review round 2 #5): `check-quota.mjs` interpolates `POSTHOG_HOST` and
 * `POSTHOG_PROJECT_ID` unvalidated into the URL it sends the personal API key's `Authorization`
 * header to. A mis-set `POSTHOG_HOST` would send the key to an arbitrary origin (possibly plain
 * http, where it travels in the clear); a `PROJECT_ID` containing `../` could re-point the
 * authenticated request to a different path. Returns a (possibly empty) list of error strings —
 * empty means "safe to proceed".
 */
export function validateQuotaEnv(host, projectId) {
  const errors = [];
  if (!/^\d+$/.test(String(projectId ?? ''))) {
    errors.push('POSTHOG_PROJECT_ID must be a plain positive integer (got: ' + JSON.stringify(projectId) + ')');
  }
  if (!/^https:\/\//.test(String(host ?? ''))) {
    errors.push('POSTHOG_HOST must start with https:// (got: ' + JSON.stringify(host) + ')');
  }
  return errors;
}
