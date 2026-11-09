/** The Odoo setup steps (FR-ODC-110, plan S5-T6). A tier-keyed list: ERPNext's activity-type and budget-category steps never appear here. */
import { useTranslation } from 'react-i18next';
import { Button, ConfirmDialog, Icon, SelectField } from '@/src/components/ui';
import { SENDS_FINISHED_KEY } from '@/src/lib/adapterSeam/odoo/connectionState';
import React, { useState } from 'react';
import { useOdooConnection, useOdooConnectStatus, useOdooEmploy, useOdooJournalProposal, useOdooSetup, type JournalCandidate } from '@/src/hooks/useOdoo';
import { useOdooCan } from './useOdooCan';
import { odooErrorMessage } from './odooErrors';
import { useExternalDomainOwnership } from '@/src/hooks/useExternalDomainOwnership';
import { OdooAccountSelect } from '@/src/components/procurement/OdooDirectoryPickers';

function AccountDefault({ kind, value, canSet }: { kind: 'advance' | 'prepaid'; value: string; canSet: boolean }) {
  const { t } = useTranslation();
  const save = useOdooSetup('save-defaults');
  const [picked, setPicked] = useState('');
  const [failed, setFailed] = useState(false);
  const label = kind === 'advance'
    ? t('administration:odoo.checklist.customerAdvance', 'Customer-advance account')
    : t('administration:odoo.checklist.taxPrepaid', 'Tax-prepaid account');
  const savedId = kind === 'advance' ? value.replace(/^account\.account:/, '') : value;
  const submit = async (id: string) => {
    setFailed(false);
    try {
      await save.mutateAsync(kind === 'advance' ? { customer_advance_account_ref: `account.account:${id}` } : { tax_prepaid_account_id: id });
    } catch { setFailed(true); }
  };
  if (!canSet) return savedId ? <span className="text-muted-foreground">{savedId}</span> : null;
  return (
    <span className="inline-flex flex-wrap items-start gap-2">
      <OdooAccountSelect id={`odoo-${kind}-account`} label={label} hideLabel value={picked || savedId} onChange={setPicked} />
      <Button size="sm" variant="outline" disabled={!picked || picked === savedId} loading={save.isPending} onClick={() => { void submit(picked); }}>{t('administration:odoo.checklist.journalSave', 'Save')}</Button>
      {failed && <span role="alert" className="text-[12px] text-destructive-text">{t('administration:odoo.checklist.accountFailed', 'The account could not be saved. Try again.')}</span>}
    </span>
  );
}

/** #1505 P8-T5: the default payment journal. One bank journal is proposed and accepted in one click; several are chosen from; none says so. */
function JournalDefault({ proposal, canSet }: { proposal: ReturnType<typeof useOdooJournalProposal>['data']; canSet: boolean }) {
  const { t } = useTranslation();
  const save = useOdooSetup('save-defaults');
  const [picked, setPicked] = useState('');
  const [failed, setFailed] = useState(false);
  const j = proposal?.journal;
  if (!j) return null;
  const submit = async (id: string) => {
    setFailed(false);
    try { await save.mutateAsync({ default_payment_journal_id: id }); } catch { setFailed(true); }
  };
  const failure = failed && <span role="alert" className="text-[12px] text-destructive-text">{t('administration:odoo.checklist.journalFailed', 'The journal could not be saved. Try again.')}</span>;
  if (j.state === 'set') return j.current ? <span className="text-muted-foreground">{j.current.name}</span> : null;
  if (j.state === 'none') return <span className="text-muted-foreground">{t('administration:odoo.checklist.journalNone', 'No bank or cash journal has been read from Odoo yet.')}</span>;
  if (!canSet) return null;
  if (j.state === 'proposed' && j.proposed) {
    return (
      <span className="inline-flex flex-wrap items-center gap-2">
        <span className="text-muted-foreground">{t('administration:odoo.checklist.journalProposed', 'Proposed: {{name}}', { name: j.proposed.name })}</span>
        <Button size="sm" variant="outline" loading={save.isPending} onClick={() => { void submit(j.proposed!.id); }}>
          {t('administration:odoo.checklist.journalAccept', 'Accept {{name}}', { name: j.proposed.name })}
        </Button>
        {failure}
      </span>
    );
  }
  return (
    <span className="inline-flex flex-wrap items-end gap-2">
      <SelectField
        label={t('administration:odoo.checklist.journal', 'Payment journal')}
        hideLabel
        value={picked}
        onChange={setPicked}
        placeholder={t('administration:odoo.checklist.journalChoose', 'Choose a journal')}
        options={j.candidates.map((c: JournalCandidate) => ({ value: c.id, label: c.name }))}
      />
      <Button size="sm" variant="outline" disabled={!picked} loading={save.isPending} onClick={() => { void submit(picked); }}>{t('administration:odoo.checklist.journalSave', 'Save')}</Button>
      {failure}
    </span>
  );
}

/** #2050: hand a domain to Odoo after one confirm. Vendors and clients wait until every record has reached Odoo; the server refuses otherwise (`sends-pending`). It can be handed back, so the confirm is not destructive. */
function EmployAction({ domain, waiting }: { domain: 'companies' | 'procurement'; waiting: boolean }) {
  const { t } = useTranslation();
  const employ = useOdooEmploy();
  const [open, setOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const words = {
    companies: {
      action: t('administration:odoo.employ.companiesAction', 'Let Odoo manage vendors and clients'),
      title: t('administration:odoo.employ.companiesTitle', 'Let Odoo manage vendors and clients?'),
      body: t('administration:odoo.employ.companiesBody', 'From now on, Odoo holds your vendor and client records. New vendors and clients, and changes to names and tax numbers, are saved in Odoo through PMO\'s forms.'),
      confirm: t('administration:odoo.employ.companiesConfirm', 'Let Odoo manage them'),
    },
    procurement: {
      action: t('administration:odoo.employ.procurementAction', 'Send purchases to Odoo'),
      title: t('administration:odoo.employ.procurementTitle', 'Send purchases to Odoo?'),
      body: t('administration:odoo.employ.procurementBody', 'From now on, approved purchase orders, goods receipts and supplier bills are also created in Odoo.'),
      confirm: t('administration:odoo.employ.procurementConfirm', 'Send purchases'),
    },
  }[domain];
  const confirm = async () => {
    setError(null);
    try {
      await employ.mutateAsync(domain);
    } catch (err) {
      setError(odooErrorMessage(t, err));
    }
    setOpen(false);
  };
  return (
    <span className="block space-y-1">
      <Button size="sm" variant="outline" disabled={waiting} onClick={() => setOpen(true)}>{words.action}</Button>
      {waiting && <span className="block text-muted-foreground">{t('administration:odoo.employ.waitSends', 'Wait until every record has reached Odoo.')}</span>}
      {error && <span role="alert" className="block break-words text-destructive-text">{error}</span>}
      <ConfirmDialog open={open} title={words.title} description={words.body} confirmLabel={words.confirm} tone="default" loading={employ.isPending} onConfirm={() => void confirm()} onCancel={() => setOpen(false)} />
    </span>
  );
}

export function OdooSetupChecklist() {
  const { t } = useTranslation();
  const read = useOdooConnection().data;
  const owned = useExternalDomainOwnership().data ?? [];
  const may = useOdooCan();
  const canSet = may.setValue;
  const active = Boolean(read && read.status === 'active');
  const proposal = useOdooJournalProposal(active && read!.activated).data;
  const waitingForSend = useOdooConnectStatus(active && read!.activated && may.manage).data?.waitingForSend ?? 0;
  if (!read || read.status !== 'active') return null;
  const cfg = read.config;
  const employed = (domain: string) => owned.some((o) => o.externalTier === 'odoo' && o.domain === domain);
  const missing = read.capabilities?.missing ?? [];
  const steps: Array<{ name: string; done: boolean; hint: string; extra?: React.ReactNode }> = [
    { name: t('administration:odoo.checklist.connected', 'Odoo connected'), done: true, hint: t('administration:odoo.checklist.connectedHint', 'PMO can read your Odoo with the stored key.') },
    { name: t('administration:odoo.checklist.activated', 'Company chosen'), done: read.activated, hint: t('administration:odoo.checklist.activatedHint', 'Pick the Odoo company PMO works with.') },
    { name: t('administration:odoo.checklist.capability', 'Odoo apps available'), done: read.activated && read.capabilities !== null && missing.length === 0,
      hint: missing.length ? t('administration:odoo.checklist.capabilityMissing', 'Missing: {{missing}}', { missing: missing.join(', ') }) : t('administration:odoo.checklist.capabilityHint', 'Checked when the company is chosen and on every re-check.') },
    { name: t('administration:odoo.checklist.mapOnce', 'Map once'), done: Boolean(cfg.account_defaults && cfg.unit_map && cfg.default_warehouse_id), hint: t('administration:odoo.checklist.mapOnceHint', 'Accounts, units and the default warehouse, proposed together and accepted in one step.') },
    { name: t('administration:odoo.checklist.journal', 'Payment journal'), done: Boolean(cfg.default_payment_journal_id), hint: t('administration:odoo.checklist.journalHint', 'The bank or cash journal supplier payments are made from, unless Finance picks another.'),
      extra: <JournalDefault proposal={proposal} canSet={canSet} /> },
    { name: t('administration:odoo.checklist.customerAdvance', 'Customer-advance account'), done: Boolean(cfg.customer_advance_account_ref), hint: t('administration:odoo.checklist.customerAdvanceHint', 'Choose the account that holds customer advances.'), extra: <AccountDefault kind="advance" value={String(cfg.customer_advance_account_ref ?? '')} canSet={canSet} /> },
    { name: t('administration:odoo.checklist.taxPrepaid', 'Tax-prepaid account'), done: Boolean(cfg.tax_prepaid_account_id), hint: t('administration:odoo.checklist.taxPrepaidHint', 'Choose the asset account used for client tax withheld.'), extra: <AccountDefault kind="prepaid" value={String(cfg.tax_prepaid_account_id ?? '')} canSet={canSet} /> },
    { name: t('administration:odoo.checklist.sends', 'Sends finished'), done: Boolean(cfg[SENDS_FINISHED_KEY]), hint: t('administration:odoo.checklist.sendsHint', 'Records PMO holds that Odoo should also have are sent once.') },
    { name: t('administration:odoo.checklist.employ', 'Vendors and clients managed in Odoo'), done: employed('companies'), hint: t('administration:odoo.checklist.employHint', 'After this, Odoo owns vendor and client records.'),
      extra: may.manage && !employed('companies') ? <EmployAction domain="companies" waiting={waitingForSend > 0} /> : undefined },
    { name: t('administration:odoo.checklist.procurement', 'Purchases go to Odoo'), done: employed('procurement'), hint: t('administration:odoo.checklist.procurementHint', 'After this, approved purchase orders, goods receipts and supplier bills are also created in Odoo.'),
      extra: may.manage && !employed('procurement') ? <EmployAction domain="procurement" waiting={false} /> : undefined },
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
              <span className="text-muted-foreground">{s.done ? '' : s.hint}</span>{s.extra && <span className="mt-1 block">{s.extra}</span>}
            </span>
            <span className={s.done ? 'text-xs font-medium text-success-text' : 'text-xs text-muted-foreground'}>{s.done ? t('administration:odoo.checklist.done', 'Done') : t('administration:odoo.checklist.todo', 'To do')}</span>
          </li>
        ))}
      </ol>
    </section>
  );
}
