import type { ProjectMoneyRead } from '@/src/lib/db/projectMoney';
import type { ProjectWithRefs } from '@/src/lib/db/projects';
import type { PackRow } from '@/src/lib/reports/managementPack';
import {
  deriveMargin,
  isActualComplete,
  moneyUnits,
  type Margin,
  type ProjectFinances,
  type ProjectReceiptCash,
} from '@/src/lib/projectFinances';
import type { CompanyCollectionsComposition } from './companyCollections';

export type PositionSourceState = 'not-requested' | 'loading' | 'known' | 'partial' | 'unavailable' | 'error';
export type PositionReadState = 'loading' | 'success' | 'error';

export interface ManagementPositionRow {
  projectId: string;
  projectName: string;
  projectNumber: string | null;
  actual: {
    state: PositionSourceState;
    amount: string | null;
    currency: string | null;
    asOf: string | null;
    basis: 'pmo' | 'erp' | 'unavailable';
    complete: boolean;
    categories: ReadonlyArray<{ category: string; mapped: boolean; amount: string | null }>;
    excludesRestrictedRows: boolean;
  };
}

export interface ManagementPositionDetail {
  projectId: string;
  cash: ProjectReceiptCash;
  billedWork: ReadonlyArray<Pick<ProjectFinances['invoices'][number], 'currency' | 'work_revenue' | 'missing_work'>>;
  margins: ReadonlyArray<{ currency: string; value: Margin }>;
  projectOutstanding: ReadonlyArray<Pick<ProjectFinances['invoices'][number],
    'currency' | 'outstanding' | 'missing_outstanding' | 'tax_basis'>>;
  customerId: string | null;
  collections: CompanyCollectionsComposition | null;
  limitation: 'project-mismatch' | 'actuals-changed' | null;
}

const mismatchedCash: ProjectReceiptCash = { state: 'unavailable', buckets: [], reason: 'invalid-reading' };

function isCurrency(value: string): boolean {
  return /^[A-Z]{3}$/.test(value);
}

function sourceState(readState: PositionReadState): 'loading' | 'error' | null {
  if (readState === 'loading') return 'loading';
  if (readState === 'error') return 'error';
  return null;
}

function projectActual(
  money: ProjectMoneyRead | undefined,
  readState: PositionReadState,
): ManagementPositionRow['actual'] {
  const stateOverride = sourceState(readState);
  if (stateOverride) {
    return {
      state: stateOverride,
      amount: null,
      currency: null,
      asOf: null,
      basis: 'unavailable',
      complete: false,
      categories: [],
      excludesRestrictedRows: false,
    };
  }

  if (!money) {
    return {
      state: 'unavailable',
      amount: null,
      currency: null,
      asOf: null,
      basis: 'unavailable',
      complete: false,
      categories: [],
      excludesRestrictedRows: false,
    };
  }

  const actuals = money.actuals;
  const amountIsValid = actuals.total !== null && moneyUnits(actuals.total) !== null;
  const currencyIsValid = isCurrency(actuals.currency);
  const basis = money.ledgerBasis;
  const restricted = actuals.excludesRestrictedRows;
  const complete = amountIsValid
    && currencyIsValid
    && actuals.complete === true
    && !restricted
    && isActualComplete({
      basis,
      readSucceeded: true,
      complete: actuals.complete,
      categories: actuals.categories,
      excludesRestrictedRows: restricted,
    });

  return {
    state: amountIsValid && currencyIsValid ? (complete ? 'known' : 'partial') : 'unavailable',
    amount: amountIsValid && currencyIsValid ? actuals.total : null,
    currency: currencyIsValid ? actuals.currency : null,
    asOf: actuals.asOf,
    basis,
    complete,
    categories: actuals.categories.map(({ category, mapped, amount }) => ({ category, mapped, amount })),
    excludesRestrictedRows: restricted,
  };
}

/** Projects one canonical S02 Actual reading per stable project identity, without deriving amounts. */
export function buildManagementPositionRows(
  rows: readonly PackRow[],
  moneyByProject: Readonly<Record<string, ProjectMoneyRead>>,
  readState: PositionReadState,
): ManagementPositionRow[] {
  const projects = new Map<string, PackRow>();
  for (const row of rows) {
    if (row.projectId && !projects.has(row.projectId)) projects.set(row.projectId, row);
  }

  return [...projects.values()].map((row) => ({
    projectId: row.projectId!,
    projectName: row.projectName ?? row.projectId!,
    projectNumber: row.projectNumber,
    actual: projectActual(moneyByProject[row.projectId!], readState),
  }));
}

/** Copies only incumbent source facts; this projection does not derive or aggregate amounts. */
export function buildManagementPositionDetail(
  row: ManagementPositionRow,
  finances: ProjectFinances,
  project: Pick<ProjectWithRefs, 'id' | 'client_id' | 'currency'>,
  collections: CompanyCollectionsComposition | null,
): ManagementPositionDetail {
  if (row.projectId !== project.id || project.id !== finances.project_id) {
    return {
      projectId: row.projectId,
      cash: mismatchedCash,
      billedWork: [],
      margins: [],
      projectOutstanding: [],
      customerId: null,
      collections: null,
      limitation: 'project-mismatch',
    };
  }

  const customerId = project.client_id?.trim() ? project.client_id : null;
  const actualsChanged = row.actual.basis === 'erp' && (
    row.actual.currency !== finances.actuals.currency
    || moneyUnits(row.actual.amount) !== moneyUnits(finances.actuals.total)
    || row.actual.asOf !== finances.actuals.as_of
    || row.actual.excludesRestrictedRows !== finances.actuals.excludes_restricted_rows
  );
  const canonicalActuals: ProjectFinances['actuals'] = {
    currency: row.actual.currency,
    as_of: row.actual.asOf,
    total: row.actual.amount,
    excludes_restricted_rows: row.actual.excludesRestrictedRows,
    categories: row.actual.categories.map(({ category, mapped, amount }) => ({ category, mapped, amount })),
  };
  const marginCoverage = {
    basis: row.actual.basis,
    readSucceeded: row.actual.state === 'known' || row.actual.state === 'partial',
    complete: row.actual.complete && !actualsChanged,
  } as const;

  return {
    projectId: row.projectId,
    cash: finances.cash_received ?? { state: 'unavailable', buckets: [], reason: 'not-reported' },
    billedWork: finances.invoices.map(({ currency, work_revenue, missing_work }) => ({
      currency,
      work_revenue,
      missing_work,
    })),
    margins: finances.invoices.map((bucket) => ({
      currency: bucket.currency,
      value: deriveMargin(bucket, canonicalActuals, marginCoverage),
    })),
    projectOutstanding: finances.invoices.map(({ currency, outstanding, missing_outstanding, tax_basis }) => ({
      currency,
      outstanding,
      missing_outstanding,
      tax_basis,
    })),
    customerId,
    collections: customerId ? collections : null,
    limitation: actualsChanged ? 'actuals-changed' : null,
  };
}
