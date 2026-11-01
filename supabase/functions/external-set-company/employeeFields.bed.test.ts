/**
 * PQ-ECA-1 (ECA3-T1): which Employee fields does the ERPNext bed require? Gated on the dependency, never on CI:
 * ERPNEXT_BENCH_URL plus the bench key pair (ERPNEXT_BENCH_API_KEY / ERPNEXT_BENCH_API_SECRET), sourced from the
 * environment, never printed. The answer decides ERPNext's `employee.send` declaration: PMO holds no birth date or gender.
 *
 * Run: scripts/with-erpnext-lock.sh bash -c 'cd supabase/functions/external-set-company && deno test employeeFields.bed.test.ts --config deno.json --allow-env --allow-net --allow-read'
 */
import { assert } from '@std/assert';

const BENCH = Deno.env.get('ERPNEXT_BENCH_URL');
const KEY = Deno.env.get('ERPNEXT_BENCH_API_KEY') ?? '';
const SECRET = Deno.env.get('ERPNEXT_BENCH_API_SECRET') ?? '';

Deno.test({
  name: 'PQ-ECA-1 the Employee doctype requires gender and date of birth, which PMO does not hold',
  ignore: !BENCH || !KEY || !SECRET,
  fn: async () => {
    const res = await fetch(`${BENCH}/api/method/frappe.desk.form.load.getdoctype?doctype=Employee`, { headers: { Authorization: `token ${KEY}:${SECRET}` } });
    assert(res.ok, `bed answered ${res.status}`);
    const docs = (await res.json() as { docs: Array<{ name: string; fields: Array<{ fieldname: string; reqd?: number }> }> }).docs;
    const required = docs.find((d) => d.name === 'Employee')!.fields.filter((f) => f.reqd === 1).map((f) => f.fieldname).sort();
    console.log(`Employee required fields: ${required.join(', ')}`);
    for (const personal of ['gender', 'date_of_birth', 'date_of_joining']) assert(required.includes(personal), `${personal} is required`);
  },
});
