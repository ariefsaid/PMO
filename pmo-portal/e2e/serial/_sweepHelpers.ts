// @e2e-isolation: serial — drives the served erpnext-sweep, which ticks every activated org.
/**
 * #1317: the sweep's inbound and statement work runs about hourly, so a journey that ticks the sweep at
 * an arbitrary minute would get only the money passes. Journeys therefore post `{"mode":"full"}`
 * (accepted behind the same sweep secret) and require the body to prove the whole tick ran for their
 * org: never `skipped: true`, its `perOrg` entry present with `cadence: 'full'`, and no
 * `statement-lock-held` (an overlapping tick that did nothing for the org). A skipped tick fails here
 * instead of leaving intents `pending`.
 */
import { expect } from '@playwright/test';

const SWEEP_SECRET = process.env.ERPNEXT_SWEEP_SECRET ?? 'e2e-erpnext-sweep-secret';

interface SweepBody {
  ok?: boolean;
  skipped?: boolean;
  cadence?: string;
  perOrg?: Array<{ orgId: string; cadence?: string; errors: string[] }>;
}

/** Drive one REAL full `erpnext-sweep` tick and require that every pass ran for `orgId`. */
export async function runFullSweep(functionsUrl: string, orgId: string): Promise<{ status: number; body: unknown }> {
  const res = await fetch(`${functionsUrl}/functions/v1/erpnext-sweep`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${SWEEP_SECRET}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ mode: 'full' }),
  });
  const body = (await res.json()) as SweepBody;
  // A non-200 is left to the caller's own status assertion, which carries the journey's context.
  if (res.status === 200) {
    const detail = JSON.stringify(body).slice(0, 1000);
    expect(body.ok === true && body.skipped !== true, `the sweep skipped its passes: ${detail}`).toBe(true);
    const mine = body.perOrg?.find((o) => o.orgId === orgId);
    expect(mine, `the sweep did not tick org ${orgId}: ${detail}`).toBeTruthy();
    expect(mine?.errors ?? [], `an overlapping tick held org ${orgId}, so no pass ran: ${detail}`)
      .not.toContain('statement-lock-held');
    expect(mine?.cadence, `the sweep did not run the full tick it was asked for on org ${orgId}: ${detail}`).toBe('full');
  }
  return { status: res.status, body };
}
