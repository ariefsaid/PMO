import type { TFunction } from 'i18next';
import type { Json } from '@/src/lib/supabase/database.types';

type NotificationCopy = { body: string | null; message_key: string | null; message_params: Json | null };

/** Old and unrecognised records keep their original body. Parameters are always user text. */
export function notificationBody(row: NotificationCopy, t: TFunction): string | null {
  const params = row.message_params && typeof row.message_params === 'object' && !Array.isArray(row.message_params) ? row.message_params : {};
  const text = (key: string, fallback: string) => typeof params[key] === 'string' ? params[key] : fallback;
  switch (row.message_key) {
    case 'budgetArchiveWarning':
      return t('notifications:budgetArchiveWarning', 'ERPNext may still be enforcing a budget for this project after this archive. Cancel the listed ERPNext Budget documents, or activate a new PMO budget.');
    case 'budgetCancellationHeld':
      return t('notifications:budgetCancellationHeld', "A replacement budget is on hold: an earlier ERPNext budget cancellation for the project still needs a person, or the person who activated this version cannot be identified. Resolve the previous version's budget in ERPNext — the replacement then pushes automatically.");
    case 'budgetRetryAuthorization':
      return t('notifications:budgetRetryAuthorization', "A replacement budget is on hold: the person recorded as having activated the version is no longer allowed to push budgets to ERPNext. The cancellation itself is fine. An Admin or Finance user should retry the push from the project's Budget tab.");
    case 'budgetPushFailed':
      return t('notifications:budgetPushFailed', 'PMO could not push the activated budget to ERPNext ({{reason}}) — ERPNext is still enforcing the previous budget (or none) for this project.', { reason: text('reason', 'unknown error') });
    case 'unassignedInvoice':
      return t('notifications:unassignedInvoice', 'Sales Invoice {{invoice}}{{amount}} arrived from ERPNext without a project and is in the Unassigned bucket. Assign it to a project.', { invoice: text('invoice', ''), amount: text('amount', '') });
    case 'literal':
      return row.body === null ? null : t('notifications:literal', '{{body}}', { body: text('body', row.body) });
    default: return row.body;
  }
}

export function notificationTitle(row: { title: string; message_key: string | null }, t: TFunction): string {
  return row.message_key === 'unassignedInvoice' ? t('notifications:unassignedInvoiceTitle', 'Invoice needs a project') : row.title;
}
