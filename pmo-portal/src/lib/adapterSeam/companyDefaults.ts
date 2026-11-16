/**
 * company-defaults.set (#1599 ECX-3): the ERP company's default accounts and cost centre, chosen in PMO and written to
 * the ERP by the tier's adapter. Tier-agnostic: PMO terms only, relative imports so the seam stays Deno-importable.
 *
 * The ERP checks only that a chosen account exists, is a leaf and belongs to the company (bed, ERPNext v15): it accepts a
 * Receivable account as the payable default and a group or another company's cost centre. So PMO checks the kind of every
 * choice itself, twice: the database against the mirrored chart before a request is accepted
 * (`request_company_defaults`, migration 0910), and the adapter against the ERP's own record before it writes.
 */

/** The five defaults PMO sets, in PMO terms. */
export const COMPANY_DEFAULT_SLOTS = ['payable', 'expense', 'cash', 'bank', 'cost_centre'] as const;
export type CompanyDefaultSlot = (typeof COMPANY_DEFAULT_SLOTS)[number];
export type CompanyDefaults = Record<CompanyDefaultSlot, string | null>;
export type CompanyDefaultChoice = Partial<Record<CompanyDefaultSlot, string>>;

/** What PMO knows about a chosen account or cost centre, in PMO terms. */
export interface DefaultTargetFacts {
  name: string;
  company: string;
  isGroup: boolean;
  disabled: boolean;
  /** Accounts only: Asset, Liability, Equity, Income or Expense. */
  rootType?: string | null;
  /** Accounts only: the ERP's account type (Payable, Cash, Bank, ...), or empty. */
  accountType?: string | null;
}

export const isCostCentreSlot = (slot: CompanyDefaultSlot) => slot === 'cost_centre';

/** The plain-words name of each slot, for a refusal the Admin reads. */
export const SLOT_LABEL: Record<CompanyDefaultSlot, string> = {
  payable: 'vendor payable account',
  expense: 'default expense account',
  cash: 'cash account',
  bank: 'bank account',
  cost_centre: 'cost centre',
};

/** The kind each account slot needs (the same rule as `request_company_defaults`). */
function kindProblem(slot: CompanyDefaultSlot, f: DefaultTargetFacts): string | null {
  switch (slot) {
    case 'payable': return f.accountType === 'Payable' ? null : 'is not a payable account';
    case 'cash': return f.accountType === 'Cash' ? null : 'is not a cash account';
    case 'bank': return f.accountType === 'Bank' ? null : 'is not a bank account';
    case 'expense': return f.rootType === 'Expense' ? null : 'is not an expense account';
    case 'cost_centre': return null;
  }
}

/**
 * Why a target cannot be the default for a slot, in plain words, or null when it fits. Every slot needs an enabled leaf
 * of the connected company; an account slot also needs the right kind.
 */
export function defaultTargetProblem(slot: CompanyDefaultSlot, company: string, f: DefaultTargetFacts): string | null {
  const label = SLOT_LABEL[slot];
  if (f.company !== company) return `${f.name} belongs to another company, so it cannot be the ${label}.`;
  if (f.isGroup) return `${f.name} is a group, so it cannot be the ${label}. Choose an account or cost centre under it.`;
  if (f.disabled) return `${f.name} is disabled, so it cannot be the ${label}.`;
  const kind = kindProblem(slot, f);
  return kind ? `${f.name} ${kind}, so it cannot be the ${label}.` : null;
}

/** A choice is one or more known slots, each a non-empty name. Throws plain words otherwise. */
export function normaliseChoice(input: unknown): CompanyDefaultChoice {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new Error('Choose at least one company default.');
  const out: CompanyDefaultChoice = {};
  for (const [key, value] of Object.entries(input as Record<string, unknown>)) {
    if (!(COMPANY_DEFAULT_SLOTS as readonly string[]).includes(key)) throw new Error(`Unknown company default: ${key}.`);
    if (typeof value !== 'string' || !value.trim() || value.length > 140) throw new Error(`Choose a ${SLOT_LABEL[key as CompanyDefaultSlot]}.`);
    out[key as CompanyDefaultSlot] = value.trim();
  }
  if (Object.keys(out).length === 0) throw new Error('Choose at least one company default.');
  return out;
}

/** What one set call did: the slots the ERP was asked to change (empty on a retry), and the defaults the ERP read back. */
export interface CompanyDefaultsSetResult {
  written: CompanyDefaultSlot[];
  readBack: CompanyDefaults;
}

/** A tier's writer for one connected company. */
export interface CompanyDefaultsWriter {
  read(): Promise<CompanyDefaults>;
  /** Refuses (`commit-rejected`, plain words) before any write when a choice does not fit; writes only changed slots; confirms by reading back. */
  set(choice: CompanyDefaultChoice): Promise<CompanyDefaultsSetResult>;
}
