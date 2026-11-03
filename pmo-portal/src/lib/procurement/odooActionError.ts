import type { TFunction } from 'i18next';

/** FR-OPP-091: Odoo could not be reached, so nothing was sent and nothing is queued. Null = not this case; use the shared classifier. */
export function odooActionError(err: unknown, odooOwned: boolean, t: TFunction): { headline: string; detail: string } | null {
  if (!odooOwned || (err as { code?: unknown } | null)?.code !== 'external-unreachable') return null;
  return {
    headline: t('procurement:odoo.unreachableAction', 'Odoo is unreachable, try again.'),
    detail: t('procurement:odoo.nothingSent', 'Nothing was sent.'),
  };
}
