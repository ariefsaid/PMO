/**
 * Organisation switches (#2746, ADR-0121): the on/off organisation settings, one entry each. An entry says where the
 * value is read and written (the switch's existing server pair, or an `organizations` column written under its column
 * grant and the Admin update policy), which `can()` entity gates the card, the roles its server write accepts, and the
 * query roots that depend on it. Storage, gates and validation stay in the database: this is the one front-end seam.
 */
import { supabase } from '@/src/lib/supabase/client';
import { AppError, assertWriteLanded } from '@/src/lib/appError';
import type { Entity } from '@/src/auth/policy';
import type { Role } from '@/src/auth/AuthContext';
import { wrap } from './repositoryErrors';
import { crewLoanRepository } from './crews';
import { builtInRolesRepository } from './builtInRoles';
import { disciplineProfitRepository } from './disciplineProfit';
import { safetyDayRepository } from './safetyDays';
import { stockWorkOrderTransferRepository } from './stockWorkOrderTransfer';

// ponytail: a literal until database.types.ts is regenerated (typed-client ticket); then derive it from the organizations Row.
type OrgColumn = 'clearance_checklist_enabled';

export interface OrgSwitch {
  source: { read: () => Promise<boolean>; write: (on: boolean) => Promise<unknown> } | { column: OrgColumn };
  manage: Entity;
  writers: readonly Role[];
  /** Query roots refetched after a change (what the switch's old mutation refreshed). */
  refreshes?: readonly string[];
}

export const ORG_SWITCHES = {
  crewLoans: { source: { read: crewLoanRepository.enabled, write: crewLoanRepository.setEnabled }, manage: 'orgAccounting', writers: ['Admin'] },
  clearance: { source: { column: 'clearance_checklist_enabled' }, manage: 'clearanceItem', writers: ['Admin'], refreshes: ['clearance'] },
  builtInRoles: { source: { read: builtInRolesRepository.getEnabled, write: builtInRolesRepository.setEnabled }, manage: 'orgAccounting', writers: ['Admin'] },
  disciplineProfit: { source: { read: disciplineProfitRepository.isEnabled, write: disciplineProfitRepository.setEnabled }, manage: 'orgAccounting', writers: ['Admin'] },
  safetyRecords: { source: { read: safetyDayRepository.isEnabled, write: safetyDayRepository.setEnabled }, manage: 'safetyLists', writers: ['Admin'], refreshes: ['safety-days'] },
  stockWoTransfers: { source: { read: stockWorkOrderTransferRepository.enabled, write: stockWorkOrderTransferRepository.setEnabled }, manage: 'warehouse', writers: ['Admin'] },
} satisfies Record<string, OrgSwitch>;

export type OrgSwitchKey = keyof typeof ORG_SWITCHES;
export const orgSwitch = (key: OrgSwitchKey): OrgSwitch => ORG_SWITCHES[key];

// eslint-disable-next-line @typescript-eslint/no-explicit-any -- same untyped organizations access as db/clearance.ts until the types are regenerated
const organizations = (): any => supabase.from('organizations' as never);

async function readColumn(column: OrgColumn): Promise<boolean> {
  const { data, error } = await organizations().select(column).limit(1);
  if (error) throw new AppError(error.message, error.code);
  return data?.[0]?.[column] === true;
}

async function writeColumn(column: OrgColumn, on: boolean): Promise<void> {
  const { data: orgs, error: readError } = await organizations().select('id');
  if (readError) throw new AppError(readError.message, readError.code);
  const id = orgs?.[0]?.id;
  if (!id || orgs.length > 1) throw new AppError('No single organisation is readable for the current user', 'no-org');
  const { data, error } = await organizations().update({ [column]: on }).eq('id', id).select('id');
  if (error) throw new AppError(error.message, error.code);
  assertWriteLanded(data, 'You do not have permission to change this setting.');
}

export const orgSwitchRepository = {
  read: (key: OrgSwitchKey): Promise<boolean> => {
    const s = orgSwitch(key).source;
    return wrap(() => ('column' in s ? readColumn(s.column) : s.read()));
  },
  write: (key: OrgSwitchKey, on: boolean): Promise<void> => {
    const s = orgSwitch(key).source;
    return wrap(async () => { await ('column' in s ? writeColumn(s.column, on) : s.write(on)); });
  },
};
