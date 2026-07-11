/**
 * Pure orchestration for externally-owned writes (FR-EAS-023/033/034/042).
 * Relative imports only so the edge-function can import this module directly.
 */
import { AppError } from '../appError.ts';
import { Adapter, AdapterCommand, AdapterError, CommandResult, PmoRecord } from './contract.ts';

export interface ExternalRefMapping {
  pmoRecordId: string;
  externalTier: string;
  externalRecordId: string;
  domain: string;
}

export interface DispatchExternallyOwnedWriteDeps {
  adapter: Pick<Adapter, 'tier' | 'capabilityMap' | 'commit'>;
  command: AdapterCommand;
  writeReadModel: (canonical: PmoRecord) => Promise<void>;
  recordExternalRef: (mapping: ExternalRefMapping) => Promise<void>;
  /**
   * Delete-aware dispatch (AC-CUA-038, FR-CUA-026, OD-CUA-2): tombstones the mirrored read-model
   * row instead of upserting a canonical record. Optional — omitted callers (P0) never take the
   * delete branch. Wired for `tasks` in the adapter-dispatch edge fn (`tombstoned_at = now()`).
   */
  tombstoneReadModel?: (pmoRecordId: string) => Promise<void>;
}

function toDispatchError(error: unknown): AppError {
  if (error instanceof AppError) return error;
  if (error instanceof AdapterError) {
    if (error.code === 'external-unreachable') {
      return new AppError('external system unreachable — try again', error.code);
    }
    return new AppError(error.message, error.code);
  }
  if (error instanceof Error) return new AppError(error.message);
  return new AppError('An unexpected error occurred');
}

export async function dispatchExternallyOwnedWrite(
  deps: DispatchExternallyOwnedWriteDeps,
): Promise<CommandResult> {
  try {
    const result = await deps.adapter.commit(deps.command);
    if (deps.command.operation === 'delete') {
      // Delete-aware (AC-CUA-038): tombstone the mirror, skip the upsert; the external_refs
      // mapping is kept as-is (not deleted) — never re-recorded on a delete.
      await deps.tombstoneReadModel?.(deps.command.record.id);
      return result;
    }
    await deps.writeReadModel(result.canonical);
    await deps.recordExternalRef({
      pmoRecordId: deps.command.record.id,
      externalTier: deps.adapter.tier,
      externalRecordId: result.externalRecordId,
      domain: deps.command.domain,
    });
    return result;
  } catch (error) {
    throw toDispatchError(error);
  }
}
