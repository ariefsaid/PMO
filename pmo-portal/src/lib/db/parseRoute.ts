import type { AppError } from '@/src/lib/appError';

type RouteMode = 'trim-name' | 'nonblank' | 'nonempty-id' | 'strings' | 'unique-nonblank';
type StrictMode = 'trim-name' | 'nonblank' | 'nonempty-id';

interface RouteOptions {
  mode: RouteMode;
  malformed?: () => AppError;
  roles?: readonly string[];
}

interface ParsedRoute<Kind extends string | null> {
  routeKind: Kind;
  approvers: { id: string; name: string; role: string }[];
  fields: Record<string, unknown>;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

export function nonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.trim() !== '';
}

function parseApprover(value: unknown, { mode, roles }: RouteOptions) {
  if (!isRecord(value)) return null;
  const { id, name, role } = value;
  if (typeof id !== 'string' || typeof name !== 'string' || typeof role !== 'string') return null;
  if (mode === 'strings') return { id, name, role };
  if (mode === 'nonempty-id' ? !id : !nonEmptyString(id)) return null;
  if (!nonEmptyString(role) || (roles && !roles.includes(role))) return null;
  if (mode !== 'trim-name' && !nonEmptyString(name)) return null;
  return { id, name: mode === 'trim-name' ? name.trim() : name, role };
}

export function parseRoute<Kind extends string>(
  data: unknown, kinds: readonly Kind[], options: RouteOptions & { mode: StrictMode; malformed: () => AppError },
): ParsedRoute<Kind>;
export function parseRoute<Kind extends string>(
  data: unknown, kinds: readonly Kind[], options: RouteOptions,
): ParsedRoute<Kind> | null;
export function parseRoute(
  data: unknown, kinds: null, options: RouteOptions,
): ParsedRoute<string | null> | null;
export function parseRoute(
  data: unknown, kinds: readonly string[] | null, options: RouteOptions,
): ParsedRoute<string | null> | null {
  const strict = options.mode !== 'strings' && options.mode !== 'unique-nonblank';
  const malformed = () => {
    if (strict && options.malformed) throw options.malformed();
    return null;
  };
  if (!isRecord(data)) return malformed();
  const routeKind = nonEmptyString(data.route_kind) ? data.route_kind : null;
  if (kinds && (routeKind === null || !kinds.includes(routeKind))) return malformed();
  if (strict && !Array.isArray(data.approvers)) return malformed();

  const approvers: ParsedRoute<string>['approvers'] = [];
  const seen = new Set<string>();
  for (const entry of Array.isArray(data.approvers) ? data.approvers as unknown[] : []) {
    const approver = parseApprover(entry, options);
    if (!approver) {
      if (strict) return malformed();
      continue;
    }
    if (options.mode === 'unique-nonblank' && seen.has(approver.id)) continue;
    seen.add(approver.id);
    approvers.push(approver);
  }
  return { routeKind, approvers, fields: data };
}
