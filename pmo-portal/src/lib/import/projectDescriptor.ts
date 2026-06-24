import { repositories } from '@/src/lib/repositories';
import {
  PROJECT_ORIGINATION_STATUSES,
  type CreateProjectInput,
  type ProjectStatus,
} from '@/src/lib/db/projects';
import type { ImportDescriptor } from './types';
import { makeRefLookup, refValidate, refId } from './refLookup';

/**
 * Projects import descriptor (ADR-0027 fast-follow). Factory: closes over the org's companies
 * (→ `client_id`) and project managers (→ `project_manager_id`). Status is constrained to the
 * origination statuses (Leads / Internal Project) — the same gate the New-project form uses
 * (ADR-0020); a won/on-hand status is reachable only via the transition RPC, never an import.
 * `contract_value` is the origination value (optional, default 0; SoD only gates the won
 * transition per ADR-0019). `create` delegates to `repositories.project.create` (RLS authority).
 */
export function makeProjectImportDescriptor(
  companies: readonly { id: string; name: string }[],
  managers: readonly { id: string; name: string }[],
): ImportDescriptor<CreateProjectInput> {
  const client = makeRefLookup(companies, 'Company');
  const pm = makeRefLookup(managers, 'Project manager');
  return {
    entity: 'Projects',
    fields: [
      {
        key: 'name',
        label: 'Name',
        required: true,
        validate: (raw) => (raw.trim() ? null : 'Project name is required.'),
      },
      {
        key: 'status',
        label: 'Status',
        required: true,
        validate: (raw) =>
          PROJECT_ORIGINATION_STATUSES.includes(raw.trim() as ProjectStatus)
            ? null
            : `Status must be one of: ${PROJECT_ORIGINATION_STATUSES.join(', ')}.`,
      },
      { key: 'client_id', label: 'Company', required: false, validate: refValidate(client, false) },
      {
        key: 'project_manager_id',
        label: 'Project manager',
        required: false,
        validate: refValidate(pm, false),
      },
      {
        key: 'contract_value',
        label: 'Contract value',
        required: false,
        validate: (raw) => {
          if (!raw.trim()) return null;
          const n = Number(raw.trim());
          return Number.isFinite(n) && n >= 0 ? null : 'Contract value must be a non-negative number.';
        },
      },
      { key: 'start_date', label: 'Start date', required: false, validate: () => null },
      { key: 'end_date', label: 'End date', required: false, validate: () => null },
    ],
    toInput: (cells) => ({
      name: cells.name.trim(),
      status: cells.status.trim() as ProjectStatus,
      client_id: refId(client, cells.client_id ?? ''),
      project_manager_id: refId(pm, cells.project_manager_id ?? ''),
      contract_value: cells.contract_value?.trim() ? Number(cells.contract_value.trim()) : 0,
      start_date: cells.start_date?.trim() || null,
      end_date: cells.end_date?.trim() || null,
    }),
    create: (input) => repositories.project.create(input),
  };
}
