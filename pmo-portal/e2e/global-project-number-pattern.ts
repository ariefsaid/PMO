import { createClient } from '@supabase/supabase-js';

/**
 * #1869 — the org-wide project-number pattern is a shared singleton that AC-CODE-002 temporarily
 * changes (to one containing {CLIENT}) and restores in a `finally`. A run killed mid-test never
 * reaches that `finally`, so the shared DB would keep the E2E pattern and every spec that creates a
 * project without a client segment would fail (project_number_client_segment_required).
 *
 * Used as Playwright globalSetup (self-heals a previous killed run before any test starts) and as
 * globalTeardown (restores after a normal or Ctrl-C'd run). The seed default is NULL
 * (the system pattern PRJ-{YY}-{SEQ4}), which no spec intends to leave changed.
 */
export default async function resetProjectNumberPattern(): Promise<void> {
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY ?? process.env.SERVICE_ROLE_KEY;
  const url = process.env.SUPABASE_URL ?? process.env.VITE_SUPABASE_URL;
  if (!key || !url) {
    if (process.env.CI) throw new Error('SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY missing in CI — cannot reset the project-number pattern');
    console.warn('[e2e] no service-role env: project-number pattern not reset (run via scripts/e2e-local.sh)');
    return;
  }
  const admin = createClient(url, key, { auth: { persistSession: false } });
  const { error } = await admin.from('organizations').update({ project_number_pattern: null }).not('project_number_pattern', 'is', null);
  if (error) throw new Error(`reset project_number_pattern failed: ${error.message}`);
}
