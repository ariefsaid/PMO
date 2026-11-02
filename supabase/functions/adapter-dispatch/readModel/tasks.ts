import { AppError } from '../../../../pmo-portal/src/lib/appError.ts';
import type { AdapterCommand, PmoRecord } from '../../../../pmo-portal/src/lib/adapterSeam/contract.ts';
import { requireOwnOrgLink } from './shared.ts';
import type { ReadModelWriter, ReadModelWriterCtx } from './types.ts';

/** The placement of a task the form changed: the milestone (PMO-native — ClickUp has no such field, so it
 *  comes from the command) and the parent (taken from ClickUp's own response on the canonical record, so
 *  the mirror never records a nesting ClickUp did not accept). Placement belongs to `create` and `update`
 *  ONLY: a status transition (which an assignee-only member may send) never changes it. Stamped only when
 *  the key is present (an explicit null clears). This writer runs as service role, so each referenced row
 *  is verified to belong to the caller's org first. */
async function taskPlacementFields(
  ctx: ReadModelWriterCtx,
  command: AdapterCommand,
  canonical: PmoRecord,
): Promise<Record<string, string | null>> {
  const out: Record<string, string | null> = {};
  if (command.operation !== 'create' && command.operation !== 'update') return out;
  for (const [column, table, source] of [
    ['milestone_id', 'project_milestones', command.record],
    ['parent_task_id', 'tasks', canonical],
  ] as const) {
    if (!(column in source)) continue;
    const id = source[column];
    if (typeof id === 'string' && id) await requireOwnOrgLink(ctx, table, id);
    out[column] = typeof id === 'string' && id ? id : null;
  }
  return out;
}

/** P1 ClickUp `tasks` writer, moved in verbatim from `index.ts`'s pre-1.6 inline branch. */
export const tasksWriter: ReadModelWriter = {
  async upsert(ctx, canonical, command) {
    const patch = {
      name: canonical.name,
      status: canonical.status,
      assignee_id: canonical.assignee_id ?? null,
      start_date: canonical.start_date ?? null,
      end_date: canonical.end_date ?? null,
      completed_at: (canonical.completed_at as string | null | undefined) ?? null,
      source_updated_at: new Date().toISOString(),
      ...(await taskPlacementFields(ctx, command, canonical)),
    };
    if (command.operation === 'create') {
      const projectId = (command.record as { project_id?: string }).project_id;
      if (!projectId) throw new AppError('project_id is required to mirror a created task', 'BAD_REQUEST');
      const { error } = await ctx.serviceClient
        .from('tasks')
        .insert({ id: canonical.id, org_id: ctx.orgId, project_id: projectId, ...patch });
      if (error) throw new AppError(error.message, error.code);
      return;
    }
    const { error } = await (
      ctx.serviceClient.from('tasks').update(patch).eq('org_id', ctx.orgId).eq('id', canonical.id) as unknown as Promise<{
        error: { message: string; code?: string } | null;
      }>
    );
    if (error) throw new AppError(error.message, error.code);
  },
  async tombstone(ctx, pmoRecordId) {
    const { error } = await (
      ctx.serviceClient
        .from('tasks')
        .update({ tombstoned_at: new Date().toISOString() })
        .eq('org_id', ctx.orgId)
        .eq('id', pmoRecordId) as unknown as Promise<{ error: { message: string; code?: string } | null }>
    );
    if (error) throw new AppError(error.message, error.code);
  },
};
