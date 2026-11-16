/**
 * Odoo stock project resolution (AC-OSP-001).
 *
 * Resolves the active `project.project` ID required for Odoo stock project movements
 * from a PMO project's bound `account.analytic.account` ID.
 *
 * Rules:
 * - Live company-scoped search for `project.project` with `account_id` equal to the verified bound analytic account.
 * - Exactly one active project -> use its id.
 * - Zero matching projects -> refuse with 'project-unlinked'.
 * - Matching projects exist but all are archived -> refuse with 'project-unavailable'.
 * - Multiple active projects -> refuse with 'project-ambiguous'.
 * - RPC failure / unreadable -> refuse with 'read-failed'.
 * - Zero write or mutation calls (read only).
 */
import type { OdooCall } from '../client.ts';

export type ResolveStockProjectResult =
  | {
      ok: true;
      projectId: number;
    }
  | {
      ok: false;
      reason: 'project-unlinked' | 'project-ambiguous' | 'project-unavailable' | 'read-failed';
      message: string;
    };

interface ProjectRow {
  id: number;
  active?: boolean;
}

/**
 * Resolves the active Odoo `project.project` ID from a bound `account.analytic.account` ID.
 */
export async function resolveStockProject(
  call: OdooCall,
  companyId: number,
  analyticAccountId: number,
): Promise<ResolveStockProjectResult> {
  if (
    !Number.isInteger(companyId) ||
    companyId <= 0 ||
    !Number.isInteger(analyticAccountId) ||
    analyticAccountId <= 0
  ) {
    return {
      ok: false,
      reason: 'project-unlinked',
      message: `Invalid identifiers: companyId=${companyId}, analyticAccountId=${analyticAccountId}.`,
    };
  }

  let rows: ProjectRow[];
  try {
    rows = await call<ProjectRow[]>('project.project', 'search_read', {
      domain: [
        ['company_id', '=', companyId],
        ['account_id', '=', analyticAccountId],
      ],
      fields: ['id', 'active'],
      context: { active_test: false },
    });
  } catch (err) {
    return {
      ok: false,
      reason: 'read-failed',
      message: err instanceof Error ? err.message : String(err),
    };
  }

  if (!rows || rows.length === 0) {
    return {
      ok: false,
      reason: 'project-unlinked',
      message: `No project found in company ${companyId} for analytic account ${analyticAccountId}.`,
    };
  }

  const activeRows = rows.filter((r) => r.active !== false);

  if (activeRows.length === 0) {
    return {
      ok: false,
      reason: 'project-unavailable',
      message: `Linked project is archived or inactive in company ${companyId}.`,
    };
  }

  if (activeRows.length > 1) {
    const ids = activeRows.map((r) => r.id).join(', ');
    return {
      ok: false,
      reason: 'project-ambiguous',
      message: `Multiple active projects (${ids}) share analytic account ${analyticAccountId} in company ${companyId}.`,
    };
  }

  return {
    ok: true,
    projectId: activeRows[0].id,
  };
}
