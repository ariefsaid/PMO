/**
 * The ERPNext site custom fields PMO's bodies write (#767). ERPNext silently DROPS an unknown key on
 * insert, so a body field with no Custom Field behind it is a value that never lands and never errors.
 * `ensureErpCustomFields` makes each one exist — idempotently — and is run by `erpnext-onboard`.
 *
 * Frappe names a Custom Field `<dt>-<fieldname>` and keeps an explicit `custom_`-prefixed fieldname
 * as given (frappe/custom/doctype/custom_field/custom_field.py `autoname`/`set_fieldname`).
 */
import { createDoc, ErpError, getDoc, updateDoc, type ErpClientDeps } from './client.ts';

export interface ErpCustomFieldSpec {
  dt: string;
  fieldname: string;
  label: string;
  fieldtype: string;
  insert_after: string;
  /** 1 lets the value change on a SUBMITTED document (a receipt is learned after submission). */
  allow_on_submit: 0 | 1;
}

export const ERP_CUSTOM_FIELDS: readonly ErpCustomFieldSpec[] = [
  // `siToBody` writes it; `siFromDoc` reads it back into `sales_invoices.received_date`.
  { dt: 'Sales Invoice', fieldname: 'custom_received_date', label: 'Received Date', fieldtype: 'Date', insert_after: 'due_date', allow_on_submit: 1 },
];

export type CustomFieldOutcome =
  | { name: string; outcome: 'exists' | 'created' | 'repaired' }
  | { name: string; outcome: 'failed'; message: string };

/**
 * Create each missing field; repair `allow_on_submit` on one that exists with the wrong value. A
 * failure (typically the integration user lacking System Manager) is REPORTED per field, never thrown:
 * a missing custom field costs only that field's value, so it must not block party onboarding.
 */
export async function ensureErpCustomFields(
  deps: ErpClientDeps,
  fields: readonly ErpCustomFieldSpec[] = ERP_CUSTOM_FIELDS,
): Promise<CustomFieldOutcome[]> {
  const outcomes: CustomFieldOutcome[] = [];
  for (const field of fields) {
    const name = `${field.dt}-${field.fieldname}`;
    try {
      let current: Record<string, unknown> | null = null;
      try {
        current = (await getDoc(deps, 'Custom Field', name)) as Record<string, unknown>;
      } catch (err) {
        if (!(err instanceof ErpError && err.status === 404)) throw err;
      }
      if (!current) {
        await createDoc(deps, 'Custom Field', { ...field });
        outcomes.push({ name, outcome: 'created' });
      } else if (Number(current.allow_on_submit ?? 0) !== field.allow_on_submit) {
        await updateDoc(deps, 'Custom Field', name, { allow_on_submit: field.allow_on_submit });
        outcomes.push({ name, outcome: 'repaired' });
      } else {
        outcomes.push({ name, outcome: 'exists' });
      }
    } catch (err) {
      outcomes.push({ name, outcome: 'failed', message: err instanceof Error ? err.message : String(err) });
    }
  }
  return outcomes;
}
