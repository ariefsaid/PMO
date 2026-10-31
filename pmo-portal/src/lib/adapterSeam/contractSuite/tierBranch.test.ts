/**
 * AC-ECA-043 (FR-ECA-053) — no PMO code above the adapter branches on an ERP tier name. Code under
 * `adapterSeam/<tier>/**` and a tier's own edge functions (`<tier>-*`) may; everything else is counted here and
 * must match the allowlist exactly, so a NEW branch fails and a branch that is cleaned up must be removed from it.
 *
 * The allowlist is today's connect/setup/UI plumbing and one dispatch rule. Each leaves via the ECA slices that put
 * the behaviour behind the contract (#1600, #1605, #1606); none is a registered sync workflow's decision.
 */
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { describe, expect, it } from 'vitest';

const PORTAL = new URL('../../../../', import.meta.url).pathname;
const REPO = join(PORTAL, '..');
// Odoo is named before it exists; any other ERP tier is found on disk (a directory with declarations).
const SEAM = join(PORTAL, 'src/lib/adapterSeam');
const TIERS = [...new Set([
  'erpnext', 'odoo',
  ...readdirSync(SEAM).filter((name) => existsSync(join(SEAM, name, 'workflowDeclarations.ts'))),
])];
const NAME = `(?:${TIERS.join('|')})`;
const LITERAL = `['"]${NAME}['"]`;
const CONSTANT = '\\b\\w*_TIER\\b'; // ERPNEXT_TIER, ODOO_TIER, …
const OP = '(?:===|!==|==|!=)';
const BRANCH = new RegExp([
  `${OP}\\s*${LITERAL}`, `\\bcase\\s+${LITERAL}`, `${LITERAL}\\s*${OP}`, // tier === 'erpnext'
  `${OP}\\s*${CONSTANT}`, `\\bcase\\s+${CONSTANT}`, `${CONSTANT}\\s*${OP}`, // tier === ERPNEXT_TIER
  `\\.includes\\(\\s*${LITERAL}`, `\\[[^\\]]*${LITERAL}[^\\]]*\\]\\.includes\\(`, // ['erpnext'].includes(tier)
].join('|'), 'g');

/** repo-relative file -> number of tier-name comparisons it holds today. */
const ALLOWED: Record<string, number> = {
  'pmo-portal/src/components/integrations/IntegrationsView.tsx': 14,
  'pmo-portal/src/hooks/useErpItemOptions.ts': 1,
  'pmo-portal/src/hooks/useExpensePostingReadiness.ts': 1,
  'pmo-portal/src/lib/repositories/index.ts': 2,
  'pmo-portal/src/lib/adapterSeam/dispatch.ts': 1,
  'supabase/functions/external-unlink/index.ts': 2,
  'supabase/functions/external-invoice-evidence/index.ts': 1,
  'supabase/functions/external-connect/index.ts': 2,
  'supabase/functions/external-link/index.ts': 2,
  'supabase/functions/external-companies/index.ts': 1,
  'supabase/functions/external-invoice-pdf/index.ts': 1,
  'supabase/functions/external-disconnect/index.ts': 1,
  'supabase/functions/external-set-company/index.ts': 1,
  // #1595: the assistant picks ERP vs native invoice drafting by the revenue owner; moves behind the contract with #1609.
  'supabase/functions/agent-chat/draftInvoice.ts': 1,
};

function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (name === 'node_modules') return [];
    if (statSync(path).isDirectory()) return sourceFiles(path);
    return /\.(ts|tsx)$/.test(name) && !/\.test\.tsx?$/.test(name) ? [path] : [];
  });
}

function ownedByATier(rel: string): boolean {
  return TIERS.some((t) => rel.startsWith(`pmo-portal/src/lib/adapterSeam/${t}/`) || rel.startsWith(`supabase/functions/${t}-`));
}

function countByFile(): Record<string, number> {
  const roots = [join(PORTAL, 'src'), join(PORTAL, 'pages'), join(REPO, 'supabase/functions')];
  const counts: Record<string, number> = {};
  for (const file of roots.flatMap(sourceFiles)) {
    const rel = relative(REPO, file);
    if (ownedByATier(rel)) continue;
    const n = readFileSync(file, 'utf8').match(BRANCH)?.length ?? 0;
    if (n > 0) counts[rel] = n;
  }
  return counts;
}

describe('AC-ECA-043 tier-name branches outside the tier', () => {
  it('match the allowlist exactly: nothing new, nothing stale', () => {
    expect(countByFile()).toEqual(ALLOWED);
  });

  it('the pattern recognises each comparison shape it exists to catch', () => {
    const shapes = [
      `x === 'erpnext'`, `x !== "odoo"`, `'erpnext' === x`, `case 'odoo':`,
      `adapter.tier === ERPNEXT_TIER`, `ODOO_TIER !== tier`, `case ERPNEXT_TIER:`,
      `list.includes('erpnext')`, `['erpnext', 'odoo'].includes(tier)`,
    ];
    for (const s of shapes) expect(s.match(BRANCH), s).toHaveLength(1);
    expect(`tier: 'erpnext'`.match(BRANCH)).toBeNull();
    expect(`{ [ERPNEXT_TIER]: resolve }`.match(BRANCH)).toBeNull(); // a registry key is the allowed seam
  });
});
