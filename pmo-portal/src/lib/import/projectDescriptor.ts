import { repositories } from '@/src/lib/repositories';
import {
  PROJECT_ORIGINATION_STATUSES,
  type CreateProjectInput,
  type ProjectStatus,
  type TaxTreatment,
} from '@/src/lib/db/projects';
import { parseMoneyInput } from '@/src/lib/format';
import { TAX_TREATMENT_OPTIONS } from '@/src/lib/taxTreatment';
import type { ImportDescriptor } from './types';
import { makeRefLookup, refValidate, refId } from './refLookup';

/** The `tax_treatment` domain, read off the single shared options list (0197's CHECK verbatim). */
const TAX_TREATMENTS: readonly TaxTreatment[] = TAX_TREATMENT_OPTIONS.map((o) => o.value);

/**
 * Money cells go through `parseMoneyInput` — "the single parse used for BOTH validation and
 * persistence" (format.ts). A local `Number()` parse here (which this file used to have) silently
 * diverges from the #468 locale fix and would validate a cell one way and persist it another.
 */
function parsedMoney(raw: string | undefined): number | null {
  return raw?.trim() ? parseMoneyInput(raw) : null;
}

function moneyCellError(raw: string, label: string): string | null {
  if (!raw.trim()) return null; // optional — blank means "not stated"
  const n = parseMoneyInput(raw);
  return n !== null && n >= 0 ? null : `${label} must be a non-negative number.`;
}

/**
 * Projects import descriptor (ADR-0027 fast-follow). Factory: closes over the org's companies
 * (→ `client_id`) and project managers (→ `project_manager_id`). Status is constrained to the
 * origination statuses (Leads / Internal Project) — the same gate the New-project form uses
 * (ADR-0020); a won/on-hand status is reachable only via the transition RPC, never an import.
 * `contract_value` is the origination value (optional, default 0; SoD only gates the won
 * transition per ADR-0019). `create` delegates to `repositories.project.create` (RLS authority).
 *
 * #513 — A ROW THAT STATES A VALUE MUST STATE ITS BASIS. `tax_treatment`/`tax_amount` are per-cell
 * optional (a row at 0 states nothing and is asked nothing) and made conditionally REQUIRED by
 * `validateRow`, mirroring 0197's
 * `check (contract_value = 0 or (tax_treatment is not null and tax_amount is not null))`.
 * The rejection happens at PREVIEW with ZERO writes — the sheet's whole contract is that preview is
 * the oracle, and a row that only failed at the RPC would fail after the commit had already written
 * the rest of the file.
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
        validate: (raw) => moneyCellError(raw, 'Contract value'),
      },
      {
        key: 'tax_treatment',
        label: 'Tax treatment',
        required: false,
        validate: (raw) =>
          !raw.trim() || TAX_TREATMENTS.includes(raw.trim() as TaxTreatment)
            ? null
            : `Tax treatment must be one of: ${TAX_TREATMENTS.join(', ')}.`,
      },
      {
        key: 'tax_amount',
        label: 'Tax amount',
        required: false,
        validate: (raw) => moneyCellError(raw, 'Tax amount'),
      },
      { key: 'start_date', label: 'Start date', required: false, validate: () => null },
      { key: 'end_date', label: 'End date', required: false, validate: () => null },
    ],
    // The cross-field half of 0197's CHECK. Keyed to the cells the user must fix, so the preview
    // shows the message on the offending columns rather than as a row-level aside.
    validateRow: (cells) => {
      const value = parsedMoney(cells.contract_value);
      if (value === null || value <= 0) return {};
      const errors: Partial<Record<string, string>> = {};
      if (!TAX_TREATMENTS.includes(cells.tax_treatment?.trim() as TaxTreatment)) {
        errors.tax_treatment =
          `A row with a contract value must state its tax treatment (${TAX_TREATMENTS.join(' or ')}) — ` +
          'does the value already include the tax?';
      }
      if (parsedMoney(cells.tax_amount) === null) {
        errors.tax_amount =
          'A row with a contract value must state its tax amount (enter 0 when there is no tax).';
      }
      return errors;
    },
    toInput: (cells) => {
      const base = {
        name: cells.name.trim(),
        status: cells.status.trim() as ProjectStatus,
        client_id: refId(client, cells.client_id ?? ''),
        project_manager_id: refId(pm, cells.project_manager_id ?? ''),
        start_date: cells.start_date?.trim() || null,
        end_date: cells.end_date?.trim() || null,
      };
      const value = parsedMoney(cells.contract_value);
      const taxAmount = parsedMoney(cells.tax_amount);
      const treatment = cells.tax_treatment?.trim() as TaxTreatment | undefined;
      // The branch is not defensive style — `CreateProjectInput` is a union on exactly this rule,
      // so a valued row with no basis does not compile. `validateRow` has already rejected such a
      // row at preview; this is what makes that unreachable rather than merely unlikely.
      if (value !== null && value > 0 && taxAmount !== null && treatment) {
        return {
          ...base,
          contract_value: value,
          tax_treatment: treatment,
          tax_amount: taxAmount,
        };
      }
      return { ...base, contract_value: 0 };
    },
    create: (input) => repositories.project.create(input),
  };
}
