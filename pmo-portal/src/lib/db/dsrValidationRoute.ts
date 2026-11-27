import { nonEmptyString, parseRoute } from './parseRoute';
import { supabase } from '@/src/lib/supabase/client';
import { AppError } from '@/src/lib/appError';

/**
 * fix-waiting item 3 (FR-WAIT-006) — who ONE visible Submitted site report waits for, from the
 * server-computed route (`get_dsr_validation_route`, migration 1567). The RPC is SECURITY INVOKER and
 * reads the report, its project and the profiles through their existing RLS policies; it takes only the
 * report id, never an org id. Its validator population mirrors `dsr_may_validate` + `dsr_validate`
 * (1041) with the 1530/1461 light-account guard: the author is excluded for every role; the assigned
 * project manager is named only when that profile is a real Project Manager, active, not light and not
 * the author; Admin/Finance stay true role-level alternatives; nobody else can validate is `nobody`.
 *
 * The wire body is validated here: a malformed response is an error the screen can offer to retry,
 * never a fabricated approver or an empty route that reads as "nobody is needed".
 */

/** How the server described the route; `unavailable` is the non-leaking empty shape. */
export type DsrValidationRouteKind = 'project_manager' | 'finance_admin' | 'job_roles' | 'nobody' | 'unavailable';

export interface DsrValidationRouteApprover {
  id: string;
  name: string;
  /** The coarse user_role ("Project Manager"), as the database stores it. */
  role: string;
}

export interface DsrValidationRoute {
  approvers: DsrValidationRouteApprover[];
  routeKind: DsrValidationRouteKind;
  /** Active non-author built-in job role keys assigned daily_report_validate in this organisation (when non-empty). */
  validateRoles?: string[];
}

const ROUTE_KINDS: readonly DsrValidationRouteKind[] = ['project_manager', 'finance_admin', 'job_roles', 'nobody', 'unavailable'];

const malformedRoute = () => new AppError('The site report validation route response was malformed', 'dsr-route-malformed');

export function parseDsrValidationRoute(data: unknown): DsrValidationRoute {
  const { approvers, routeKind, fields } = parseRoute(data, ROUTE_KINDS, {
    mode: 'nonblank', malformed: malformedRoute,
  });

  const roles = fields.validate_roles;
  let validateRoles: string[] | undefined;
  if (roles !== undefined) {
    if (!Array.isArray(roles) || !roles.every(nonEmptyString)) throw malformedRoute();
    if (roles.length > 0) validateRoles = roles;
  }
  if (routeKind === 'job_roles' && !validateRoles) throw malformedRoute();
  return validateRoles ? { approvers, routeKind, validateRoles } : { approvers, routeKind };
}

/**
 * Reads the route for ONE visible report. org_id is NEVER sent — the invoker RPC's RLS (and its
 * active-caller assert) is the whole scope. A refusal (an inactive session) or a read failure throws a
 * code-bearing AppError so the screen can stay honest (plain pending text + a retry), never invent names.
 */
export async function getDsrValidationRoute(reportId: string): Promise<DsrValidationRoute> {
  const { data, error } = await supabase.rpc('get_dsr_validation_route', { p_report_id: reportId });
  if (error) throw new AppError(error.message, error.code);
  return parseDsrValidationRoute(data);
}
