import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { repositories } from '@/src/lib/repositories';
import { Constants } from '@/src/lib/supabase/database.types';
import {
  Button,
  ConfirmDialog,
  EntityFormModal,
  FormGrid,
  ListState,
  SelectField,
  TextField,
} from '@/src/components/ui';
import { useEntityForm } from '@/src/components/ui/useEntityForm';
import { domainLabel } from './integrationLabels';
import { EXPENSES_EMPLOYABLE } from '@/src/lib/adapterSeam/erpnext/expenseEnablement';

// #775 phase B — `expenses` is offered only once its release guard (#901) is open (FR-EXP-118, DD-EXP-22).
const ERP_DOMAINS = ['companies', 'procurement', 'revenue', 'timesheets', ...(EXPENSES_EMPLOYABLE ? ['expenses'] : [])];
const COMPANY_DEFAULTS = [
  'company',
  'default_payable_account',
  'default_expense_account',
  'default_cash_account',
  'default_bank_account',
  'cost_center',
];

export function ErpSetupChecklist(
  { orgId, onRefreshCompany }: {
    orgId: string | undefined;
    onRefreshCompany: () => void;
  },
) {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const setup = useQuery({
    queryKey: ['integrations', 'setup', orgId],
    queryFn: () => repositories.integrations.getErpSetup(),
    enabled: Boolean(orgId),
    retry: false,
  });
  const [editing, setEditing] = useState<'defaults' | 'domain' | null>(null);
  const [onboarding, setOnboarding] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [onboardError, setOnboardError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
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
  const refresh = async () => {
    await setup.refetch();
    void qc.invalidateQueries({
      queryKey: ['external-domain-ownership', orgId],
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
              'Could not employ this domain. Check ERP read permissions and try again.',
            ),
        );
      } finally {
        setBusy(false);
      }
    });
  };
  const onboard = async () => {
    setBusy(true);
    setOnboardError(null);
    try {
      await repositories.integrations.onboardErpParties();
      setOnboarding(false);
      setNotice(
        t(
          'integrations.erpSetup.onboarded',
          'ERP parties are onboarded. Review the Companies list.',
        ),
      );
      await refresh();
    } catch {
      setOnboardError(
        t(
          'integrations.erpSetup.onboardFailed',
          'Party onboarding did not complete. Try again.',
        ),
      );
    } finally {
      setBusy(false);
    }
  };
  const domainNames: Record<string, string> = {
    companies: t('integrations.erpSetup.domainNames.companies', 'Companies'),
    procurement: t('integrations.erpSetup.domainNames.procurement', 'Procurement'),
    revenue: t('integrations.erpSetup.domainNames.revenue', 'Revenue'),
    timesheets: t('integrations.erpSetup.domainNames.timesheets', 'Timesheets'),
    expenses: t('integrations.erpSetup.domainNames.expenses', 'Expenses'),
  };
  const domainText = (value: string) => domainNames[value] ?? domainLabel(value);
  const incomplete = {
    domains: setup.data?.domains.length === 0,
    company: COMPANY_DEFAULTS.some((key) => !setup.data?.defaults[key]),
    activity: !setup.data?.defaults.default_activity_type || !setup.data?.defaults.default_receivable_account,
    budget: (setup.data?.budgetMappedCategories.length ?? 0) < Constants.public.Enums.budget_category.length,
    employees: (setup.data?.unlinkedEmployeeCount ?? 0) > 0,
    projects: (setup.data?.unmappedProjects.length ?? 0) > 0,
  };
  const hasOutstandingSetup = Object.values(incomplete).some(Boolean);
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
          'Review how your organization keeps business information current. Completed links stay in place; only work needing attention needs a decision.',
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
            <ListState
              variant='error'
              title={t(
                'integrations.erpSetup.unavailable',
                'ERP setup unavailable',
              )}
              sub={t('uxs07.setupUnavailableHelp', 'Readiness is unknown. Retry, or ask your PMO administrator to review ERP setup.')}
              onRetry={() => void setup.refetch()}
            />
            <a className={actionLink} href='/administration/accounting#budget-account-map'>
              {t('uxs07.operatorHandoff', 'Open accounting setup')}
            </a>
          </div>
        )
        : setup.data && (
          <>
            {setup.isError && (
              <div className='mb-3 rounded-md border border-border bg-muted/30 p-3 text-sm' role='status'>
                <p className='font-medium text-foreground'>{t('uxs07.lastKnownTitle', 'Showing the last saved setup check')}</p>
                <p className='mt-1 text-muted-foreground'>{t('uxs07.lastKnownBody', 'The current check failed. These results may be out of date; retry or ask your PMO administrator to review setup.')}</p>
                <div className='mt-2 flex flex-wrap items-center gap-3'>
                  <Button variant='outline' size='sm' onClick={() => void setup.refetch()}>
                    {t('uxs07.retryCheck', 'Check setup again')}
                  </Button>
                  <a className={actionLink} href='/administration/accounting#budget-account-map'>
                    {t('uxs07.operatorHandoff', 'Open accounting setup')}
                  </a>
                </div>
              </div>
            )}
            <ul className='divide-y divide-border text-sm'>
              <li id='erp-setup-domains' hidden={!incomplete.domains} className='grid gap-2 py-3 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-center'>
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
              <li id='erp-setup-company-defaults' hidden={!incomplete.company} className='grid gap-2 py-3 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-center'>
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
                <Button variant='outline' size='sm' onClick={onRefreshCompany}>
                  {t(
                    'uxs08.companyAction',
                    'Review company settings',
                  )}
                </Button>
              </li>
              <li id='erp-setup-activity-defaults' hidden={!incomplete.activity} className='grid gap-2 py-3 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-center'>
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
              <li id='erp-setup-budget-map' hidden={!incomplete.budget} className='grid gap-2 py-3 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-center'>
                <div>
                  <p className='font-medium'>
                    {t('uxs08.budgetLabel', 'Budget account setup')}
                  </p>
                  <p className='mt-1 text-muted-foreground tabular-nums'>
                    {t(
                      'integrations.erpSetup.configured',
                      '{{count}} of {{total}} configured',
                      {
                        count: setup.data.budgetMappedCategories.length,
                        total: Constants.public.Enums.budget_category.length,
                      },
                    )}
                  </p>
                </div>
                <a
                  className={actionLink}
                  href='/administration/accounting#budget-account-map'
                >
                  {t('uxs08.budgetAction', 'Review budget account setup')}
                </a>
              </li>
              <li id='erp-setup-employee-links' hidden={!incomplete.employees} className='grid gap-2 py-3 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-center'>
                <div>
                  <p className='font-medium'>
                    {t('uxs08.employeeLabel', 'Team members who record time')}
                  </p>
                  <p className='mt-1 text-muted-foreground tabular-nums'>
                    {setup.data.unlinkedEmployeeCount > 0
                      ? t('uxs08.employeeMissing', 'People who record time still needing an ERP employee link: {{count}}', { count: setup.data.unlinkedEmployeeCount })
                      : t('uxs08.employeeComplete', 'Everyone who records time has an ERP employee link')}
                  </p>
                </div>
                <a className={actionLink} href='/approvals'>
                  {t(
                    'integrations.erpSetup.reviewEmployees',
                    'Review employee links',
                  )}
                </a>
              </li>
              <li id='erp-setup-project-links' hidden={!incomplete.projects} className='py-3'>
                <p className='font-medium'>
                  {t('uxs08.projectLabel', 'Project connections')}
                </p>
                {setup.data.unmappedProjects.length
                  ? (
                    <ul className='mt-2 space-y-2'>
                      {setup.data.unmappedProjects.map((project) => (
                        <li key={project.id}>
                          <a
                            className={actionLink}
                            href={`/projects/${project.id}`}
                          >
                            {t(
                              'uxs08.projectAction',
                              'Review proposed link for {{name}}',
                              { name: project.name },
                            )}
                          </a>
                        </li>
                      ))}
                    </ul>
                  )
                  : (
                    <p className='mt-1 text-muted-foreground'>
                      {t(
                        'uxs08.projectComplete',
                        'All active projects have a confirmed connection',
                      )}
                    </p>
                  )}
              </li>
            </ul>
            {!hasOutstandingSetup && (
              <p className='py-3 text-sm text-muted-foreground' role='status'>
                {t('uxs08.setupComplete', 'Setup is complete. Confirmed connections are retained; this review will return when something needs attention.')}
              </p>
            )}
            <div className='mt-3 flex flex-wrap items-center gap-3'>
              <Button
                variant='outline'
                size='sm'
                onClick={() => {
                  setOnboarding(true);
                  setOnboardError(null);
                }}
              >
                {t('uxs08.partiesAction', 'Review company connections')}
              </Button>
              <a className={actionLink} href='/companies'>
                {t('integrations.erpSetup.reviewParties', 'Review companies')}
              </a>
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
      {notice && (
        <p role='status' className='mt-3 text-sm text-muted-foreground'>
          {notice}
        </p>
      )}
      {editing && (
        <EntityFormModal
          open
          title={editing === 'defaults'
            ? t('uxs08.defaultsDialog', 'Work and billing settings')
            : t('uxs08.domainDialog', 'Information to keep updated')}
          submitLabel={editing === 'defaults'
            ? t('integrations.erpSetup.saveDefaults', 'Save defaults')
            : t('uxs08.domainSubmit', 'Save information choices')}
          onSubmit={save}
          onClose={() => setEditing(null)}
          loading={busy}
          dirty={editing === 'defaults' ? defaults.isDirty : domain.isDirty}
          submitDisabled={editing === 'defaults'
            ? !defaults.isComplete
            : !domain.isComplete}
          submitError={error ? { headline: error } : null}
        >
          {editing === 'defaults'
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
      <ConfirmDialog
        open={onboarding}
        title={t('uxs08.onboardDialog', 'Review company connections?')}
        description={onboardError ??
          t(
            'uxs08.onboardDescription',
            'Review company connections from the connected business system. Existing confirmed links are kept.',
          )}
        confirmLabel={t(
          'uxs08.onboardSubmit',
          'Review connections',
        )}
        loading={busy}
        onConfirm={() => void onboard()}
        onCancel={() => setOnboarding(false)}
      />
    </section>
  );
}
