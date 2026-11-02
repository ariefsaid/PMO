/**
 * Multi-domain read-model writer registry. Domain implementations live beside this file in
 * `readModel/`; this module keeps the existing registry and compatibility exports for callers.
 * Relative imports only so this stays Deno-importable.
 */
import { AppError } from '../../../pmo-portal/src/lib/appError.ts';
import { budgetWriter } from './readModel/budget.ts';
import { companiesWriter } from './readModel/companies.ts';
import { expensesWriter } from './readModel/expenses.ts';
import { procurementWriter } from './readModel/procurement.ts';
import { referenceWriter } from './readModel/reference.ts';
import { revenueWriter } from './readModel/revenue.ts';
import { tasksWriter } from './readModel/tasks.ts';
import { timesheetsWriter } from './readModel/timesheets.ts';
import type { ReadModelWriter } from './readModel/types.ts';

export type {
  ReadModelEqChain,
  ReadModelServiceClient,
  ReadModelWriter,
  ReadModelWriterCtx,
} from './readModel/types.ts';
export { heldIdentityFor, markTimesheetPushOutcome } from './readModel/timesheets.ts';
export { upsertProcurementItemMirror } from './readModel/procurement.ts';

export const READ_MODEL_WRITERS: Record<string, ReadModelWriter> = {
  reference: referenceWriter,
  tasks: tasksWriter,
  companies: companiesWriter,
  procurement: procurementWriter,
  revenue: revenueWriter,
  budget: budgetWriter,
  timesheets: timesheetsWriter,
  expenses: expensesWriter,
};

/** The single lookup point — an unknown domain throws (no silent skip). */
export function getReadModelWriter(domain: string): ReadModelWriter {
  const writer = READ_MODEL_WRITERS[domain];
  if (!writer) throw new AppError(`no read-model writer registered for domain "${domain}"`, 'UNSUPPORTED_DOMAIN');
  return writer;
}
