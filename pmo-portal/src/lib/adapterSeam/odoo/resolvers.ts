/**
 * What later slices ask of the one-time mapping (AC-ODC-071, FR-100/102): a value, or an explicit reason there is none.
 * Never a default, never a guess. The reads are injected so the browser, the edge functions and tests share this.
 */
export type Resolved<T> = ({ resolved: true } & T) | { resolved: false; reason: 'unlinked' | 'unmapped' | 'unset' | 'needs-attention'; detail?: string };
export interface ResolverReads {
  config(): Promise<Record<string, unknown> | null>;
  projectLink(projectId: string): Promise<{ external_container_id: string; config: Record<string, unknown> } | null>;
  master(kind: string, id: string): Promise<{ active: boolean; tombstoned_at: string | null } | null>;
}

export async function resolveProjectCostAccount(r: ResolverReads, projectId: string): Promise<Resolved<{ accountId: string }>> {
  const link = await r.projectLink(projectId);
  if (!link) return { resolved: false, reason: 'unlinked' };
  if (link.config.attention) return { resolved: false, reason: 'needs-attention', detail: String(link.config.attention) };
  return { resolved: true, accountId: link.external_container_id };
}

async function resolveFromConfig(r: ResolverReads, path: [string, string], kind: string, missing: 'unmapped' | 'unset'): Promise<Resolved<{ id: string }>> {
  const id = ((await r.config())?.[path[0]] as Record<string, string> | undefined)?.[path[1]];
  if (!id) return { resolved: false, reason: missing };
  const row = await r.master(kind, id);
  if (!row || !row.active || row.tombstoned_at) return { resolved: false, reason: 'needs-attention', detail: 'inactive' };
  return { resolved: true, id };
}

export const resolveUnit = (r: ResolverReads, unit: string) => resolveFromConfig(r, ['unit_map', unit], 'uom', 'unmapped');
export const resolveAccountDefault = (r: ResolverReads, key: string) => resolveFromConfig(r, ['account_defaults', key], 'account', 'unset');
