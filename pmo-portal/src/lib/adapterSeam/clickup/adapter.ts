/**
 * Assembles the ClickUp adapter (ADR-0055 P1, FR-CUA-001): a `tier==='clickup'`,
 * `capabilityMap==={'tasks'}` implementation of the P0 `Adapter` contract, dispatching commit() to
 * commands.ts and the reads to reads.ts. Pure + relative imports only (Deno-importable by
 * adapter-dispatch, same idiom as referenceAdapter.ts).
 */
import type {
  Adapter,
  AdapterCommand,
  ChangesSinceWatermark,
  CommandResult,
  PmoDomain,
  PmoRecord,
} from '../contract.ts';
import { commitClickUpTaskCommand, type ClickUpCommandDeps } from './commands.ts';
import { clickUpGetByExternalId, clickUpListChangesSinceWatermark, type ClickUpReadDeps } from './reads.ts';

export const CLICKUP_TIER = 'clickup';
export const CLICKUP_TASKS_DOMAIN: PmoDomain = 'tasks';

export interface ClickUpAdapterDeps extends ClickUpCommandDeps, ClickUpReadDeps {}

/** Construct the ClickUp adapter (AC-CUA-030): the only entry point above the contract that ever
 * sees a ClickUp-shaped dependency bag — every method it exposes speaks PMO domain language only. */
export function createClickUpAdapter(deps: ClickUpAdapterDeps): Adapter {
  return {
    tier: CLICKUP_TIER,
    capabilityMap: new Set<PmoDomain>([CLICKUP_TASKS_DOMAIN]),
    async commit(command: AdapterCommand): Promise<CommandResult> {
      return commitClickUpTaskCommand(command, deps);
    },
    async listChangesSinceWatermark(domain: PmoDomain, cursor: string | null): Promise<ChangesSinceWatermark> {
      return clickUpListChangesSinceWatermark(domain, cursor, deps);
    },
    async getByExternalId(domain: PmoDomain, externalRecordId: string): Promise<PmoRecord | null> {
      return clickUpGetByExternalId(domain, externalRecordId, deps);
    },
  };
}
