/**
 * #1599 ECX-3: the plain-words refusals of set-company-defaults, mapped to catalogue keys so the dialog reads them in the
 * person's language. The server speaks English (migration 0910 `request_company_defaults` /
 * `company_default_target_problem` / `record_company_defaults_result`, the setup function, and the adapter seam's
 * `defaultTargetProblem`); each sentence it can send has a key under
 * `administration:integrations.companyAccounts.refusal`. A sentence that matches none (the ERP's own words) is null, and
 * the dialog shows it as it came in English and as "the ERP refused this change" in any other language.
 */
import type { CompanyDefaultSlot } from '@/src/lib/repositories/types';

export interface CompanyDefaultsRefusal {
  /** Key under `administration:integrations.companyAccounts.refusal`. */
  key: string;
  /** The record the sentence names (an account, a cost centre or an unknown slot), as sent. */
  name?: string;
  /** The slot the sentence names. */
  slot?: CompanyDefaultSlot;
}

const SLOT_BY_LABEL: Record<string, CompanyDefaultSlot> = {
  'vendor payable account': 'payable',
  'default expense account': 'expense',
  'cash account': 'cash',
  'bank account': 'bank',
  'cost centre': 'cost_centre',
};
const LABELS = Object.keys(SLOT_BY_LABEL).join('|');
const KIND_KEY: Record<string, string> = { payable: 'notPayable', cash: 'notCash', bank: 'notBank', expense: 'notExpense' };

const TARGET: ReadonlyArray<[RegExp, (m: RegExpMatchArray) => string]> = [
  [new RegExp(`^(.+) is not in the ERP chart PMO has read, so it cannot be the (${LABELS})\\. Refresh the list and choose again\\.$`), () => 'notInChart'],
  [new RegExp(`^(.+) belongs to another company, so it cannot be the (${LABELS})\\.$`), () => 'otherCompany'],
  [new RegExp(`^(.+) is a group, so it cannot be the (${LABELS})\\. Choose an account or cost centre under it\\.$`), () => 'group'],
  [new RegExp(`^(.+) is disabled, so it cannot be the (${LABELS})\\.$`), () => 'disabled'],
  [new RegExp(`^(.+) is not an? (payable|cash|bank|expense) account, so it cannot be the (${LABELS})\\.$`), (m) => KIND_KEY[m[2]]],
];

const EXACT: Record<string, string> = {
  'Connect the ERP and choose its company first.': 'connectFirst',
  'Choose at least one company default.': 'chooseOne',
  'Choose a value for every company default you change.': 'chooseValue',
  'Setting company defaults from PMO is not available for this ERP yet': 'notAvailable',
  'The ERP connection changed; reload and try again': 'connectionChangedReload',
  'The ERP refused this change.': 'erpRefused',
  'The ERP company could not be read back, so nothing was recorded. Try again.': 'readBackFailed',
  'The ERP did not keep every chosen default, so nothing was recorded. Try again.': 'notKept',
  'A newer change to the company accounts was saved for this connection, so this one was not recorded.': 'newerSaved',
  'The ERP connection changed while this was being set, so nothing was recorded.': 'connectionChanged',
  'The change was not recorded. Try again.': 'notRecorded',
};

export function matchCompanyDefaultsRefusal(raw: string | null | undefined): CompanyDefaultsRefusal | null {
  const text = (raw ?? '').trim();
  if (!text) return null;
  if (EXACT[text]) return { key: EXACT[text] };
  const unknown = /^Unknown company default: (.+)\.$/.exec(text);
  if (unknown) return { key: 'unknownDefault', name: unknown[1] };
  for (const [pattern, key] of TARGET) {
    const m = text.match(pattern);
    if (m) return { key: key(m), name: m[1], slot: SLOT_BY_LABEL[m[m.length - 1]] };
  }
  return null;
}
