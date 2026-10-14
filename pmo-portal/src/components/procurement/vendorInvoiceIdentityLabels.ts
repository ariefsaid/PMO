import type { TFunction } from 'i18next';

export interface VendorInvoiceContext {
  state: 'ready' | 'pending' | 'unavailable';
  caseState?: 'ready' | 'pending' | 'unavailable';
  projectState?: 'ready' | 'pending' | 'unavailable';
  caseTitle?: string | null;
  projectName?: string | null;
  pmoProjectNumber?: string | null;
}

export interface VendorInvoiceIdentityFacts {
  referenceNumber?: string | null;
  viNumber?: string | null;
  invoiceDate?: string | null;
  context: VendorInvoiceContext;
}

interface IdentityCopy {
  reference: string;
  systemNumber: string;
  case: string;
  project: string;
  pmoNumber: string;
  billDate: string;
  referenceMissing: string;
  systemNumberMissing: string;
  contextPending: string;
  contextUnavailable: string;
  caseMissing: string;
  projectMissing: string;
  pmoNumberMissing: string;
  dateMissing: string;
}

function identityCopy(t: TFunction): IdentityCopy {
  return {
    reference: t('bupot.identity.vendorReference', 'Vendor invoice reference'),
    systemNumber: t('bupot.identity.systemNumber', 'System VI number'),
    case: t('bupot.identity.case', 'Case'),
    project: t('bupot.identity.project', 'Project'),
    pmoNumber: t('bupot.identity.pmoNumber', 'PMO project number'),
    billDate: t('bupot.identity.billDate', 'Bill date'),
    referenceMissing: t('bupot.identity.referenceMissing', 'Vendor invoice reference not recorded'),
    systemNumberMissing: t('bupot.identity.systemNumberMissing', 'System VI number unavailable'),
    contextPending: t('bupot.identity.contextPending', 'Details loading'),
    contextUnavailable: t('bupot.identity.contextUnavailable', 'Details unavailable'),
    caseMissing: t('bupot.identity.caseMissing', 'Case not recorded'),
    projectMissing: t('bupot.identity.projectMissing', 'Project not recorded'),
    pmoNumberMissing: t('bupot.identity.pmoNumberMissing', 'PMO project number unavailable'),
    dateMissing: t('bupot.identity.dateMissing', 'Bill date not recorded'),
  };
}

function valueLine(label: string, value: string | null | undefined, fallback: string): string {
  return value?.trim() ? `${label}: ${value}` : fallback;
}

export function vendorInvoiceIdentityLines(facts: VendorInvoiceIdentityFacts, t: TFunction): string[] {
  const copy = identityCopy(t);
  const { context } = facts;
  const caseState = context.caseState ?? context.state;
  const projectState = context.projectState ?? context.state;
  const lineFor = (state: VendorInvoiceContext['state'], label: string, value: string | null | undefined, missing: string) =>
    state === 'pending' ? `${label}: ${copy.contextPending}`
      : state === 'unavailable' ? `${label}: ${copy.contextUnavailable}`
        : valueLine(label, value, missing);
  return [
    valueLine(copy.reference, facts.referenceNumber, copy.referenceMissing),
    valueLine(copy.systemNumber, facts.viNumber, copy.systemNumberMissing),
    lineFor(caseState, copy.case, context.caseTitle, copy.caseMissing),
    lineFor(projectState, copy.project, context.projectName, copy.projectMissing),
    lineFor(projectState, copy.pmoNumber, context.pmoProjectNumber, copy.pmoNumberMissing),
    valueLine(copy.billDate, facts.invoiceDate, copy.dateMissing),
  ];
}

export function vendorInvoiceIdentityAccessibleLabel(facts: VendorInvoiceIdentityFacts & { t: TFunction }): string {
  const { t, ...identityFacts } = facts;
  return vendorInvoiceIdentityLines(identityFacts, t).join('. ');
}
