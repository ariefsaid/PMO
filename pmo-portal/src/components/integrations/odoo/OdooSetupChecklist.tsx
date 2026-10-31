/** The Odoo setup steps (FR-ODC-110, plan S5-T6). A tier-keyed list: ERPNext's activity-type and budget-category steps never appear here. */
import { useTranslation } from 'react-i18next';
import { Icon } from '@/src/components/ui';
import { useOdooConnection } from '@/src/hooks/useOdoo';
import { useExternalDomainOwnership } from '@/src/hooks/useExternalDomainOwnership';

export function OdooSetupChecklist() {
  const { t } = useTranslation();
  const read = useOdooConnection().data;
  const owned = useExternalDomainOwnership().data ?? [];
  if (!read || read.status !== 'active') return null;
  const cfg = read.config;
  const missing = read.capabilities?.missing ?? [];
  const steps: Array<{ name: string; done: boolean; hint: string }> = [
    { name: t('odoo.checklist.connected', 'Odoo connected'), done: true, hint: t('odoo.checklist.connectedHint', 'PMO can read your Odoo with the stored key.') },
    { name: t('odoo.checklist.activated', 'Company chosen'), done: read.activated, hint: t('odoo.checklist.activatedHint', 'Pick the Odoo company PMO works with.') },
    { name: t('odoo.checklist.capability', 'Odoo apps available'), done: read.activated && read.capabilities !== null && missing.length === 0,
      hint: missing.length ? t('odoo.checklist.capabilityMissing', 'Missing: {{missing}}', { missing: missing.join(', ') }) : t('odoo.checklist.capabilityHint', 'Checked when the company is chosen and on every re-check.') },
    { name: t('odoo.checklist.mapOnce', 'Map once'), done: Boolean(cfg.account_defaults && cfg.unit_map && cfg.default_warehouse_id), hint: t('odoo.checklist.mapOnceHint', 'Accounts, units and the default warehouse, proposed together and accepted in one step.') },
    { name: t('odoo.checklist.sends', 'Sends finished'), done: Boolean(cfg.sends_finished_at), hint: t('odoo.checklist.sendsHint', 'Records PMO holds that Odoo should also have are sent once.') },
    { name: t('odoo.checklist.employ', 'Vendors and clients managed in Odoo'), done: owned.some((o) => o.externalTier === 'odoo' && o.domain === 'companies'), hint: t('odoo.checklist.employHint', 'After this, Odoo owns vendor and client records.') },
  ];
  return (
    <section aria-labelledby="odoo-checklist-title" className="mt-3" data-testid="odoo-checklist">
      <h4 id="odoo-checklist-title" className="mb-1.5 text-sm font-semibold text-foreground">{t('odoo.checklist.title', 'Odoo setup')}</h4>
      <ol className="space-y-1.5">
        {steps.map((s) => (
          <li key={s.name} aria-label={s.name} className="flex items-start gap-2 text-sm">
            <Icon name={s.done ? 'check' : 'info'} className={`mt-0.5 size-3.55 shrink-0 ${s.done ? 'text-success' : 'text-muted-foreground'}`} aria-hidden="true" />
            <span className="min-w-0 flex-1">
              <span className="font-medium text-foreground">{s.name}</span>{' '}
              <span className="text-muted-foreground">{s.done ? '' : s.hint}</span>
            </span>
            <span className={s.done ? 'text-xs font-medium text-success-text' : 'text-xs text-muted-foreground'}>{s.done ? t('odoo.checklist.done', 'Done') : t('odoo.checklist.todo', 'To do')}</span>
          </li>
        ))}
      </ol>
    </section>
  );
}
