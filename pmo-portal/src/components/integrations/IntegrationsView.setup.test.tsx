import { beforeEach, describe, expect, it, vi } from 'vitest';

import { fireEvent, screen, waitFor, within } from '@testing-library/react';

import type { ErpSetupReadiness, IntegrationsRepository } from '@/src/lib/repositories/types';

type Readiness = Awaited<ReturnType<IntegrationsRepository['getErpSetup']>>;

import { EXPENSES_EMPLOYABLE } from '@/src/lib/adapterSeam/erpnext/expenseEnablement';

import { Constants } from '@/src/lib/supabase/database.types';

const erpSetup = vi.hoisted(() => ({
  getErpSetup: vi.fn<IntegrationsRepository['getErpSetup']>(async () => ({
    defaults: { company: 'Example Company', default_receivable_account: null, default_activity_type: null },
    domains: [],
    unmappedProjects: [{ id: 'project-2', name: 'Example Delivery', code: 'SYNTH-2' }],
    budgetMappedCategories: [],
    unlinkedEmployeeCount: 2,
  })),
  saveErpDefaults: vi.fn(async () => ({ ok: true })),
  listErpProjects: vi.fn(async () => []),
  linkErpProject: vi.fn(async () => ({ ok: true, erpProject: 'PROJ-00042' })),
  ensureErpProject: vi.fn(async () => ({ ok: true, erpProject: 'PROJ-00042' })),
  getBinding: vi.fn(async () => ({
    status: 'active',
    site_url: 'https://erp.example.test',
    config: { company: 'Example Company', project_map: {} },
  })),
  employErpDomain: vi.fn(async () => ({ ok: true })),
  onboardErpParties: vi.fn(async () => ({ ok: true })),
}));
vi.mock('@/src/lib/repositories', () => ({ repositories: { integrations: erpSetup } }));
vi.mock('@/src/auth/useAuth', () => ({ useAuth: () => ({ currentUser: { org_id: 'org-1' } }) }));
vi.mock('@/src/hooks/useExternalDomainOwnership', () => ({ useExternalDomainOwnership: vi.fn() }));
vi.mock('@/src/hooks/useIntegrations', () => ({
  useIntegrations: vi.fn(),
  integrationHealthQueryKey: (orgId: string | undefined, tier: string) => ['integrations', 'health', orgId, tier],
}));
vi.mock('@/src/hooks/useProjects', () => ({ useProjects: vi.fn() }));
vi.mock('@/src/hooks/useTasks', () => ({ useAssignableProfiles: vi.fn() }));
vi.mock('@/src/lib/m365/connectClient', () => ({ initiateM365OrgApproval: vi.fn() }));

import { useExternalDomainOwnership } from '@/src/hooks/useExternalDomainOwnership';

import { useIntegrations } from '@/src/hooks/useIntegrations';

import { useProjects } from '@/src/hooks/useProjects';

import { baseExternalDomainReturn, bindingMapIntegrations, mockBinding, wrapWithRole, installIntegrationDefaults } from './IntegrationsView.test-helpers';

import { IntegrationsView } from './IntegrationsView';

installIntegrationDefaults();

describe('ERP setup checklist', () => {
  beforeEach(() => {
    const erpBinding = {...mockBinding, external_tier:'erpnext' as const, config:{company:'Example Company'}};
    vi.mocked(useExternalDomainOwnership).mockReturnValue(baseExternalDomainReturn as never);
    vi.mocked(useIntegrations).mockReturnValue(bindingMapIntegrations({bindings:[erpBinding],getBinding:(tier:string)=>tier==='erpnext'?erpBinding:undefined}) as never);
    vi.mocked(useProjects).mockReturnValue({data:[],isPending:false,isError:false} as never);
  });
  it('UX-009, UX-085, RF-048 and RF-049 present setup by business outcome and retain only open work', async () => {
    const erpBinding = {...mockBinding, external_tier:'erpnext' as const, config:{company:'Example Company'}};
    vi.mocked(useExternalDomainOwnership).mockReturnValue(baseExternalDomainReturn as never);
    vi.mocked(useIntegrations).mockReturnValue(bindingMapIntegrations({bindings:[erpBinding],getBinding:(tier:string)=>tier==='erpnext'?erpBinding:undefined}) as never);
    vi.mocked(useProjects).mockReturnValue({data:[],isPending:false,isError:false} as never);
    erpSetup.getErpSetup.mockResolvedValueOnce({
      defaults:{company:'Example Company',default_payable_account:null,default_expense_account:null,default_cash_account:null,default_bank_account:null,cost_center:null,default_activity_type:null,default_receivable_account:null},
      domains:['companies'],unmappedProjects:[],budgetMappedCategories:[],unlinkedEmployeeCount:0,
    } satisfies ErpSetupReadiness);
    wrapWithRole('Admin', <IntegrationsView />);
    expect(await screen.findByRole('heading', {name:'Business setup review'})).toBeInTheDocument();
    expect(screen.getByRole('heading', {name:'Keep business information up to date'})).toBeInTheDocument();
    expect(screen.queryByRole('link', {name:/Review proposed link for/})).not.toBeInTheDocument();
    expect(await screen.findByRole('button', {name:'Review company settings'})).toBeInTheDocument();
    expect(screen.queryByText(/active members need a confirmed ERP employee link/i)).not.toBeInTheDocument();
    expect(screen.queryByRole('button', {name:'Choose information to keep updated'})).not.toBeInTheDocument();
    expect(screen.queryByRole('button', {name:'Employ ERP domains'})).not.toBeInTheDocument();
    expect(screen.queryByText('Domains employed')).not.toBeInTheDocument();
  });

  it('UX-S08 hides employee and project rows and reports completion when all setup is complete', async () => {
    erpSetup.getErpSetup.mockResolvedValueOnce({
      defaults:{company:'Example Company',default_payable_account:'Creditors',default_expense_account:'Expenses',default_cash_account:'Cash',default_bank_account:'Bank',cost_center:'Main',default_activity_type:'Delivery',default_receivable_account:'Debtors'},
      domains:['companies'],unmappedProjects:[],budgetMappedCategories:[...Constants.public.Enums.budget_category],unlinkedEmployeeCount:0,
    });
    wrapWithRole('Admin', <IntegrationsView />);
    expect(await screen.findByText(/Setup is complete\. Confirmed connections are retained/)).toBeInTheDocument();
    expect(document.getElementById('erp-setup-employee-links')).toHaveAttribute('hidden');
    expect(document.getElementById('erp-setup-project-links')).toHaveAttribute('hidden');
  });

  it('UX-S08 shows only the unresolved employee or project row', async () => {
    erpSetup.getErpSetup.mockResolvedValueOnce({
      defaults:{company:'Example Company',default_payable_account:'Creditors',default_expense_account:'Expenses',default_cash_account:'Cash',default_bank_account:'Bank',cost_center:'Main',default_activity_type:'Delivery',default_receivable_account:'Debtors'},
      domains:['companies'],unmappedProjects:[],budgetMappedCategories:[...Constants.public.Enums.budget_category],unlinkedEmployeeCount:2,
    });
    wrapWithRole('Admin', <IntegrationsView />);
    expect(await screen.findByText(/People who record time still needing an ERP employee link: 2/)).toBeInTheDocument();
    expect(document.getElementById('erp-setup-employee-links')).not.toHaveAttribute('hidden');
    expect(document.getElementById('erp-setup-project-links')).toHaveAttribute('hidden');
  });

  it('AC-SETUP-002 exposes every outstanding setup step with a real fix action', async () => {
    const erpBinding = {...mockBinding, external_tier:'erpnext' as const, config:{company:'Example Company'}};
    vi.mocked(useExternalDomainOwnership).mockReturnValue(baseExternalDomainReturn as never);
    vi.mocked(useIntegrations).mockReturnValue(bindingMapIntegrations({bindings:[erpBinding],getBinding:(tier:string)=>tier==='erpnext'?erpBinding:undefined}) as never);
    vi.mocked(useProjects).mockReturnValue({data:[],isPending:false,isError:false} as never);
    wrapWithRole('Admin',<IntegrationsView/>);
    expect(await screen.findByRole('heading',{name:'Business setup review'})).toBeInTheDocument();
    expect(await screen.findByRole('button',{name:'Choose information to keep updated'})).toBeInTheDocument();
    expect(screen.getByRole('button',{name:'Review work and billing settings'})).toBeInTheDocument();
    expect(screen.getByRole('link',{name:'Review budget account setup'})).toHaveAttribute('href','/administration/accounting#budget-account-map');
    expect(screen.getByRole('link',{name:'Review employee links'})).toHaveAttribute('href','/approvals');
    expect(await screen.findByRole('heading',{name:'Review existing ERP project matches'})).toBeInTheDocument();
    expect(screen.queryByRole('link',{name:'Review proposed link for Example Delivery'})).not.toBeInTheDocument();
  });
  it('AC-SETUP-003 Admin saves defaults and a failed save keeps the entered values for retry', async () => {
    erpSetup.saveErpDefaults.mockRejectedValueOnce(new Error('private upstream detail'));
    wrapWithRole('Admin', <IntegrationsView />);
    fireEvent.click(await screen.findByRole('button', {name:'Review work and billing settings'}));
    fireEvent.change(screen.getByRole('textbox', {name:'Work category'}), {target:{value:'Execution'}});
    fireEvent.change(screen.getByRole('textbox', {name:'Customer billing account'}), {target:{value:'Debtors - EX'}});
    fireEvent.click(screen.getByRole('button',{name:'Save defaults'}));
    expect(await screen.findByText('Could not save ERP defaults. Check the values and try again.')).toBeInTheDocument();
    expect(screen.getByRole('textbox', {name:'Work category'})).toHaveValue('Execution');
    expect(screen.queryByText('private upstream detail')).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button',{name:'Save defaults'}));
    await waitFor(()=>expect(screen.queryByRole('dialog',{name:'Work and billing settings'})).not.toBeInTheDocument());
    expect(erpSetup.saveErpDefaults).toHaveBeenLastCalledWith({activityType:'Execution',receivableAccount:'Debtors - EX'});
  });
  it('read-only viewers have no ERP setup mutation controls', async () => {
    wrapWithRole('Engineer', <IntegrationsView />);
    expect(screen.queryByRole('button',{name:'Choose information to keep updated'})).not.toBeInTheDocument();
    expect(screen.queryByRole('button',{name:'Review work and billing settings'})).not.toBeInTheDocument();
  });
})

describe('ERP domain setup actions', () => {
  it('AC-TH-003 refreshing Company defaults updates the setup checklist after Company selection succeeds', async () => {
    const erpBinding={...mockBinding,external_tier:'erpnext' as const,config:{company:'Example Company'}};
    const setCompany={mutateAsync:vi.fn(async()=>undefined),isPending:false};
    vi.mocked(useExternalDomainOwnership).mockReturnValue(baseExternalDomainReturn as never);
    vi.mocked(useIntegrations).mockReturnValue(bindingMapIntegrations({getBinding:(tier:string)=>tier==='erpnext'?erpBinding:undefined,erpnextCompanies:[{name:'Example Company'}],setCompany}) as never);
    vi.mocked(useProjects).mockReturnValue({data:[],isPending:false,isError:false} as never);
    const readiness = {
      defaults: { company: 'Example Company' },
      domains: [],
      unmappedProjects: [],
      budgetMappedCategories: [],
      unlinkedEmployeeCount: 0,
    } satisfies Readiness;
    erpSetup.getErpSetup.mockResolvedValueOnce(readiness).mockResolvedValueOnce({
      ...readiness,
      defaults: {
        ...readiness.defaults,
        default_payable_account: 'Creditors',
        default_expense_account: 'Expenses',
        default_cash_account: 'Cash',
        default_bank_account: 'Bank',
        cost_center: 'Main',
      },
    } satisfies Readiness);
    wrapWithRole('Admin',<IntegrationsView/>);
    expect(await screen.findByText('1 of 6 configured')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button',{name:'Review company settings'}));
    fireEvent.click(screen.getByRole('combobox',{name:'Company'}));
    fireEvent.click(await screen.findByRole('option',{name:'Example Company'}));
    fireEvent.click(screen.getByRole('button',{name:'Activate'}));
    expect(await screen.findByText('6 of 6 configured')).toBeInTheDocument();
    expect(setCompany.mutateAsync).toHaveBeenCalledWith('Example Company');
  });
  it('keeps a failed domain assignment and party onboarding open for a safe retry', async () => {
    const erpBinding={...mockBinding,external_tier:'erpnext' as const,config:{company:'Example Company'}};
    vi.mocked(useExternalDomainOwnership).mockReturnValue(baseExternalDomainReturn as never);
    vi.mocked(useIntegrations).mockReturnValue(bindingMapIntegrations({getBinding:(tier:string)=>tier==='erpnext'?erpBinding:undefined}) as never);
    vi.mocked(useProjects).mockReturnValue({data:[],isPending:false,isError:false} as never);
    erpSetup.employErpDomain.mockRejectedValueOnce(new Error('private domain detail'));
    erpSetup.onboardErpParties.mockRejectedValueOnce(new Error('private onboarding detail'));
    wrapWithRole('Admin',<IntegrationsView/>);
    fireEvent.click(await screen.findByRole('button',{name:'Choose information to keep updated'}));
    fireEvent.change(screen.getByRole('combobox',{name:'Business information'}),{target:{value:'timesheets'}});
    fireEvent.click(screen.getByRole('button',{name:'Save information choices'}));
    expect(await screen.findByText('Could not employ this domain. Check ERP read permissions and try again.')).toBeInTheDocument();
    expect(screen.getByRole('combobox',{name:'Business information'})).toHaveValue('timesheets');
    fireEvent.click(screen.getByRole('button',{name:'Save information choices'}));
    await waitFor(()=>expect(screen.queryByRole('dialog',{name:'Information to keep updated'})).not.toBeInTheDocument());
    fireEvent.click(screen.getByRole('button',{name:'Review company connections'}));
    fireEvent.click(screen.getByRole('button',{name:'Review connections'}));
    expect(await screen.findByText('Party onboarding did not complete. Try again.')).toBeInTheDocument();
    expect(screen.queryByText(/private .* detail/)).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button',{name:'Review connections'}));
    expect(await screen.findByText('ERP parties are onboarded. Review the Companies list.')).toBeInTheDocument();
    expect(erpSetup.employErpDomain).toHaveBeenCalledTimes(2);
    expect(erpSetup.onboardErpParties).toHaveBeenCalledTimes(2);
  });
  it('shows an unavailable checklist and retries its authenticated read', async () => {
    const erpBinding={...mockBinding,external_tier:'erpnext' as const,config:{company:'Example Company'}};
    vi.mocked(useExternalDomainOwnership).mockReturnValue(baseExternalDomainReturn as never);
    vi.mocked(useIntegrations).mockReturnValue(bindingMapIntegrations({getBinding:(tier:string)=>tier==='erpnext'?erpBinding:undefined}) as never);
    vi.mocked(useProjects).mockReturnValue({data:[],isPending:false,isError:false} as never);
    erpSetup.getErpSetup.mockRejectedValueOnce(new Error('private checklist detail'));
    wrapWithRole('Admin',<IntegrationsView/>);
    const unavailable=await screen.findByText('ERP setup unavailable');
    expect(within(unavailable.closest('section')!).getByRole('link',{name:'Open accounting setup'})).toHaveAttribute('href','/administration/accounting#budget-account-map');
    fireEvent.click(within(unavailable.closest('section')!).getByRole('button',{name:'Retry'}));
    expect(await screen.findByRole('button',{name:'Choose information to keep updated'})).toBeInTheDocument();
    expect(erpSetup.getErpSetup).toHaveBeenCalledTimes(2);
  });
  it('UX-067 leads with incomplete ERP setup and links to its first missing step', async () => {
    const erpBinding={...mockBinding,external_tier:'erpnext' as const,config:{company:'Example Company'}};
    vi.mocked(useExternalDomainOwnership).mockReturnValue(baseExternalDomainReturn as never);
    vi.mocked(useIntegrations).mockReturnValue(bindingMapIntegrations({getBinding:(tier:string)=>tier==='erpnext'?erpBinding:undefined}) as never);
    vi.mocked(useProjects).mockReturnValue({data:[],isPending:false,isError:false} as never);
    erpSetup.getErpSetup.mockResolvedValueOnce({
      defaults:{company:'Example Company',default_payable_account:null,default_expense_account:null,default_cash_account:null,default_bank_account:null,cost_center:null,default_activity_type:null,default_receivable_account:null},
      domains:['companies'],unmappedProjects:[],budgetMappedCategories:[],unlinkedEmployeeCount:0,
    } satisfies ErpSetupReadiness);
    wrapWithRole('Admin',<IntegrationsView/>);
    const card=within(screen.getByTestId('integrations-connect-cards').querySelector('[data-tier="erpnext"]')!);
    const readiness=await card.findByText(/Not ready yet/i);
    expect(readiness).toBeInTheDocument();
    expect(card.getByText('Connected',{exact:true})).toHaveClass('text-muted-foreground');
    const finish=card.getByRole('link',{name:/Finish setup/i});
    expect(finish.getAttribute('href')).toBe('#erp-setup-company-defaults');
  });

  it('AC-UX-072 preserves the last known readiness and offers an operator handoff after a refresh failure', async () => {
    erpSetup.getErpSetup.mockResolvedValueOnce({
      defaults: { company: 'Example Company', default_receivable_account: null, default_activity_type: null },
      domains: ['companies'], unmappedProjects: [], budgetMappedCategories: [], unlinkedEmployeeCount: 0,
    } satisfies ErpSetupReadiness).mockRejectedValueOnce(new Error('temporary failure'));
    wrapWithRole('Admin', <IntegrationsView />);
    expect(await screen.findByText('Companies')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Refresh checklist' }));
    expect(await screen.findByText('Showing the last saved setup check')).toBeInTheDocument();
    expect(screen.getByText('Companies')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Open accounting setup' })).toHaveAttribute('href', '/administration/accounting#budget-account-map');
    expect(screen.getByRole('button', { name: 'Check setup again' })).toBeInTheDocument();
  });
  it('AC-EXP-128 the expenses domain is offered exactly when its release guard (#901) is open', async () => {
    const erpBinding={...mockBinding,external_tier:'erpnext' as const,config:{company:'Example Company'}};
    vi.mocked(useExternalDomainOwnership).mockReturnValue(baseExternalDomainReturn as never);
    vi.mocked(useIntegrations).mockReturnValue(bindingMapIntegrations({getBinding:(tier:string)=>tier==='erpnext'?erpBinding:undefined}) as never);
    vi.mocked(useProjects).mockReturnValue({data:[],isPending:false,isError:false} as never);
    wrapWithRole('Admin',<IntegrationsView/>);
    fireEvent.click(await screen.findByRole('button',{name:'Choose information to keep updated'}));
    const select=screen.getByRole('combobox', {name:'Business information'});
    const offered=within(select).queryByRole('option',{name:'Expenses'});
    if (!EXPENSES_EMPLOYABLE) {
      expect(offered).toBeNull();
      return;
    }
    expect(offered).not.toBeNull();
    fireEvent.change(select,{target:{value:'expenses'}});
    fireEvent.click(screen.getByRole('button',{name:'Save information choices'}));
    await waitFor(()=>expect(erpSetup.employErpDomain).toHaveBeenCalledWith('expenses'));
  });
  it('Admin confirms a domain assignment and can run the existing party onboarding action', async () => {
    const erpBinding={...mockBinding,external_tier:'erpnext' as const,config:{company:'Example Company'}};
    vi.mocked(useExternalDomainOwnership).mockReturnValue(baseExternalDomainReturn as never);
    vi.mocked(useIntegrations).mockReturnValue(bindingMapIntegrations({getBinding:(tier:string)=>tier==='erpnext'?erpBinding:undefined}) as never);
    vi.mocked(useProjects).mockReturnValue({data:[],isPending:false,isError:false} as never);
    wrapWithRole('Admin',<IntegrationsView/>);
    fireEvent.click(await screen.findByRole('button',{name:'Choose information to keep updated'}));
    fireEvent.change(screen.getByRole('combobox', {name:'Business information'}),{target:{value:'timesheets'}});
    fireEvent.click(screen.getByRole('button',{name:'Save information choices'}));
    await waitFor(()=>expect(erpSetup.employErpDomain).toHaveBeenCalledWith('timesheets'));
    await waitFor(()=>expect(screen.queryByRole('dialog', {name:'Information to keep updated'})).not.toBeInTheDocument());
    fireEvent.click(screen.getByRole('button',{name:'Review company connections'}));
    fireEvent.click(screen.getByRole('button',{name:'Review connections'}));
    await waitFor(()=>expect(erpSetup.onboardErpParties).toHaveBeenCalled());
  });
})
