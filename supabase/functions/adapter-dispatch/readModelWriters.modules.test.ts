import { assertEquals } from '@std/assert';
import { READ_MODEL_WRITERS } from './readModelWriters.ts';
import { budgetWriter } from './readModel/budget.ts';
import { companiesWriter } from './readModel/companies.ts';
import { expensesWriter } from './readModel/expenses.ts';
import { procurementWriter } from './readModel/procurement.ts';
import { referenceWriter } from './readModel/reference.ts';
import { revenueWriter } from './readModel/revenue.ts';
import { tasksWriter } from './readModel/tasks.ts';
import { timesheetsWriter } from './readModel/timesheets.ts';

Deno.test('read-model registry is composed from the domain writer modules', () => {
  assertEquals(READ_MODEL_WRITERS, {
    reference: referenceWriter,
    tasks: tasksWriter,
    companies: companiesWriter,
    procurement: procurementWriter,
    revenue: revenueWriter,
    budget: budgetWriter,
    timesheets: timesheetsWriter,
    expenses: expensesWriter,
  });
});
