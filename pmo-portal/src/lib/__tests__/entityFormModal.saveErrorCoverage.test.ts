/**
 * AC-ERR-001 coverage guard (#559).
 *
 * ⛔ WHY A STRUCTURAL TEST AND NOT ONLY BEHAVIOURAL ONES. The persistent save-error region lives
 * in the SHARED `EntityFormModal`, so it renders for every consumer whether or not that consumer
 * ever passes `submitError`. That is precisely how 16 forms sat unwired for months while looking
 * fine: nothing could tell "wired" from "not wired" by reading a dialog. A behavioural test proves
 * the MECHANISM works (see AdministrationCredits.saveError.test.tsx, which rejects a real mutation
 * and outlives the toast); this proves the mechanism is CONNECTED everywhere, which is the part
 * that silently rotted.
 *
 * ⚑ Modelled on the repo's existing enforcement style (`check-e2e-skips.mjs`): every exception is
 * an allowlist entry with a stated reason, and a STALE entry fails too — so a file that later
 * gains `submitError`, or stops rendering the modal, cannot leave a lie behind in this list.
 */
import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');

/**
 * Consumers that render `EntityFormModal` but deliberately do NOT pass `submitError`.
 * A reason is mandatory — "not done yet" is not one.
 */
const EXEMPT: Record<string, string> = {
  'src/components/projects/ProjectIntegrationsCard.tsx':
    'Already surfaces a rejected save persistently in the dialog via errorSummary + FieldError, anchored to the field it concerns. Adding submitError would render the same failure twice.',
  'src/components/integrations/IntegrationsView.tsx':
    'Same as ProjectIntegrationsCard — connectError/setCompanyError already drive a persistent in-dialog errorSummary.',
  'src/components/NewRevisionModal.tsx':
    'Presentational — the parent owns both the mutation and its rejection, and passes the outcome down.',
  'src/components/builder/PanelEditorForm.tsx':
    'Local editor state only; saving is the parent panel builder’s concern and does not reject here.',
};

function walk(dir: string, out: string[] = []): string[] {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    if (e.name === 'node_modules' || e.name === 'dist') continue;
    const full = path.join(dir, e.name);
    if (e.isDirectory()) walk(full, out);
    else if (e.name.endsWith('.tsx') && !e.name.includes('.test.')) out.push(full);
  }
  return out;
}

const consumers = walk(path.join(ROOT, 'pages'))
  .concat(walk(path.join(ROOT, 'src')))
  .map((f) => ({ rel: path.relative(ROOT, f), src: fs.readFileSync(f, 'utf8') }))
  .filter(({ rel, src }) => rel !== 'src/components/ui/EntityFormModal.tsx' && /<EntityFormModal/.test(src));

describe('AC-ERR-001: every EntityFormModal consumer surfaces a rejected save', () => {
  it('found the consumers at all — a walk that silently matches nothing would pass every case below', () => {
    expect(consumers.length).toBeGreaterThan(10);
  });

  it.each(consumers.map((c) => c.rel))('%s passes submitError, or is exempt with a reason', (rel) => {
    const { src } = consumers.find((c) => c.rel === rel)!;
    if (/submitError/.test(src)) return;
    expect(
      EXEMPT[rel],
      `${rel} renders EntityFormModal, never passes submitError, and has no exemption reason. ` +
        'A rejected save there leaves only a toast that vanishes after 4s.',
    ).toBeTruthy();
  });

  it('no STALE exemptions — an entry whose file now wires it (or no longer renders the modal) is a lie', () => {
    const stale = Object.keys(EXEMPT).filter((rel) => {
      const hit = consumers.find((c) => c.rel === rel);
      return !hit || /submitError/.test(hit.src);
    });
    expect(stale, `these exemptions no longer describe reality: ${stale.join(', ')}`).toEqual([]);
  });
});
