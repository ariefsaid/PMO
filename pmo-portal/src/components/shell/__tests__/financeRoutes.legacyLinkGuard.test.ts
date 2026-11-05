// @vitest-environment node
/**
 * #1524 guard: no in-app link, button or navigate() call targets a legacy finance address that
 * exists only as a redirect (`FinanceLegacyRedirect` in App.tsx — /sales-invoices,
 * /incoming-payments, /reports, /revenue-by-project, /financial-statements).
 *
 * Every in-app click that lands on a legacy address pays an extra navigation and makes browser
 * journeys timing-dependent (the AC-S36-006 release flake class): one run's URL assertion won the
 * race against the redirect, the next lost. The finance restructure (#1469) deliberately KEPT the
 * redirects for old bookmarks and external links, so this guard allows exactly those legitimate
 * remaining occurrences — route definitions, redirect targets, deep-link route matching, record
 * paths (which stay real routes) — with a reason per entry. Stale entries fail like check-e2e-skips:
 * a rule that no longer matches anything means the documented occurrence is gone; drop the entry.
 *
 * The finance-record markdown links emitted by the two agent edge functions render as router links
 * in the assistant panel (src/components/panel/Markdown.tsx passes same-origin hrefs to react-router),
 * so they are in-app links too and are scanned with the same rules.
 */
import { it, expect } from 'vitest';
import { readdirSync, readFileSync, statSync, existsSync } from 'node:fs';
import { join, relative } from 'node:path';

const PMO_ROOT = join(__dirname, '../../../..');
const REPO_ROOT = join(__dirname, '../../../../..');

/** The legacy list addresses whose only job is to redirect (App.tsx `FinanceLegacyRedirect`). */
const LEGACY: { address: string; re: RegExp }[] = [
  // `(?![\w-/])` lets record paths (/sales-invoices/:id — real routes) pass without entries.
  { address: '/sales-invoices', re: /(?<![\w-])\/sales-invoices(?![\w-/])/ },
  { address: '/incoming-payments', re: /(?<![\w-])\/incoming-payments(?![\w-/])/ },
  { address: '/revenue-by-project', re: /(?<![\w-])\/revenue-by-project(?![\w-/])/ },
  { address: '/financial-statements', re: /(?<![\w-])\/financial-statements(?![\w-/])/ },
  // `/reports` must not match inside /finance/reports (the destination) or any subpath.
  { address: '/reports', re: /(?<![\w/-])\/reports(?![\w-/])/ },
];

/** Legitimate occurrences per file (repo-root-relative), each with its reason. Stale entries fail (see file header). */
const ALLOWED: Record<string, { re: RegExp; why: string }[]> = {
  'pmo-portal/App.tsx': [
    // The redirects themselves — kept for old bookmarks and external links (#1469).
    { re: /path: '\/(reports|sales-invoices|incoming-payments|revenue-by-project|financial-statements)'/, why: 'FinanceLegacyRedirect route definition (bookmark compat)' },
    // Same-owner list-return navigation normalises a legacy record-list path to the destination.
    { re: /const legacyPath = /, why: 'record-list return navigation legacy-path detection' },
    { re: /parsed\.pathname === '\/sales-invoices' \|\| parsed\.pathname === '\/incoming-payments'/, why: 'record-list return navigation normalises to /finance/receivables' },
    // The finance record routes (/sales-invoices/:id, /incoming-payments/:id) are real routes;
    // App.tsx resolves their breadcrumb ancestry inline.
    { re: /if \(\/\^\\\/sales-invoices\\\/\[\^\/\]\+\$\/\.test\(pathname\)\)/, why: 'breadcrumb ancestry for the real invoice record route' },
    { re: /if \(\/\^\\\/incoming-payments\\\/\[\^\/\]\+\$\/\.test\(pathname\)\)/, why: 'breadcrumb ancestry for the real payment record route' },
  ],
  'pmo-portal/src/auth/policy.ts': [
    { re: /\/\/ \/incoming-payments render /, why: 'comment only — no navigation' },
  ],
  'pmo-portal/src/components/shell/routeMatch.ts': [
    // Deep-link route matching: legacy addresses still resolve (via the redirect) so their
    // breadcrumb title and i18n key must stay registered.
    { re: /'\/(reports|sales-invoices|incoming-payments|revenue-by-project)': '/, why: 'PLACEHOLDER_TITLES / i18n key map for legacy deep-links' },
    { re: /\/\/ B-10 \(AC-W2-IA-005\): \/reports stays a route/, why: 'comment only — no navigation' },
    { re: /\[\^\/\]\+\$\/\.test\(pathname\)/, why: 'finance record routes (/sales-invoices/:id) are real routes; rail parent resolution' },
    { re: /const (invoiceRecord|paymentRecord) = /, why: 'breadcrumb ancestry for the real record routes' },
  ],
  'pmo-portal/src/components/shell/Rail.tsx': [
    // staticNavLabels keeps the shell.nav.* catalogue keys alive for routeMatch's legacy
    // breadcrumb titles; the rail's own items point at /finance/* already.
    { re: /'\/(sales-invoices|incoming-payments|revenue-by-project|financial-statements|reports)': t\(/, why: 'staticNavLabels i18n catalogue keys for legacy breadcrumb titles' },
  ],
  'pmo-portal/src/components/shell/NotificationBell.tsx': [
    // Record-path BASE: entityRoute appends `/${entity.id}` → /sales-invoices/:id, a real route.
    { re: /sales_invoice: '\/sales-invoices'/, why: 'record-path base for notification deep links' },
  ],
  'pmo-portal/pages/SalesInvoices.tsx': [
    // The invoice record page lives at /sales-invoices/:id — a real route, not a redirect.
    { re: /useRecordContext\('\/sales-invoices'/, why: 'canonical record route identity' },
  ],
  'pmo-portal/pages/IncomingPayments.tsx': [
    { re: /useRecordContext\('\/incoming-payments'/, why: 'canonical record route identity' },
  ],
};

const EDGE_FNS = [
  'supabase/functions/agent-chat/overdue.ts',
  'supabase/functions/agent-chat/draftInvoice.ts',
];

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    if (name === 'node_modules' || name === '__tests__' || name === 'e2e') continue;
    const full = join(dir, name);
    if (statSync(full).isDirectory()) walk(full, out);
    else if (/\.(ts|tsx)$/.test(name) && !/\.(test|spec|stories)\.(ts|tsx)$/.test(name)) out.push(full);
  }
  return out;
}

const FILES = [
  join(PMO_ROOT, 'App.tsx'),
  ...walk(join(PMO_ROOT, 'pages')),
  ...walk(join(PMO_ROOT, 'src')),
  // Eval expectations assert the assistant's rendered link targets, so they follow the same rule
  // (invoice-reach drifted to the legacy /sales-invoices address after #1524 moved the emitter).
  ...walk(join(PMO_ROOT, 'evals')),
  ...EDGE_FNS.map((f) => join(REPO_ROOT, f)),
];

it('guard scope: every scanned file exists (edge functions included — no silent shrink)', () => {
  for (const file of FILES) {
    expect(existsSync(file), `missing scan target: ${relative(REPO_ROOT, file)}`).toBe(true);
  }
  expect(FILES.length).toBeGreaterThan(50);
});

it('#1524: no in-app link target points at a legacy redirecting finance address', () => {
  const violations: string[] = [];
  for (const file of FILES) {
    const rel = relative(REPO_ROOT, file);
    const rules = ALLOWED[rel] ?? [];
    const lines = readFileSync(file, 'utf8').split('\n');
    lines.forEach((text, i) => {
      for (const { address, re } of LEGACY) {
        if (re.test(text) && !rules.some((rule) => rule.re.test(text))) {
          violations.push(`${rel}:${i + 1} → ${address}\n    ${text.trim()}`);
        }
      }
    });
  }
  expect(
    violations,
    `in-app links must target the /finance/* destination, not the redirecting legacy address:\n  ${violations.join('\n  ')}`,
  ).toEqual([]);
});

it('#1524: the legacy addresses really are redirects and the destinations really are routes (App.tsx)', () => {
  const app = readFileSync(join(PMO_ROOT, 'App.tsx'), 'utf8');
  // The premise of this guard: each legacy address routes to FinanceLegacyRedirect…
  for (const legacy of ['/reports', '/sales-invoices', '/incoming-payments', '/revenue-by-project', '/financial-statements']) {
    expect(app, `${legacy} must keep its FinanceLegacyRedirect route`).toContain(
      `path: '${legacy}', element: <FinanceLegacyRedirect`,
    );
  }
  // …and each destination the in-app links now use is a registered route.
  for (const dest of ['/finance/receivables', '/finance/reports', '/finance/statements']) {
    expect(app, `${dest} must stay a registered route`).toContain(`path: '${dest}'`);
  }
});

it('#1524: allowlist entries stay live (stale entries fail, like check-e2e-skips)', () => {
  for (const [rel, rules] of Object.entries(ALLOWED)) {
    const source = readFileSync(join(REPO_ROOT, rel), 'utf8');
    for (const { re, why } of rules) {
      expect(
        re.test(source),
        `stale allowlist entry for ${rel} ("${why}") — the occurrence it documents is gone; drop the entry`,
      ).toBe(true);
    }
  }
});
