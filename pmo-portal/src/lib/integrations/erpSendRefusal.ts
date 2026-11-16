/**
 * Reads the sentence the server stored for a refused or unconfirmed ERP send (`reason_text`, English, written by the
 * send drain and its result functions) and names which known refusal it is, so the setup screen can say it in the
 * viewer's language from the catalogue, as the company-defaults dialog does. Unknown sentences return `null`.
 */
export type ErpSendRefusalId =
  | 'gone' | 'person' | 'personOdoo' | 'actor' | 'ambiguous' | 'linked' | 'stuck' | 'refused' | 'held'
  | 'planFirst' | 'projectNumber' | 'notApplied' | 'companyGone' | 'projectGone' | 'internalCompany' | 'changedSince'
  | 'personGone' | 'itemLinked' | 'unitUnmapped';

export type ErpSendNoun = 'company' | 'project' | 'item' | 'person' | 'record';

export interface ErpSendRefusal {
  id: ErpSendRefusalId;
  noun: ErpSendNoun;
  /** The ERP's own short reason (English), only for `refused`. */
  reason: string | null;
  /** `held` names the system it is waiting on. */
  erp: 'ERP' | 'Odoo';
}

const NOUNS = new Set(['company', 'project', 'item', 'person']);
const asNoun = (w: string | undefined): ErpSendNoun => (w && NOUNS.has(w) ? (w as ErpSendNoun) : 'record');

const FIXED: Record<string, ErpSendRefusalId> = {
  'This record is no longer in PMO, or (an item) no longer on an open purchase.': 'gone',
  'The Admin who accepted this is no longer an Admin. Accept it again.': 'actor',
  'This record is already linked to another ERP record.': 'linked',
  'This record is already linked to another ERP record': 'linked',
  'We could not finish sending this record. Check it in the ERP, then try again.': 'stuck',
  'Odoo people are not sent from PMO yet. Add this person in Odoo.': 'personOdoo',
  'Choose the cost-account plan for projects first, then send this project again.': 'planFirst',
  'This project has no project number yet, so its cost account cannot be named. Give it one, then send it again.': 'projectNumber',
  'This row could not be applied': 'notApplied',
  'This company is no longer in PMO': 'companyGone',
  'This project is no longer in PMO': 'projectGone',
  'An internal company cannot take an ERP link': 'internalCompany',
  'The ERP record changed since this was proposed': 'changedSince',
  'This person is no longer in PMO': 'personGone',
  'This item is already linked': 'itemLinked',
};

export function parseErpSendRefusal(text: string | null | undefined): ErpSendRefusal | null {
  if (!text) return null;
  const base = { noun: 'record' as ErpSendNoun, reason: null, erp: 'ERP' as const };
  const fixed = FIXED[text];
  if (fixed) return { ...base, id: fixed };
  if (/^This ERP asks for a birth date and gender for each person, which PMO does not hold\. Add this person in the ERP\.$/.test(text)
    || text === 'Add this person in the ERP by hand.') return { ...base, id: 'person', noun: 'person' };
  const held = /^We could not confirm whether (the ERP|Odoo) created this record/.exec(text);
  if (held) return { ...base, id: 'held', erp: held[1] === 'Odoo' ? 'Odoo' : 'ERP' };
  const amb = /^Two ERP records match this (\w+)\. Link the right one by hand\.$/.exec(text);
  if (amb) return { ...base, id: 'ambiguous', noun: asNoun(amb[1]) };
  const ref = /^The ERP refused this (\w+)(?:: ([\s\S]+)|\. Check it in the ERP, then try again\.)$/.exec(text);
  if (ref) {
    if (ref[2] === 'its unit has no match in Odoo yet') return { ...base, id: 'unitUnmapped', noun: asNoun(ref[1]) };
    if (ref[2] === 'the project has no project number yet') return { ...base, id: 'projectNumber', noun: asNoun(ref[1]) };
    return { ...base, id: 'refused', noun: asNoun(ref[1]), reason: ref[2] ?? null };
  }
  return null;
}
