/**
 * ERPNext company-defaults.set (#1599 ECX-3). Bed facts (`__fixtures__/companyDefaults.json`, v15): a partial
 * `PUT /api/resource/Company/<name>` sets a default; the ERP refuses a group, another company's account and an unknown
 * name, but accepts an account of any type and a group or another company's cost centre. So, before any write, this reads
 * each chosen account and cost centre from the ERP and refuses one that does not fit (`defaultTargetProblem`). It then reads
 * the Company, sends only the fields that change (no `modified`: a stale one is refused by the ERP), and reads the Company
 * back: a chosen value the ERP does not hold afterwards is a refusal, never a success.
 */
import { AdapterError } from '../contract.ts';
import {
  COMPANY_DEFAULT_SLOTS, defaultTargetProblem, normaliseChoice, SLOT_LABEL,
  type CompanyDefaultChoice, type CompanyDefaults, type CompanyDefaultSlot, type CompanyDefaultsSetResult,
  type CompanyDefaultsWriter, type DefaultTargetFacts,
} from '../companyDefaults.ts';
import { type ErpClientDeps, ErpError, getDoc, listDocsByFilters, updateDoc } from './client.ts';

/** The ERPNext Company field behind each PMO slot. */
export const ERPNEXT_DEFAULT_FIELD: Record<CompanyDefaultSlot, string> = {
  payable: 'default_payable_account',
  expense: 'default_expense_account',
  cash: 'default_cash_account',
  bank: 'default_bank_account',
  cost_centre: 'cost_center',
};

const text = (v: unknown): string | null => (typeof v === 'string' && v.trim() ? v : null);

function defaultsOf(doc: Record<string, unknown>): CompanyDefaults {
  return Object.fromEntries(COMPANY_DEFAULT_SLOTS.map((slot) => [slot, text(doc[ERPNEXT_DEFAULT_FIELD[slot]])])) as CompanyDefaults;
}

async function targetFacts(client: ErpClientDeps, slot: CompanyDefaultSlot, name: string): Promise<DefaultTargetFacts> {
  const doctype = slot === 'cost_centre' ? 'Cost Center' : 'Account';
  let doc: Record<string, unknown>;
  try {
    doc = (await getDoc(client, doctype, name)) as Record<string, unknown>;
  } catch (err) {
    if (err instanceof ErpError && err.status === 404) {
      throw new AdapterError('commit-rejected', `${name} was not found in the ERP, so it cannot be the ${SLOT_LABEL[slot]}.`);
    }
    throw err;
  }
  if (text(doc.name) !== name || typeof doc.company !== 'string') {
    throw new AdapterError('external-unreachable', `The ERP returned an unreadable record for ${name}.`);
  }
  return {
    name, company: doc.company, isGroup: Boolean(doc.is_group), disabled: Boolean(doc.disabled),
    rootType: text(doc.root_type), accountType: text(doc.account_type),
  };
}

export function createErpnextCompanyDefaults(client: ErpClientDeps, company: string): CompanyDefaultsWriter {
  const readCompany = async () => {
    const doc = (await getDoc(client, 'Company', company)) as Record<string, unknown>;
    if (doc?.name !== company) throw new AdapterError('external-unreachable', 'The ERP returned an unreadable company record.');
    return doc;
  };
  return {
    async read() {
      return defaultsOf(await readCompany());
    },
    async set(input: CompanyDefaultChoice): Promise<CompanyDefaultsSetResult> {
      let choice: CompanyDefaultChoice;
      try { choice = normaliseChoice(input); } catch (e) { throw new AdapterError('commit-rejected', (e as Error).message); }
      const slots = COMPANY_DEFAULT_SLOTS.filter((s) => choice[s] !== undefined);
      // Every choice is checked before any write: one that does not fit writes nothing at all.
      for (const slot of slots) {
        const problem = defaultTargetProblem(slot, company, await targetFacts(client, slot, choice[slot]!));
        if (problem) throw new AdapterError('commit-rejected', problem);
      }
      const current = defaultsOf(await readCompany());
      const written = slots.filter((s) => current[s] !== choice[s]);
      if (written.length === 0) return { written, readBack: current };
      await updateDoc(client, 'Company', company, Object.fromEntries(written.map((s) => [ERPNEXT_DEFAULT_FIELD[s], choice[s]])));
      const readBack = defaultsOf(await readCompany());
      const missed = slots.filter((s) => readBack[s] !== choice[s]);
      if (missed.length) {
        throw new AdapterError('commit-rejected', `The ERP did not keep the ${missed.map((s) => SLOT_LABEL[s]).join(', ')}. Nothing was recorded; try again.`);
      }
      return { written, readBack };
    },
  };
}

/** One cost centre of the company as the ERP lists it, in PMO terms. */
export interface CostCentreRow { name: string; isGroup: boolean; disabled: boolean }

/** Most cost centres one company may list in one read. A full page cannot be told from a cut-off one, so it fails closed. */
export const COST_CENTRE_PAGE = 500;

/** Every cost centre of the company (`GET Cost Center`, filtered by company). */
export async function listErpnextCostCentres(client: ErpClientDeps, company: string): Promise<CostCentreRow[]> {
  const rows = await listDocsByFilters(client, 'Cost Center', [['company', '=', company]], ['name', 'is_group', 'disabled'], COST_CENTRE_PAGE);
  if (rows.length >= COST_CENTRE_PAGE) throw new AdapterError('external-unreachable', 'The ERP lists more cost centres than PMO can read in one go.');
  return rows.map((row) => {
    if (!text(row.name)) throw new AdapterError('external-unreachable', 'The ERP returned an unreadable cost centre list.');
    return { name: String(row.name), isGroup: Boolean(row.is_group), disabled: Boolean(row.disabled) };
  });
}
