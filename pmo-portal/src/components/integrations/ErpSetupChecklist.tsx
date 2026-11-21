import { useState } from 'react';
import { Link } from 'react-router';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { externalDomainOwnershipKey } from '@/src/hooks/approvalsQueryKeys';
import { repositories } from '@/src/lib/repositories';
import {
  Button,
  EntityFormModal,
  FormGrid,
  ListState,
  SelectField,
  TextField,
  type SubmitError,
} from '@/src/components/ui';
import { useEntityForm } from '@/src/components/ui/useEntityForm';
import { domainLabel } from './integrationLabels';
import { EXPENSES_EMPLOYABLE } from '@/src/lib/adapterSeam/erpnext/expenseEnablement';
import { COMPANY_DEFAULTS, fiscalYearOperatorTask, getErpSetupIncompleteness, missingAccountCategories, requiredBudgetCategories } from './erpSetupIncompleteness';
import { ErpSendStates } from './ErpSendStates';
import { ProjectMatchReview } from './ProjectMatchReview';
import { ConnectProposalReview } from './ConnectProposalReview';
import { AccountLinkNotes, DirectCostAccounts } from './DirectCostAccounts';
import { useAccountLinkNotes } from './useAccountLinkNotes';
import { AppError } from '@/src/lib/appError';
import type { CompanyDefaultSlot } from '@/src/lib/repositories/types';
import { matchCompanyDefaultsRefusal } from '@/src/lib/i18n/companyDefaultsRefusal';

/** #1599 ECX-3: the company defaults PMO sets in the ERP, and the readiness key each one fills. */
const ACCOUNT_SLOTS: ReadonlyArray<{ slot: CompanyDefaultSlot; key: string }> = [
  { slot: 'payable', key: 'default_payable_account' },
  { slot: 'expense', key: 'default_expense_account' },
  { slot: 'cash', key: 'default_cash_account' },
  { slot: 'bank', key: 'default_bank_account' },
  { slot: 'cost_centre', key: 'cost_center' },
];
/** Refusals that carry plain words for the person (PMO's checks and the ERP's own reason, cleaned server-side). */
const PLAIN_REFUSALS = new Set(['config-rejected', 'BAD_REQUEST']);

// #775 phase B — `expenses` is offered only once its release guard (#901) is open (FR-EXP-118, DD-EXP-22).
const ERP_DOMAINS = ['companies', 'procurement', 'revenue', 'timesheets', ...(EXPENSES_EMPLOYABLE ? ['expenses'] : [])];
export function ErpSetupChecklist(
  { orgId, onRefreshCompany }: {
    orgId: string | undefined;
    onRefreshCompany: () => void;
  },
) {
  const { t, i18n } = useTranslation();
  const qc = useQueryClient();
  const setup = useQuery({
    queryKey: ['integrations', 'setup', orgId],
    queryFn: () => repositories.integrations.getErpSetup(),
    enabled: Boolean(orgId),
    retry: false,
  });
  const [editing, setEditing] = useState<'defaults' | 'domain' | 'accounts' | null>(null);
  const [matchReviewOpen, setMatchReviewOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [accountsError, setAccountsError] = useState<SubmitError | null>(null);
  const defaults = useEntityForm({
    initialValues: { activityType: '', receivableAccount: '' },
    requiredFields: ['activityType', 'receivableAccount'],
    idPrefix: 'erp-defaults',
  });
  const domain = useEntityForm({
    initialValues: { domain: '' },
    requiredFields: ['domain'],
    idPrefix: 'erp-domain',
  });
  const accounts = useEntityForm<Record<CompanyDefaultSlot, string>>({
    initialValues: { payable: '', expense: '', cash: '', bank: '', cost_centre: '' },
    idPrefix: 'erp-accounts',
  });
  const accountOptions = useQuery({
    queryKey: ['integrations', 'company-default-options', orgId],
    queryFn: () => repositories.integrations.getCompanyDefaultOptions(),
    enabled: editing === 'accounts',
    retry: false,
  });
  const currentAccount = (key: string) => (setup.data?.defaults as Record<string, string | null | undefined> | undefined)?.[key] ?? '';
  const openAccounts = () => {
    accounts.reset(Object.fromEntries(ACCOUNT_SLOTS.map(({ slot, key }) => [slot, currentAccount(key)])) as Record<CompanyDefaultSlot, string>);
    setError(null);
    setAccountsError(null);
    setEditing('accounts');
  };
  const slotLabels: Record<CompanyDefaultSlot, string> = {
    payable: t('administration:integrations.companyAccounts.accountSlots.payable', 'Vendor payable account'),
    expense: t('administration:integrations.companyAccounts.accountSlots.expense', 'Default expense account'),
    cash: t('administration:integrations.companyAccounts.accountSlots.cash', 'Cash account'),
    bank: t('administration:integrations.companyAccounts.accountSlots.bank', 'Bank account'),
    cost_centre: t('administration:integrations.companyAccounts.accountSlots.costCentre', 'Cost centre'),
  };
  const slotInSentence: Record<CompanyDefaultSlot, string> = {
    payable: t('administration:integrations.companyAccounts.slotInSentence.payable', 'vendor payable account'),
    expense: t('administration:integrations.companyAccounts.slotInSentence.expense', 'default expense account'),
    cash: t('administration:integrations.companyAccounts.slotInSentence.cash', 'cash account'),
    bank: t('administration:integrations.companyAccounts.slotInSentence.bank', 'bank account'),
    cost_centre: t('administration:integrations.companyAccounts.slotInSentence.costCentre', 'cost centre'),
  };
  /** A refusal in plain words, in the person's language: a known sentence by its key; the ERP's own words as they came in
   *  English and as "the ERP refused this change" in any other language. */
  const refusalText = (raw: string) => {
    const match = matchCompanyDefaultsRefusal(raw);
    if (!match) {
      return (i18n.resolvedLanguage ?? i18n.language ?? 'en').startsWith('en')
        ? raw
        : t('administration:integrations.companyAccounts.refusal.erpRefused', 'The ERP refused this change.');
    }
    return t(`administration:integrations.companyAccounts.refusal.${match.key}`, {
      defaultValue: raw, name: match.name, slot: match.slot ? slotInSentence[match.slot] : undefined,
    });
  };
  const accountsPendingText = t('administration:integrations.companyAccounts.accountsPending', 'A change to the company accounts is still being saved. Reload in a few minutes to see it.');
  const saveAccounts = async () => {
    const changed = Object.fromEntries(ACCOUNT_SLOTS
      .filter(({ slot, key }) => accounts.values[slot] && accounts.values[slot] !== currentAccount(key))
      .map(({ slot }) => [slot, accounts.values[slot]]));
    if (Object.keys(changed).length === 0) { setEditing(null); return; }
    setBusy(true);
    setAccountsError(null);
    try {
      await repositories.integrations.setCompanyDefaults(changed);
      setEditing(null);
      await refresh();
    } catch (err) {
      setAccountsError(err instanceof AppError && PLAIN_REFUSALS.has(String(err.code)) && err.message
        ? { headline: t('administration:integrations.companyAccounts.accountsRefused', 'Could not set the company accounts.'), detail: refusalText(err.message) }
        : { headline: t('administration:integrations.companyAccounts.accountsFailed', 'Could not set the company accounts. Try again.') });
    } finally {
      setBusy(false);
    }
  };
  const refresh = async () => {
    await setup.refetch();
    void qc.invalidateQueries({
      queryKey: externalDomainOwnershipKey(orgId),
    });
    void qc.invalidateQueries({
      queryKey: ['integrations', 'bindings', orgId],
    });
    void qc.invalidateQueries({ queryKey: ['integrations', 'health', orgId] });
  };
  const openDefaults = () => {
    defaults.reset({
      activityType: setup.data?.defaults.default_activity_type ?? '',
      receivableAccount: setup.data?.defaults.default_receivable_account ?? '',
    });
    setError(null);
    setEditing('defaults');
  };
  const openDomains = () => {
    domain.reset({
      domain: ERP_DOMAINS.find((value) =>
        !setup.data?.domains.includes(value)
      ) ?? ERP_DOMAINS[0],
    });
    setError(null);
    setEditing('domain');
  };
  const save = async (event: React.FormEvent) => {
    event.preventDefault();
    setError(null);
    if (editing === 'accounts') { await saveAccounts(); return; }
    const form = editing === 'defaults' ? defaults : domain;
    await form.handleSubmit(async () => {
      setBusy(true);
      try {
        if (editing === 'defaults') {
          await repositories.integrations.saveErpDefaults({
            activityType: defaults.values.activityType.trim(),
            receivableAccount: defaults.values.receivableAccount.trim(),
          });
        } else {await repositories.integrations.employErpDomain(
            domain.values.domain,
          );}
        setEditing(null);
        await refresh();
      } catch {
        setError(
          editing === 'defaults'
            ? t(
              'integrations.erpSetup.defaultsFailed',
              'Could not save ERP defaults. Check the values and try again.',
            )
            : t(
              'integrations.erpSetup.domainFailed',
              'Could not employ this domain. Your operator will fix the integration role; then try again.',
            ),
        );
      } finally {
        setBusy(false);
      }
    });
  };

  const domainNames: Record<string, string> = {
    companies: t('integrations.erpSetup.domainNames.companies', 'Companies'),
    procurement: t('integrations.erpSetup.domainNames.procurement', 'Procurement'),
    revenue: t('integrations.erpSetup.domainNames.revenue', 'Revenue'),
    timesheets: t('integrations.erpSetup.domainNames.timesheets', 'Timesheets'),
    expenses: t('integrations.erpSetup.domainNames.expenses', 'Expenses'),
  };
  const domainText = (value: string) => domainNames[value] ?? domainLabel(value);
  const accountLinkNotes = useAccountLinkNotes();
  const incomplete = setup.data ? getErpSetupIncompleteness(setup.data) : null;
  const fiscalYearTask = setup.data ? fiscalYearOperatorTask(setup.data) : null;
  const hasOutstandingSetup = incomplete ? Object.values(incomplete).some(Boolean) : false;
  const actionLink =
    'text-sm font-medium text-foreground underline underline-offset-4 break-words';
  return (
    <section
      aria-labelledby='erp-setup-heading'
      className='mt-5 border-t border-border pt-4'
    >
      <h3
        id='erp-setup-heading'
        className='text-base font-semibold text-foreground'
      >
        {t('uxs08.reviewTitle', 'Business setup review')}
      </h3>
      <p className='mb-3 mt-1 max-w-[65ch] text-sm text-muted-foreground'>
        {t(
          'uxs08.reviewDescription',
          'Completed links stay in place; only items needing attention need a decision.',
        )}
      </p>
      <h4 className='mb-2 text-sm font-semibold text-foreground'>
        {t('uxs08.dataHeading', 'Keep business information up to date')}
      </h4>
      {setup.isPending && !setup.data
        ? <ListState variant='loading' rows={4} />
        : setup.isError && !setup.data
        ? (
          <div className='space-y-2'>
            {/* In-card error: the checklist lives inside the ERPNext card, so this renders as
             * plain text + retry (no bordered box — craft floor: nested cards are always
             * wrong, and any bordered container inside the card reads as one). */}
            <div role='status' className='text-sm'>
              <p className='font-medium text-foreground'>
                {t('integrations.erpSetup.unavailable', 'ERP setup unavailable')}
              </p>
              <p className='mt-1 text-muted-foreground'>
                {t('uxs07.setupUnavailableHelp', 'Readiness is unknown.')}
              </p>
              <Button variant='ghost' size='sm' className='mt-1 px-2' onClick={() => void setup.refetch()}>
                {t('ui.listState.retry', 'Retry')}
              </Button>
            </div>
            <Link className={actionLink} to='/administration/accounting#budget-account-map'>
              {t('uxs07.operatorHandoff', 'Open accounting setup')}
            </Link>
          </div>
        )
        : setup.data && (
          <>
            {setup.isError && (
              <div className='mb-3 rounded-md border border-border bg-muted/30 p-3 text-sm' role='status'>
                <p className='font-medium text-foreground'>{t('uxs07.lastKnownTitle', 'Showing the last saved setup check')}</p>
                <p className='mt-1 text-muted-foreground'>{t('uxs07.lastKnownBody', 'The current check failed; results may be out of date.')}</p>
                <div className='mt-2 flex flex-wrap items-center gap-3'>
                  <Button variant='outline' size='sm' onClick={() => void setup.refetch()}>
                    {t('uxs07.retryCheck', 'Check setup again')}
                  </Button>
                  <Link className={actionLink} to='/administration/accounting#budget-account-map'>
                    {t('uxs07.operatorHandoff', 'Open accounting setup')}
                  </Link>
                </div>
              </div>
            )}
            <ul className='divide-y divide-border text-sm'>
              <li id='erp-setup-domains' hidden={!incomplete?.domains} className='grid gap-2 py-3 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-center'>
                <div className='min-w-0'>
                  <p className='font-medium'>
                    {t('uxs08.domainsLabel', 'Information updated from ERPNext')}
                  </p>
                  <p className='mt-1 text-muted-foreground break-words'>
                    {setup.data.domains.length
                      ? setup.data.domains.map((value) =>
                        domainText(value)
                      ).join(', ')
                      : t('uxs07.noDomains', 'No connected information is currently updating from ERPNext')}
                  </p>
                </div>
                <Button variant='outline' size='sm' onClick={openDomains}>
                  {t('uxs08.domainsAction', 'Choose information to keep updated')}
                </Button>
              </li>
              <li id='erp-setup-company-defaults' hidden={!incomplete?.company} className='grid gap-2 py-3 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-center'>
                <div>
                  <p className='font-medium'>
                    {t(
                      'uxs08.companyLabel',
                      'Company settings',
                    )}
                  </p>
                  <p className='mt-1 text-muted-foreground tabular-nums'>
                    {t(
                      'integrations.erpSetup.configured',
                      '{{count}} of {{total}} configured',
                      {
                        count: COMPANY_DEFAULTS.filter((key) =>
                          setup.data?.defaults[key]
                        ).length,
                        total: COMPANY_DEFAULTS.length,
                      },
                    )}
                  </p>
                </div>
                <div className='grid gap-2 sm:flex sm:flex-wrap sm:justify-end'>
                  <Button variant='outline' size='sm' onClick={onRefreshCompany}>
                    {t(
                      'uxs08.companyAction',
                      'Review company settings',
                    )}
                  </Button>
                  {setup.data.defaults.company && (
                    <Button variant='ghost' size='sm' onClick={openAccounts}>
                      {t('administration:integrations.companyAccounts.accountsAction', 'Set company accounts')}
                    </Button>
                  )}
                </div>
              </li>
              <li id='erp-setup-activity-defaults' hidden={!incomplete?.activity} className='grid gap-2 py-3 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-center'>
                <div className='min-w-0'>
                  <p className='font-medium'>
                    {t(
                      'uxs08.activityLabel',
                      'Work and customer billing settings',
                    )}
                  </p>
                  <p className='mt-1 break-words text-muted-foreground'>
                    {setup.data.defaults.default_activity_type ??
                      t(
                        'integrations.erpSetup.activityMissing',
                        'Activity type not set',
                      )} · {setup.data.defaults.default_receivable_account ??
                      t(
                        'integrations.erpSetup.receivableMissing',
                        'Receivable account not set',
                      )}
                  </p>
                </div>
                <Button variant='outline' size='sm' onClick={openDefaults}>
                  {t(
                    'uxs08.activityAction',
                    'Review work and billing settings',
                  )}
                </Button>
              </li>
              <li id='erp-setup-budget-map' hidden={!incomplete?.budget && accountLinkNotes.length === 0} className='grid gap-2 py-3 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-center'>
                <div>
                  <p className='font-medium'>
                    {t('uxs08.budgetLabel', 'Budget account setup')}
                  </p>
                  <p className='mt-1 text-muted-foreground tabular-nums'>
                    {t(
                      'integrations.erpSetup.configured',
                      '{{count}} of {{total}} configured',
                      {
                        count: requiredBudgetCategories(setup.data).filter((category) => setup.data.budgetMappedCategories.includes(category)).length,
                        total: requiredBudgetCategories(setup.data).length,
                      },
                    )}
                  </p>
                  {((missing) => missing.length > 0 && <DirectCostAccounts categories={missing} />)(missingAccountCategories(setup.data))}
                  <AccountLinkNotes />
                </div>
                <Link
                  className={actionLink}
                  to='/administration/accounting#budget-account-map'
                >
                  {t('uxs08.budgetAction', 'Review budget account setup')}
                </Link>
              </li>
              <ErpSendStates enabled={Boolean(orgId)} />
              <li id='erp-setup-employee-links' hidden={!incomplete?.employees} className='grid gap-2 py-3 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-center'>
                <div>
                  <p className='font-medium'>
                    {t('uxs08.employeeLabel', 'Team members who record time')}
                  </p>
                  <p className='mt-1 text-muted-foreground tabular-nums'>
                    {setup.data.unlinkedEmployeeCount > 0
                      ? t('uxs08.employeeMissing', 'People who record time still needing an ERP employee link: {{count}}', { count: setup.data.unlinkedEmployeeCount })
                      : null}
                  </p>
                </div>
                <Link className={actionLink} to='/approvals'>
                  {t(
                    'integrations.erpSetup.reviewEmployees',
                    'Review employee links',
                  )}
                </Link>
              </li>
              {/* #1599 ECX-5: guidance for the last fiscal-year check. */}
              <li id='erp-setup-fiscal-year' hidden={!fiscalYearTask} className='py-3'>
                <p className='font-medium'>{t('administration:integrations.fiscalYear.label', 'Next fiscal year')}</p>
                <p className='mt-1 break-words text-muted-foreground'>
                  {fiscalYearTask?.kind === 'missing-role'
                    ? t('administration:integrations.fiscalYear.missingRole', 'Ask your Admin to grant the integration user Read and Create permissions on the Fiscal Year document type in ERPNext. PMO checks again on the next sync.')
                    : fiscalYearTask?.kind === 'no-current-year'
                    ? t('administration:integrations.fiscalYear.noCurrentYear', 'Ask your Admin to add or enable a Fiscal Year covering today in ERPNext and assign it to the linked company. PMO checks again on the next sync.')
                    : fiscalYearTask?.kind === 'disabled-year'
                    ? t('administration:integrations.fiscalYear.disabledYear', 'Ask your Admin to review the disabled Fiscal Year {{year}} in ERPNext and enable it only if it is the intended period. PMO checks again on the next sync.', { year: fiscalYearTask.year })
                    : fiscalYearTask?.kind === 'ambiguous-overlap'
                    ? t('administration:integrations.fiscalYear.ambiguousOverlap', 'Ask your Admin to correct Fiscal Year date ranges and company assignments in ERPNext so one enabled year applies. PMO checks again on the next sync.')
                    : fiscalYearTask?.kind === 'review-settings'
                    ? t('administration:integrations.fiscalYear.reviewSettings', 'Ask your Admin to review Fiscal Year settings in ERPNext for the linked company. PMO checks again on the next sync.')
                    : fiscalYearTask?.kind === 'held'
                    ? t('administration:integrations.fiscalYear.held', 'Operator attention is needed because PMO could not confirm the next fiscal year.')
                    : fiscalYearTask?.kind === 'refused'
                    ? t('administration:integrations.fiscalYear.refusedNoReason', 'Operator attention is needed because PMO could not create the next fiscal year.')
                    : null}
                </p>
              </li>
              <li id='erp-setup-project-links' hidden={!incomplete?.projects} className='py-3'>
                <p className='font-medium'>
                  {t('uxs08.projectLabel', 'Project connections')}
                </p>
                {setup.data.unmappedProjects.length > 0 && (
                  <div className='mt-2'>
                    <ProjectMatchReview
                      orgId={orgId}
                      projects={setup.data.unmappedProjects}
                    />
                  </div>
                )}
              </li>
            </ul>
            {!hasOutstandingSetup && (
              <p className='py-3 text-sm text-muted-foreground' role='status'>
                {t('uxs08.setupComplete', 'Setup is complete.')}
              </p>
            )}
            <div className='mt-3 flex flex-wrap items-center gap-3'>
              <Button
                variant='outline'
                size='sm'
                onClick={() => setMatchReviewOpen(true)}
              >
                {t('administration:integrations.connect.matchRecords', 'Match records')}
              </Button>
              <Link className={actionLink} to='/companies'>
                {t('integrations.erpSetup.reviewParties', 'Review companies')}
              </Link>
              <Button
                variant='ghost'
                size='sm'
                loading={setup.isFetching}
                onClick={() =>
                  void setup.refetch()}
              >
                {t('integrations.erpSetup.refresh', 'Refresh checklist')}
              </Button>
            </div>
          </>
        )}
      {editing && (
        <EntityFormModal
          open
          title={editing === 'defaults'
            ? t('uxs08.defaultsDialog', 'Work and billing settings')
            : editing === 'accounts'
            ? t('administration:integrations.companyAccounts.accountsDialog', 'Company accounts')
            : t('uxs08.domainDialog', 'Information to keep updated')}
          submitLabel={editing === 'defaults'
            ? t('integrations.erpSetup.saveDefaults', 'Save defaults')
            : editing === 'accounts'
            ? t('administration:integrations.companyAccounts.accountsSubmit', 'Save company accounts')
            : t('uxs08.domainSubmit', 'Save information choices')}
          onSubmit={save}
          onClose={() => setEditing(null)}
          loading={busy}
          dirty={editing === 'defaults' ? defaults.isDirty : editing === 'accounts' ? accounts.isDirty : domain.isDirty}
          submitDisabled={editing === 'defaults'
            ? !defaults.isComplete
            : editing === 'accounts'
            ? !accountOptions.data || accountOptions.data.pending
            : !domain.isComplete}
          disabledReason={editing === 'accounts' && accountOptions.data?.pending ? accountsPendingText : undefined}
          submitError={editing === 'accounts' ? accountsError : error ? { headline: error } : null}
        >
          {editing === 'accounts'
            ? accountOptions.isPending || (accountOptions.isError && accountOptions.isFetching)
              ? <ListState variant='loading' rows={3} />
              : accountOptions.isError
              ? (
                <div className='flex flex-col items-start gap-3'>
                  <p role='status' className='text-sm text-muted-foreground'>
                    {t('administration:integrations.companyAccounts.accountsUnavailable', 'Could not read the account lists.')}
                  </p>
                  <Button variant='outline' size='sm' onClick={() => { void accountOptions.refetch(); }}>
                    {t('administration:integrations.companyAccounts.accountsRetry', 'Try again')}
                  </Button>
                </div>
              )
              : (
                <FormGrid>
                  {accountOptions.data?.pending && (
                    <p role='status' className='text-sm text-muted-foreground sm:col-span-2'>{accountsPendingText}</p>
                  )}
                  {ACCOUNT_SLOTS.map(({ slot }) => {
                    const listed = accountOptions.data?.options[slot] ?? [];
                    const current = accounts.values[slot];
                    const values = current && !listed.includes(current) ? [current, ...listed] : listed;
                    return (
                      <SelectField
                        key={slot}
                        {...accounts.fieldProps(slot)}
                        label={slotLabels[slot]}
                        placeholder={t('administration:integrations.companyAccounts.accountsChoose', 'Choose…')}
                        options={values.map((value) => ({ value, label: value }))}
                        title={current || undefined}
                        helper={slot === 'bank' && values.length === 0
                          ? t('administration:integrations.companyAccounts.noBankAccount', 'The company has no bank account yet, so there is none to choose. Create the bank account first; it is then listed here.')
                          : undefined}
                        fullWidth
                      />
                    );
                  })}
                </FormGrid>
              )
            : editing === 'defaults'
            ? (
              <FormGrid>
                <TextField
                  {...defaults.fieldProps('activityType')}
                  label={t('uxs08.activityField', 'Work category')}
                  required
                  fullWidth
                  helper={t('uxs08.activityHelp', 'Choose the enabled work category used when time is recorded.')}
                />
                <TextField
                  {...defaults.fieldProps('receivableAccount')}
                  label={t('uxs08.receivableField', 'Customer billing account')}
                  required
                  fullWidth
                  helper={t('uxs08.receivableHelp', 'Choose the account used to record customer invoices for this company.')}
                />
              </FormGrid>
            )
            : (
              <>
                <p className='mb-3 text-sm text-muted-foreground'>
                  {t(
                    'uxs08.domainHelp',
                    'The connected service will maintain this type of business information. Review existing records and access before continuing.',
                  )}
                </p>
                <SelectField
                  {...domain.fieldProps('domain')}
                  label={t('uxs08.domainField', 'Business information')}
                  options={ERP_DOMAINS.map((value) => ({
                    value,
                    label: domainText(value),
                  }))}
                  required
                />
              </>
            )}
        </EntityFormModal>
      )}
      {matchReviewOpen && (
        <div className='mt-6'>
          <ConnectProposalReview
            tier='erpnext'
            orgId={orgId}
            open={matchReviewOpen}
            onClose={() => setMatchReviewOpen(false)}
          />
        </div>
      )}
    </section>
  );
}
