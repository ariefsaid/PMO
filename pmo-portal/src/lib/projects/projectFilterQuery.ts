import { createFilterQuery, createFilterRule } from '@/src/components/reui/filters/filters-query';
import type { FilterQuery, FilterRule } from '@/src/components/reui/filters/filters-types';
import type { ProjectsWorkingSet } from '@/src/lib/listWorkingSet';
import { matchesProjectClassification, type ProjectClassification } from '@/src/lib/projectClassification';
import { UNASSIGNED_PROJECT_MANAGER } from '@/src/lib/projects/projectManagerLabel';

/**
 * The Projects filter builder (#1983) over the URL working set. The working set stays the single
 * source of truth: the builder's query is DERIVED from it (one rule per field, id = field id) and
 * every committed query is written straight back, so Back, reload and a shared link all rebuild
 * the same chips. One rule per field is the contract; OR groups and repeated fields are not offered.
 */
export type ProjectFilterFieldId =
  | 'status' | 'client' | 'endClient' | 'pm' | 'serviceLine' | 'sector' | 'awardType'
  | 'biddingEntity' | 'location' | 'startDate' | 'endDate' | 'contractValue';

export type ProjectFilterValue = string | number | (string | number | undefined)[];
export type ProjectBuilderPatch = Pick<
  ProjectsWorkingSet,
  'statuses' | 'client' | 'endClient' | 'pm' | 'serviceLine' | 'sector' | 'awardType' | 'biddingEntity' | 'location'
  | 'startFrom' | 'startTo' | 'endFrom' | 'endTo' | 'valueMin' | 'valueMax'
>;

const ON_OR_AFTER = 'is_on_or_after';
const ON_OR_BEFORE = 'is_on_or_before';

/** The bounds of an open or closed range as the operator that says exactly that. */
function rangeRule(
  id: ProjectFilterFieldId, from: string | number | undefined, to: string | number | undefined, kind: 'date' | 'number',
): FilterRule<ProjectFilterValue> | null {
  const has = (v: unknown) => v !== undefined && v !== '';
  if (has(from) && has(to)) return createFilterRule({ id, path: [id], operator: 'between', value: [from, to] });
  if (has(from)) return createFilterRule({ id, path: [id], operator: kind === 'date' ? ON_OR_AFTER : 'gte', value: from });
  if (has(to)) return createFilterRule({ id, path: [id], operator: kind === 'date' ? ON_OR_BEFORE : 'lte', value: to });
  return null;
}

export function workingSetToQuery(ws: Partial<ProjectsWorkingSet>, canViewMoney: boolean): FilterQuery<ProjectFilterValue> {
  const rules: (FilterRule<ProjectFilterValue> | null)[] = [];
  const one = (id: ProjectFilterFieldId, value: string | undefined, operator = 'is') =>
    rules.push(value && value !== 'All' ? createFilterRule({ id, path: [id], operator, value }) : null);
  if (ws.statuses?.length) rules.push(createFilterRule({ id: 'status', path: ['status'], operator: 'is_any_of', value: ws.statuses }));
  one('client', ws.client);
  one('endClient', ws.endClient);
  one('pm', ws.pm);
  one('serviceLine', ws.serviceLine);
  one('sector', ws.sector);
  one('awardType', ws.awardType);
  one('biddingEntity', ws.biddingEntity);
  one('location', ws.location, 'contains');
  rules.push(rangeRule('startDate', ws.startFrom, ws.startTo, 'date'));
  rules.push(rangeRule('endDate', ws.endFrom, ws.endTo, 'date'));
  if (canViewMoney) {
    rules.push(rangeRule('contractValue', ws.valueMin, ws.valueMax, 'number'));
  }
  return createFilterQuery(rules.filter((r): r is FilterRule<ProjectFilterValue> => r !== null));
}

const text = (v: unknown): string => (Array.isArray(v) ? String(v[0] ?? '') : v === undefined || v === null ? '' : String(v));

/** Every builder-owned key, always present so a removed rule clears its key. */
export function queryToPatch(query: FilterQuery<ProjectFilterValue>): ProjectBuilderPatch {
  const byField = new Map<string, FilterRule<ProjectFilterValue>>();
  for (const node of query.rules) if (node.type === 'rule') byField.set(node.path[0], node);
  const one = (id: ProjectFilterFieldId) => text(byField.get(id)?.value);
  const range = (id: ProjectFilterFieldId): [string, string] => {
    const rule = byField.get(id);
    if (!rule) return ['', ''];
    if (rule.operator === 'between') {
      const [a, b] = Array.isArray(rule.value) ? rule.value : [];
      return [text(a), text(b)];
    }
    const v = text(rule.value);
    return rule.operator === ON_OR_BEFORE || rule.operator === 'lte' ? ['', v] : [v, ''];
  };
  const statuses = byField.get('status')?.value;
  const [startFrom, startTo] = range('startDate');
  const [endFrom, endTo] = range('endDate');
  const [valueMin, valueMax] = range('contractValue');
  return {
    statuses: Array.isArray(statuses) && statuses.length ? statuses.map(String) : undefined,
    client: one('client') || 'All',
    endClient: one('endClient') || 'All',
    pm: one('pm') || 'All',
    serviceLine: one('serviceLine') || undefined,
    sector: one('sector') || undefined,
    awardType: (one('awardType') || undefined) as ProjectBuilderPatch['awardType'],
    biddingEntity: (one('biddingEntity') || undefined) as ProjectBuilderPatch['biddingEntity'],
    location: one('location') || undefined,
    startFrom: startFrom || undefined, startTo: startTo || undefined,
    endFrom: endFrom || undefined, endTo: endTo || undefined,
    valueMin: valueMin || undefined, valueMax: valueMax || undefined,
  };
}

export interface BuilderFilterable extends ProjectClassification {
  client_id?: string | null;
  end_client_id?: string | null;
  project_manager_id?: string | null;
  status?: string | null;
  start_date?: string | null;
  end_date?: string | null;
  contract_value?: number | null;
}

/** An unset bound never excludes; a set bound excludes a project with no value to compare. */
function inRange<T extends string | number>(value: T | null | undefined, from: T | undefined, to: T | undefined): boolean {
  if (from === undefined && to === undefined) return true;
  if (value === null || value === undefined) return false;
  return (from === undefined || value >= from) && (to === undefined || value <= to);
}

/** Money filter is honoured only for viewers who may see contract values (the field is not offered otherwise). */
export function matchesProjectBuilder(p: BuilderFilterable, ws: Partial<ProjectsWorkingSet>, canViewMoney: boolean): boolean {
  const num = (s: string | undefined) => (s === undefined || s === '' ? undefined : Number(s));
  const value = p.contract_value === null || p.contract_value === undefined ? p.contract_value : Number(p.contract_value);
  return (
    matchesProjectClassification(p, ws)
    && (!ws.statuses?.length || ws.statuses.includes(p.status ?? ''))
    && (!ws.client || ws.client === 'All' || p.client_id === ws.client)
    && (!ws.endClient || ws.endClient === 'All' || p.end_client_id === ws.endClient)
    && (!ws.pm || ws.pm === 'All' || (ws.pm === UNASSIGNED_PROJECT_MANAGER ? p.project_manager_id == null : p.project_manager_id === ws.pm))
    && inRange(p.start_date, ws.startFrom || undefined, ws.startTo || undefined)
    && inRange(p.end_date, ws.endFrom || undefined, ws.endTo || undefined)
    && (!canViewMoney || inRange(value, num(ws.valueMin), num(ws.valueMax)))
  );
}

/** How many builder rules are set (the Filters button badge). */
export function activeBuilderCount(ws: Partial<ProjectsWorkingSet>, canViewMoney: boolean): number {
  return workingSetToQuery(ws, canViewMoney).rules.length;
}
