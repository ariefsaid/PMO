/**
 * Multi-domain read-model writer registry (task 1.6). Replaces the dispatch's inline
 * `if (domain===CLICKUP_TASKS_DOMAIN)` with `READ_MODEL_WRITERS[domain]` so adding a domain never
 * grows an if-chain. ClickUp's `tasks` writer moves in verbatim (byte-for-byte); every other domain
 * that has no dedicated writer keeps the P0 `external_reference_items` behavior via the `reference`
 * entry. ERPNext's `companies`/`procurement` entries are registered here as explicit **not-yet-wired**
 * writers — a loud throw, never a silent no-op — until their real bodies land in slices 3–6; no org is
 * flipped in this slice so they are never called.
 *
 * Integration-only (like `index.ts`): not unit-tested through Vitest, verified by `deno check` +
 * `deno test readModelWriters.test.ts`. Relative imports only so this stays Deno-importable.
 */
import { AppError } from '../../../pmo-portal/src/lib/appError.ts';
import type { AdapterCommand, PmoRecord } from '../../../pmo-portal/src/lib/adapterSeam/contract.ts';

/** Structural service-role client seam the writers below need: `.from(t).{insert,update,upsert}`.
 *  The real supabase-js client satisfies this at runtime but is not nominally assignable (thenable
 *  PostgrestFilterBuilder) — callers cast `as never` at the boundary, matching `index.ts`'s existing
 *  cast idiom for `recordExternalRefWrite`. */
export interface ReadModelServiceClient {
  from(table: string): {
    insert(row: unknown): Promise<{ error: { message: string; code?: string } | null }>;
    upsert(
      rows: unknown,
      options: { onConflict: string },
    ): Promise<{ error: { message: string; code?: string } | null }>;
    update(patch: unknown): ReadModelEqChain;
  };
}
export interface ReadModelEqChain {
  eq(column: string, value: string): ReadModelEqChain;
}

export interface ReadModelWriterCtx {
  serviceClient: ReadModelServiceClient;
  orgId: string;
}

export interface ReadModelWriter {
  /** Write the canonical record into this domain's read-model. `command` carries the operation
   *  (create vs update/transition) and the original record fields (e.g. `project_id` on a task
   *  create), matching the fields the pre-1.6 inline branch relied on. */
  upsert(ctx: ReadModelWriterCtx, canonical: PmoRecord, command: AdapterCommand): Promise<void>;
  /** Tombstone-aware domains only (P1 `tasks`, AC-CUA-038) — omitted elsewhere. */
  tombstone?(ctx: ReadModelWriterCtx, pmoRecordId: string): Promise<void>;
}

/** P0 default: the generic `external_reference_items` mirror (byte-for-byte pre-1.6 `else` branch). */
const referenceWriter: ReadModelWriter = {
  async upsert(ctx, canonical) {
    const { error } = await ctx.serviceClient.from('external_reference_items').upsert(
      { org_id: ctx.orgId, pmo_record_id: canonical.id, payload: canonical },
      { onConflict: 'org_id,pmo_record_id' },
    );
    if (error) throw new AppError(error.message, error.code);
  },
};

/** P1 ClickUp `tasks` writer, moved in verbatim from `index.ts`'s pre-1.6 inline branch. */
const tasksWriter: ReadModelWriter = {
  async upsert(ctx, canonical, command) {
    const patch = {
      name: canonical.name,
      status: canonical.status,
      assignee_id: canonical.assignee_id ?? null,
      start_date: canonical.start_date ?? null,
      end_date: canonical.end_date ?? null,
      completed_at: (canonical.completed_at as string | null | undefined) ?? null,
      source_updated_at: new Date().toISOString(),
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

/** A registered-but-not-yet-wired writer (task 1.6): fails loud rather than a silent `()=>{}`
 *  no-op — a silent no-op would swallow a real write if a flip ever landed early. */
const notWired = (domain: string): ReadModelWriter => ({
  upsert(): never {
    throw new Error(`erpnext read-model writer for '${domain}' is wired in slices 3–6`);
  },
});

export const READ_MODEL_WRITERS: Record<string, ReadModelWriter> = {
  reference: referenceWriter,
  tasks: tasksWriter,
  companies: notWired('companies'),
  procurement: notWired('procurement'),
};

/** The single lookup point — an unknown domain throws (no silent skip). */
export function getReadModelWriter(domain: string): ReadModelWriter {
  const writer = READ_MODEL_WRITERS[domain];
  if (!writer) throw new AppError(`no read-model writer registered for domain "${domain}"`, 'UNSUPPORTED_DOMAIN');
  return writer;
}
