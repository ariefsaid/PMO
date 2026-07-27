/**
 * quota — pure evaluation of PostHog's GET /api/projects/:project_id/quota_limits/ response
 * (personal API key, project:read scope). Split from the CLI so AC-PHG-030 is unit-owned.
 */
export function evaluateQuota(payload, threshold = 0.8) {
  const rows = payload?.quota_limits ?? [];
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
