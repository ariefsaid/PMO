/**
 * quota — pure evaluation of PostHog's GET /api/projects/:project_id/quota_limits/ response
 * (personal API key, project:read scope). Split from the CLI so AC-PHG-030 is unit-owned.
 */
export function evaluateQuota(payload, threshold = 0.8) {
  // ⚑ SHAPE (verified against a LIVE response 2026-07-28, not against docs):
  //   { limited: { <resource>: { limited: bool, usage: number|null, limit: number|null }, … },
  //     code_usage_billing_active: bool }
  // An earlier version parsed `payload.quota_limits` as an ARRAY of `{resource, usage, limit}`.
  // No such field exists. The unit fixture had been invented from the same misreading as the
  // parser, so all 8 tests — including 3 security ones — passed against a shape the API never
  // returns. Only the fail-closed guard below (added by a security review for an unrelated
  // reason) stopped this reporting "all clear" forever against a payload it never parsed.
  // LESSON: a fixture for an external contract must be captured FROM the contract.
  const limited = payload?.limited;
  if (limited === null || typeof limited !== 'object' || Array.isArray(limited)) {
    return {
      exitCode: 2,
      lines: [`ERROR: unrecognised quota payload — expected a "limited" object, got ${Array.isArray(limited) ? 'array' : typeof limited}`],
    };
  }

  // SECURITY: zero resources means we checked zero allowances. Reporting green off that is the
  // same defect class as a gate that passes having scanned no files — fail closed instead.
  const entries = Object.entries(limited);
  if (entries.length === 0) {
    return { exitCode: 2, lines: ['ERROR: quota payload contained zero resources — nothing was actually checked.'] };
  }

  const lines = [];
  for (const [resource, row] of entries) {
    // `limited: true` means PostHog has ALREADY stopped ingesting this resource and the excess is
    // being discarded permanently. That is the emergency this alarm exists for — report it
    // regardless of the ratio, which may look low precisely because ingestion stopped.
    if (row?.limited === true) {
      lines.push(`QUOTA BREACHED ${resource}: ingestion is STOPPED and excess data is being discarded.`);
      continue;
    }
    // Real responses carry `usage: null, limit: null` for resources with no allowance data.
    // Number(null) is 0 and IS finite, so these must be excluded explicitly, not by isFinite.
    if (row?.usage == null || row?.limit == null) continue;
    const limit = Number(row.limit);
    const usage = Number(row.usage);
    if (!Number.isFinite(limit) || limit <= 0) continue; // unlimited / unknown — nothing to breach
    if (!Number.isFinite(usage)) continue;
    const ratio = usage / limit;
    if (ratio >= threshold) {
      lines.push(
        `QUOTA ${resource}: ${usage} / ${limit} (${(ratio * 100).toFixed(1)}% of the free allowance)`,
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
