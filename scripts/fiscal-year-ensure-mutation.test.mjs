#!/usr/bin/env node
import { runProof } from './stock-mutation-proof.mjs';

if (process.env.PMO_DB_LOCK_HELD !== '1') {
  console.error('Run under scripts/with-db-lock.sh.');
  process.exit(1);
}

const test = 'supabase/tests/erp_fiscal_year_ensure.test.sql';

export const CASES = [
  {
    id: 'generation_predicate',
    fn: 'public.begin_fiscal_year_post(uuid,uuid,uuid,bigint)',
    from: /v_outbox\.claim_generation <> p_generation/,
    to: 'false',
    test,
  },
  {
    id: 'post_started_at_null',
    fn: 'public.begin_fiscal_year_post(uuid,uuid,uuid,bigint)',
    from: /v_intent\.post_started_at is not null/,
    to: 'false',
    test,
  },
  {
    id: 'org_binding_company',
    fn: 'public.prepare_fiscal_year_intent(uuid,uuid,text,text,timestamptz,date,date,text)',
    from: /coalesce\(v_binding\.config->>'company', ''\) <> p_company/,
    to: 'false',
    test,
  },
  {
    id: 'unique_identity',
    fn: 'public.prepare_fiscal_year_intent(uuid,uuid,text,text,timestamptz,date,date,text)',
    from: /on conflict \(org_id, binding_id, company, start_date, end_date\) do nothing;/,
    to: ';',
    test,
  },
];

if (import.meta.url === `file://${process.argv[1]}`) {
  const r = runProof(process.argv.slice(2), CASES);
  console.table(r);
  const ok = r.every((x) => x.red && x.green);
  if (!ok) {
    console.error('Some mutation tests failed to prove red or restore green.');
    process.exit(1);
  }
}
