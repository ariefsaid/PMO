export type Layout = 'a' | 'b' | 'c';
export type Area = 'overview' | 'budget' | 'procurement' | 'tasks' | 'contract' | 'documents' | 'activity';
export const AREAS: Area[] = ['overview', 'budget', 'procurement', 'tasks', 'contract', 'documents', 'activity'];
/** Old deep links keep working: the merged areas absorb their former tabs. */
export function areaFromParam(param: string | undefined): Area {
  if (param === 'work-orders' || param === 'billing') return 'contract';
  if (param === 'history') return 'activity';
  return (AREAS as string[]).includes(param ?? '') ? (param as Area) : 'overview';
}
