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
  // ⚑ Count allowances ACTUALLY EVALUATED, not resources present. The `entries.length === 0` guard
  // above fails closed because "we checked zero allowances" — but before this counter, EVERY row
  // could `continue` and still reach exitCode 0. Two independent reviewers found the same hole:
  // `{ limited: { events: false, recordings: true } }` — a resource→boolean map, the most plausible
  // drift given the field is literally named `limited` — printed "✓ all quotas below threshold"
  // while `recordings` was genuinely breached. That is this module's original defect, one level
  // down, inside the fix for it.
  let evaluated = 0;

  for (const [resource, row] of entries) {
    // A row that is not an object is a SHAPE CHANGE, not a resource to skip. Fail closed loudly
    // rather than silently dropping it — silently dropping every row is exactly the bug above.
    if (row === null || typeof row !== 'object' || Array.isArray(row)) {
      return {
        exitCode: 2,
        lines: [
          `ERROR: quota resource ${safeResourceName(resource)} is not an object (got ${Array.isArray(row) ? 'array' : typeof row}) — the payload shape changed.`,
        ],
      };
    }

    // `limited` truthy means PostHog has ALREADY stopped ingesting this resource and the excess is
    // being discarded permanently. That is the emergency this alarm exists for — report it
    // regardless of the ratio, which may look low precisely because ingestion stopped.
    // Truthy (not `=== true`): `'true'` / `1` from a serialiser change must alarm, not slip past.
    // The false-positive direction (`limited: 'false'`) is the safe one.
    if (row.limited) {
      const detail =
        row.usage != null && row.limit != null ? ` (${Number(row.usage)} / ${Number(row.limit)})` : '';
      lines.push(
        `QUOTA BREACHED ${safeResourceName(resource)}${detail}: ingestion is STOPPED and excess data is being discarded.`,
      );
      evaluated += 1;
      continue;
    }

    // Real responses carry `usage: null, limit: null` for resources with no allowance data
    // (2 of 7 in the captured fixture). Explicit, because Number(null) is 0 and passes isFinite.
    if (row.usage == null || row.limit == null) continue;
    const limit = Number(row.limit);
    const usage = Number(row.usage);
    if (!Number.isFinite(limit) || limit <= 0) continue; // unlimited / unknown — nothing to breach
    if (!Number.isFinite(usage) || usage < 0) continue; // '' -> 0 and negatives are not real usage
    evaluated += 1;
    const ratio = usage / limit;
    if (ratio >= threshold) {
      lines.push(
        `QUOTA ${safeResourceName(resource)}: ${usage} / ${limit} (${(ratio * 100).toFixed(1)}% of the free allowance)`,
      );
    }
  }

  // The whole point of this module: never report "all clear" for a check that did not happen.
  if (evaluated === 0) {
    return {
      exitCode: 2,
      lines: ['ERROR: no quota resource carried usable usage/limit data — nothing was actually checked.'],
    };
  }

  return {
    exitCode: lines.length > 0 ? 1 : 0,
    lines,
    evaluated,
  };
}

/**
 * SECURITY (2026-07-28 security review, MEDIUM-1): resource names are object KEYS from a
 * third-party HTTP response, interpolated into lines that reach a CI step's stderr — and GitHub
 * Actions parses workflow commands from every output line. A key containing newlines emitted three
 * live commands in a probe: `::add-mask::` (redacts the rest of the job log — anti-forensics against
 * this alarm's own evidence), `::error::` (forges annotations in the checks UI), `::stop-commands::`.
 * Bound the character set and the length; a real PostHog resource name is a short snake_case slug.
 */
function safeResourceName(name) {
  return String(name).replace(/[^\w.-]/g, '_').slice(0, 64);
}

/** The only origins this alarm may send a personal API key to. */
const ALLOWED_POSTHOG_HOSTS = new Set(['us.i.posthog.com', 'eu.i.posthog.com', 'app.posthog.com']);

/**
 * SECURITY. `check-quota.mjs` interpolates `POSTHOG_HOST` and `POSTHOG_PROJECT_ID` into the URL it
 * sends the personal API key's `Authorization` header to. Returns a (possibly empty) list of error
 * strings — empty means "safe to proceed".
 *
 * ⚑ The first version checked only the SCHEME (`/^https:\/\//`) while its own docblock claimed it
 * stopped "sending the key to an arbitrary origin". It did not. A 2026-07-28 security review proved
 * all of these passed:
 *   https://evil.com                                   → key goes to evil.com
 *   https://us.i.posthog.com@evil.com                  → userinfo trick, key goes to evil.com
 *   https://us.i.pоsthog.com  (Cyrillic о)             → IDN homograph
 *   https://us.i.posthog.com#                          → fragment truncates the path
 *   https://us.i.posthog.com/api/projects/9/quota_limits/?x=
 *                                                      → project 9, PID check fully bypassed
 * A control believed stronger than it is, is its own defect. Parse rather than pattern-match:
 * a bare https origin, no credentials, no path/query/fragment, hostname on the allowlist.
 */
export function validateQuotaEnv(host, projectId) {
  const errors = [];
  if (!/^\d+$/.test(String(projectId ?? ''))) {
    errors.push('POSTHOG_PROJECT_ID must be a plain positive integer (got: ' + JSON.stringify(projectId) + ')');
  }

  let url;
  try {
    url = new URL(String(host ?? ''));
  } catch {
    errors.push('POSTHOG_HOST is not a valid absolute URL (got: ' + JSON.stringify(host) + ')');
    return errors;
  }
  if (url.protocol !== 'https:') {
    errors.push('POSTHOG_HOST must use https:// (got: ' + JSON.stringify(host) + ')');
  }
  if (url.username || url.password) {
    errors.push('POSTHOG_HOST must not carry credentials — the userinfo form re-points the request');
  }
  // `new URL('https://x')` normalises pathname to '/', so anything else is caller-supplied.
  // ⚑ Check the RAW string for '#'/'?' too: `new URL('https://host#')` yields hash === '' , so a
  // trailing marker would slip past a parsed-only check. It is harmless now that the target is built
  // with `new URL(path, HOST)` rather than string concatenation — but HOST is contractually a bare
  // origin, and rejecting malformed input is cheaper than re-deriving that it happens to be safe.
  const rawHost = String(host ?? '');
  if (url.pathname !== '/' || url.search || url.hash || rawHost.includes('#') || rawHost.includes('?')) {
    errors.push('POSTHOG_HOST must be a bare origin — no path, query or fragment (got: ' + JSON.stringify(host) + ')');
  }
  if (!ALLOWED_POSTHOG_HOSTS.has(url.hostname)) {
    // url.hostname is punycode-normalised, so IDN homographs surface here rather than sneaking past.
    errors.push(
      'POSTHOG_HOST is not an allowed PostHog origin (got: ' +
        JSON.stringify(url.hostname) +
        '; allowed: ' +
        [...ALLOWED_POSTHOG_HOSTS].join(', ') +
        ')',
    );
  }
  return errors;
}

/**
 * SECURITY (2026-07-28 review, MEDIUM-4): `Number(QUOTA_THRESHOLD)` was unvalidated, and BOTH
 * failure directions are silent and wrong:
 *   QUOTA_THRESHOLD=abc → NaN → `ratio >= NaN` is ALWAYS false → exit 0 forever, alarm disabled
 *   QUOTA_THRESHOLD=''  → 0   → every resource alarms (`??` guards null/undefined, not '')
 * The first is the same fail-open class this module exists to eliminate, and the direct JS analogue
 * of the `NaN >= 0` Postgres trap from #401. A threshold is a fraction: finite, above 0, at most 1.
 */
export function validateThreshold(raw) {
  const t = Number(raw);
  if (!Number.isFinite(t) || t <= 0 || t > 1) {
    return ['QUOTA_THRESHOLD must be a fraction in (0, 1] (got: ' + JSON.stringify(raw) + ')'];
  }
  return [];
}
