import type React from 'react';
/** The Odoo setup steps (FR-ODC-110, plan S5-T6). A tier-keyed list: ERPNext's activity-type and budget-category steps never appear here. */
import { useTranslation } from 'react-i18next';
import { Icon } from '@/src/components/ui';
import { SENDS_FINISHED_KEY } from '@/src/lib/adapterSeam/odoo/connectionState';
import { useState } from 'react';
import { Button } from '@/src/components/ui';
import { useOdooConnection, useOdooJournalProposal, useOdooSetup, type JournalCandidate } from '@/src/hooks/useOdoo';
import { useOdooCan } from './useOdooCan';
import { useExternalDomainOwnership } from '@/src/hooks/useExternalDomainOwnership';

/** #1505 P8-T5: the default payment journal. One bank journal is proposed and accepted in one click; several are chosen from; none says so. */
function JournalDefault({ proposal, canSet }: { proposal: ReturnType<typeof useOdooJournalProposal>['data']; canSet: boolean }) {
  const { t } = useTranslation();
  const save = useOdooSetup('save-defaults');
  const [picked, setPicked] = useState('');
  const j = proposal?.journal;
  if (!j) return null;
  const submit = (id: string) => { void save.mutateAsync({ default_payment_journal_id: id }); };
  if (j.state === 'set') return j.current ? <span className="text-muted-foreground">{j.current.name}</span> : null;
  if (j.state === 'none') return <span className="text-muted-foreground">{t('administration:odoo.checklist.journalNone', 'No bank or cash journal has been read from Odoo yet.')}</span>;
  if (!canSet) return null;
  if (j.state === 'proposed' && j.proposed) {
    return (
      <span className="inline-flex flex-wrap items-center gap-2">
        <span className="text-muted-foreground">{t('administration:odoo.checklist.journalProposed', 'Proposed: {{name}}', { name: j.proposed.name })}</span>
        <Button size="sm" variant="outline" loading={save.isPending} onClick={() => submit(j.proposed!.id)}>
          {t('administration:odoo.checklist.journalAccept', 'Accept {{name}}', { name: j.proposed.name })}
        </Button>
      </span>
    );
  }
  return (
    <span className="inline-flex flex-wrap items-center gap-2">
      <select
        aria-label={t('administration:odoo.checklist.journal', 'Payment journal')}
        value={picked}
        onChange={(e) => setPicked(e.target.value)}
        className="h-8 rounded-md border border-input bg-background px-2 text-[13px]"
      >
        <option value="">{t('administration:odoo.checklist.journalChoose', 'Choose a journal')}</option>
        {j.candidates.map((c: JournalCandidate) => <option key={c.id} value={c.id}>{c.name}</option>)}
      </select>
      <Button size="sm" variant="outline" disabled={!picked} loading={save.isPending} onClick={() => submit(picked)}>{t('administration:odoo.checklist.journalSave', 'Save')}</Button>
    </span>
  );
}

export function OdooSetupChecklist() {
  const { t } = useTranslation();
  const read = useOdooConnection().data;
  const owned = useExternalDomainOwnership().data ?? [];
  const canSet = useOdooCan().setValue;
  const active = Boolean(read && read.status === 'active');
  const proposal = useOdooJournalProposal(active && read!.activated).data;
  if (!read || read.status !== 'active') return null;
  const cfg = read.config;
  const missing = read.capabilities?.missing ?? [];
  const steps: Array<{ name: string; done: boolean; hint: string; extra?: React.ReactNode }> = [
    { name: t('administration:odoo.checklist.connected', 'Odoo connected'), done: true, hint: t('administration:odoo.checklist.connectedHint', 'PMO can read your Odoo with the stored key.') },
    { name: t('administration:odoo.checklist.activated', 'Company chosen'), done: read.activated, hint: t('administration:odoo.checklist.activatedHint', 'Pick the Odoo company PMO works with.') },
    { name: t('administration:odoo.checklist.capability', 'Odoo apps available'), done: read.activated && read.capabilities !== null && missing.length === 0,
      hint: missing.length ? t('administration:odoo.checklist.capabilityMissing', 'Missing: {{missing}}', { missing: missing.join(', ') }) : t('administration:odoo.checklist.capabilityHint', 'Checked when the company is chosen and on every re-check.') },
    { name: t('administration:odoo.checklist.mapOnce', 'Map once'), done: Boolean(cfg.account_defaults && cfg.unit_map && cfg.default_warehouse_id), hint: t('administration:odoo.checklist.mapOnceHint', 'Accounts, units and the default warehouse, proposed together and accepted in one step.') },
    { name: t('administration:odoo.checklist.journal', 'Payment journal'), done: Boolean(cfg.default_payment_journal_id), hint: t('administration:odoo.checklist.journalHint', 'The bank or cash journal supplier payments are made from, unless Finance picks another.'),
      extra: <JournalDefault proposal={proposal} canSet={canSet} /> },
    { name: t('administration:odoo.checklist.sends', 'Sends finished'), done: Boolean(cfg[SENDS_FINISHED_KEY]), hint: t('administration:odoo.checklist.sendsHint', 'Records PMO holds that Odoo should also have are sent once.') },
    { name: t('administration:odoo.checklist.employ', 'Vendors and clients managed in Odoo'), done: owned.some((o) => o.externalTier === 'odoo' && o.domain === 'companies'), hint: t('administration:odoo.checklist.employHint', 'After this, Odoo owns vendor and client records.') },
  ];
  return (
    <section aria-labelledby="odoo-checklist-title" className="mt-3" data-testid="odoo-checklist">
      <h4 id="odoo-checklist-title" className="mb-1.5 text-sm font-semibold text-foreground">{t('administration:odoo.checklist.title', 'Odoo setup')}</h4>
      <ol className="space-y-1.5">
        {steps.map((s) => (
          <li key={s.name} aria-label={s.name} className="flex items-start gap-2 text-sm">
            <Icon name={s.done ? 'check' : 'info'} className={`mt-0.5 size-3.55 shrink-0 ${s.done ? 'text-success' : 'text-muted-foreground'}`} aria-hidden="true" />
            <span className="min-w-0 flex-1">
              <span className="font-medium text-foreground">{s.name}</span>{' '}
              <span className="text-muted-foreground">{s.done ? '' : s.hint}</span>{s.extra && <div className="mt-1">{s.extra}</div>}
            </span>
            <span className={s.done ? 'text-xs font-medium text-success-text' : 'text-xs text-muted-foreground'}>{s.done ? t('administration:odoo.checklist.done', 'Done') : t('administration:odoo.checklist.todo', 'To do')}</span>
          </li>
        ))}
      </ol>
    </section>
  );
}
