import type { TFunction } from 'i18next';
import { AppError } from '@/src/lib/appError';

/** Wire codes from external-connect / external-set-company -> localised copy. The server's English line is never shown. */
export function odooErrorMessage(t: TFunction, err: unknown): string {
  const code = err instanceof AppError ? err.code : undefined;
  const m: Record<string, string> = {
    'another-erp-active': t('odoo.error.anotherErpActive', 'Another accounting system is already connected. Disconnect it first.'),
    'destination-refused': t('odoo.error.destinationRefused', 'That address cannot be used. Use the public https address of your Odoo.'),
    unreachable: t('odoo.error.unreachable', 'Odoo could not be reached. Check the address and try again.'),
    timeout: t('odoo.error.timeout', 'Odoo did not answer in time. Try again.'),
    tls: t('odoo.error.tls', 'Odoo\'s security certificate could not be verified.'),
    'not-odoo': t('odoo.error.notOdoo', 'That address does not look like an Odoo instance.'),
    'no-json2': t('odoo.error.noJson2', 'This Odoo does not offer the JSON-2 API. Odoo 20 or later is needed.'),
    'unsupported-version': t('odoo.error.unsupportedVersion', 'This Odoo version is not supported. Odoo 20 or later is needed.'),
    'database-not-found': t('odoo.error.databaseNotFound', 'Odoo has no database with that name, or its API is not reachable at this address.'),
    'key-rejected': t('odoo.error.keyRejected', 'Odoo rejected the API key. Check the key and try again.'),
    'access-denied': t('odoo.error.accessDenied', 'The API key works but cannot read companies.'),
    'missing-model': t('odoo.error.missingModel', 'This Odoo is missing an app PMO needs.'),
    'target-locked': t('odoo.error.targetLocked', 'Documents already reference the current Odoo connection, so it cannot be switched to another database.'),
    'company-locked': t('odoo.error.companyLocked', 'This connection is locked to the company chosen first.'),
    'company-not-found': t('odoo.error.companyNotFound', 'That company is not available to this key.'),
    FORBIDDEN: t('odoo.error.forbidden', 'Your role cannot do this.'),
    RATE_LIMITED: t('odoo.error.rateLimited', 'This was just run. Try again in a minute.'),
    SYNC_RUNNING: t('odoo.error.syncRunning', 'A sync is running. Try again in a minute.'),
  };
  return (code && m[code]) || t('odoo.error.generic', 'Something went wrong. Nothing was changed. Try again.');
}
