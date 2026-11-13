#!/usr/bin/env node
/**
 * Guard (#2059): the UI stays on ONE button system, ONE avatar, sentence-case labels.
 * Fails on, in app source (tests and vendored reui/shadcn excluded):
 *   uppercase   a CSS `uppercase` class (labels are sentence case; codes are typed in caps)
 *   button      a <Button> className that sets its own height or text size, or a <Link>/<a>/<button>
 *               hand-styled as a button (rounded + border-input or bg-primary): use <Button> /
 *               buttonClasses(variant, size) with the DESIGN.md sizes (default 38px, sm 30px, icon)
 *   button-default a <Button> without an explicit variant (defaults to a filled primary action)
 *   raw-control  a native <input>, <select> or <textarea> outside an approved control exception
 *   avatar      a hand-built initials circle (rounded-full + place-items-center + bg-secondary) or the
 *               retired per-person --avatar-N hues: use <Avatar> from src/components/ui/Avatar
 * Existing exceptions live in ALLOW (path -> rule, reason) or STRUCTURAL_ALLOW (path, rule, exact
 * count, reason); stale or over-count entries fail so an exception cannot silently spread.
 *
 * Run: node scripts/check-ui-system.mjs [--self-test]
 */
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve, join, relative } from 'node:path';

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const ROOTS = ['pmo-portal/pages', 'pmo-portal/src', 'pmo-portal/components'];
const SKIP = /(\.test\.|\/__tests__\/|\/reui\/|\/shadcn\/|\.d\.ts$)/;

/** path -> { rule, reason } — each must still match, or the entry is stale. */
export const ALLOW = {
  'pmo-portal/src/components/EnvBadge.tsx': { rule: 'uppercase', reason: 'environment code badge (STAGING), a code not a label' },
  'pmo-portal/src/components/ui/ConfirmDialog.tsx': { rule: 'button', reason: '44px mobile sheet buttons' },
};

const STRUCTURAL_ALLOW = [
  { path: 'pmo-portal/pages/AdministrationExchangeRates.tsx', rule: 'button-default', count: 1, reason: 'Upload rates is the filled create action; the peer action is explicitly outline.' },
  { path: 'pmo-portal/pages/admin/CostAttribution.tsx', rule: 'button-default', count: 1, reason: 'Add rule is the single filled create action for this list.' },
  { path: 'pmo-portal/pages/admin/OrgProjectClassificationOptions.tsx', rule: 'button-default', count: 1, reason: 'Save options is the form submit action; the view has no competing filled action.' },
  { path: 'pmo-portal/pages/admin/OrgProjectNumberPattern.tsx', rule: 'button-default', count: 1, reason: 'Save pattern is the form submit action; Cancel is explicitly ghost.' },
  { path: 'pmo-portal/pages/procurement/VendorWithholdingSlipDetails.tsx', rule: 'button-default', count: 1, reason: 'Reload is the sole recovery action in the failed detail state; Close is explicitly outline.' },
  { path: 'pmo-portal/pages/project-detail/ProjectOdooLink.tsx', rule: 'button-default', count: 2, reason: 'Use this plan and Link are primary transitions in mutually exclusive setup states.' },
  { path: 'pmo-portal/pages/project-detail/tabs/DocumentsBulkBar.tsx', rule: 'button-default', count: 1, reason: 'Review change is the filled action only after a bulk status is selected.' },
  { path: 'pmo-portal/pages/project-detail/tabs/TaskRecordDrawer.tsx', rule: 'button-default', count: 1, reason: 'Edit is the drawer header action; Open full page is explicitly outline.' },
  { path: 'pmo-portal/pages/stock/StockReorder.tsx', rule: 'button-default', count: 2, reason: 'Accept suggestion and Save are filled actions in the mutually exclusive view and edit states.' },
  { path: 'pmo-portal/src/components/comments/CommentsSection.tsx', rule: 'button-default', count: 1, reason: 'Post comment is the single filled submit action for the composer.' },
  { path: 'pmo-portal/src/components/integrations/InvoicePairReview.tsx', rule: 'button-default', count: 1, reason: 'Count each once confirms the clear-pairing set; it is the lone filled action in that state.' },
  { path: 'pmo-portal/src/components/integrations/odoo/OdooConnectionCard.tsx', rule: 'button-default', count: 1, reason: 'Activate is the filled transition after selecting the Odoo company.' },
  { path: 'pmo-portal/src/components/integrations/odoo/OdooMapOnce.tsx', rule: 'button-default', count: 1, reason: 'Accept all is the mapping form submit action.' },
  { path: 'pmo-portal/src/components/procurement/ProcurementBlock.tsx', rule: 'button-default', count: 3, reason: 'Approve, New procurement and the drawer main transition are existing screen actions; the procurement render pass still owns their state-by-state primary review.' },
  { path: 'pmo-portal/pages/Administration.tsx', rule: 'raw-control', count: 1, reason: 'Existing screen-owned native control is retained; A1 adds the guard without changing Administration behavior.' },
  { path: 'pmo-portal/pages/MasterData.tsx', rule: 'raw-control', count: 1, reason: 'Existing screen-owned native control is retained; A1 adds the guard without changing Master Data behavior.' },
  { path: 'pmo-portal/pages/MyTasks.tsx', rule: 'raw-control', count: 1, reason: 'Existing screen-owned native control is retained; A1 adds the guard without changing My Tasks behavior.' },
  { path: 'pmo-portal/pages/Procurement.tsx', rule: 'raw-control', count: 4, reason: 'Existing screen-owned native controls are retained; A1 adds the guard without changing procurement list behavior.' },
  { path: 'pmo-portal/pages/ProcurementDetails.tsx', rule: 'raw-control', count: 1, reason: 'Existing screen-owned native control is retained; A1 adds the guard without changing procurement detail behavior.' },
  { path: 'pmo-portal/pages/ProjectBudget.tsx', rule: 'raw-control', count: 1, reason: 'Existing screen-owned native control is retained; A1 adds the guard without changing project budget behavior.' },
  { path: 'pmo-portal/pages/equipment/EquipmentCostingForm.tsx', rule: 'raw-control', count: 1, reason: 'Existing form control is outside A1 ownership and is retained as shipped.' },
  { path: 'pmo-portal/pages/expenses/ExpenseClaimFormModal.tsx', rule: 'raw-control', count: 1, reason: 'Existing form control is outside A1 ownership and is retained as shipped.' },
  { path: 'pmo-portal/pages/expenses/ExpenseReceiptsCard.tsx', rule: 'raw-control', count: 1, reason: 'Existing form control is outside A1 ownership and is retained as shipped.' },
  { path: 'pmo-portal/pages/procurement/LedgerFileCell.tsx', rule: 'raw-control', count: 1, reason: 'Existing screen-owned native control is retained; A1 adds the guard without changing procurement file behavior.' },
  { path: 'pmo-portal/pages/procurement/ProcurementDecisionZone.tsx', rule: 'raw-control', count: 7, reason: 'Existing approval form controls are outside A1 ownership; this guard preserves their behavior and caps the baseline.' },
  { path: 'pmo-portal/pages/procurement/ProcurementFilesSubsection.tsx', rule: 'raw-control', count: 1, reason: 'Existing form control is outside A1 ownership and is retained as shipped.' },
  { path: 'pmo-portal/pages/procurement/SubcontractBillLines.tsx', rule: 'raw-control', count: 1, reason: 'Existing form control is outside A1 ownership and is retained as shipped.' },
  { path: 'pmo-portal/pages/procurement/VendorBillTaxFields.tsx', rule: 'raw-control', count: 1, reason: 'Existing form control is outside A1 ownership and is retained as shipped.' },
  { path: 'pmo-portal/pages/procurement/VendorInvoiceCaptureFields.tsx', rule: 'raw-control', count: 1, reason: 'Existing form control is outside A1 ownership and is retained as shipped.' },
  { path: 'pmo-portal/pages/project-budget/BudgetLineItemEditor.tsx', rule: 'raw-control', count: 6, reason: 'Existing budget editor controls are outside A1 ownership and are retained as shipped.' },
  { path: 'pmo-portal/pages/project-budget/BudgetModeSwitchDialog.tsx', rule: 'raw-control', count: 1, reason: 'Existing budget dialog control is outside A1 ownership and is retained as shipped.' },
  { path: 'pmo-portal/pages/project-budget/BudgetPasteRowsDialog.tsx', rule: 'raw-control', count: 1, reason: 'Existing budget dialog control is outside A1 ownership and is retained as shipped.' },
  { path: 'pmo-portal/pages/project-budget/BudgetVersionActions.tsx', rule: 'raw-control', count: 1, reason: 'Existing budget action control is outside A1 ownership and is retained as shipped.' },
  { path: 'pmo-portal/pages/project-budget/DistributionGrid.tsx', rule: 'raw-control', count: 8, reason: 'Existing budget distribution controls are outside A1 ownership and are retained as shipped.' },
  { path: 'pmo-portal/pages/project-detail/MilestoneStrip.tsx', rule: 'raw-control', count: 1, reason: 'Existing screen-owned control is retained; A1 adds the guard without changing milestone behavior.' },
  { path: 'pmo-portal/pages/project-detail/WorkOrderAcceptanceModal.tsx', rule: 'raw-control', count: 1, reason: 'Existing screen-owned control is retained; A1 adds the guard without changing acceptance behavior.' },
  { path: 'pmo-portal/pages/project-detail/budget/BudgetVersionsDrawer.tsx', rule: 'raw-control', count: 2, reason: 'Existing budget drawer controls are outside A1 ownership and are retained as shipped.' },
  { path: 'pmo-portal/pages/project-detail/tabs/DocumentsBulkBar.tsx', rule: 'raw-control', count: 1, reason: 'Existing bulk status control is outside A1 ownership and is retained as shipped.' },
  { path: 'pmo-portal/pages/project-detail/tabs/DocumentsDialogs.tsx', rule: 'raw-control', count: 1, reason: 'Existing document dialog control is outside A1 ownership and is retained as shipped.' },
  { path: 'pmo-portal/pages/project-detail/tabs/DocumentsToolbar.tsx', rule: 'raw-control', count: 3, reason: 'Existing document toolbar filters are outside A1 ownership and are retained as shipped.' },
  { path: 'pmo-portal/pages/sales/DealParts.tsx', rule: 'raw-control', count: 3, reason: 'Existing sales form controls are outside A1 ownership and are retained as shipped.' },
  { path: 'pmo-portal/pages/sales/SalesParts.tsx', rule: 'raw-control', count: 1, reason: 'Existing sales filter is outside A1 ownership and is retained as shipped.' },
  { path: 'pmo-portal/src/auth/authFormPrimitives.tsx', rule: 'raw-control', count: 1, reason: 'Auth form primitive is outside this task scope and its native field remains untouched.' },
  { path: 'pmo-portal/src/components/builder/AIComposerModal.tsx', rule: 'raw-control', count: 1, reason: 'Existing builder composer control is outside A1 ownership and is retained as shipped.' },
  { path: 'pmo-portal/src/components/builder/PanelEditorForm.tsx', rule: 'raw-control', count: 1, reason: 'Existing builder form control is outside A1 ownership and is retained as shipped.' },
  { path: 'pmo-portal/src/components/import/procurementCycle/ProcurementCycleImportWizard.tsx', rule: 'raw-control', count: 2, reason: 'Existing import wizard controls are outside A1 ownership and are retained as shipped.' },
  { path: 'pmo-portal/src/components/integrations/TaskListMatchReview.tsx', rule: 'raw-control', count: 2, reason: 'Existing integration review controls are outside A1 ownership and are retained as shipped.' },
  { path: 'pmo-portal/src/components/legal/AnalyticsOptOutToggle.tsx', rule: 'raw-control', count: 1, reason: 'The native toggle input supplies the existing consent control semantics; this is outside A1 ownership.' },
  { path: 'pmo-portal/src/components/panel/ArtifactSlot.tsx', rule: 'raw-control', count: 1, reason: 'Existing artifact input is outside A1 ownership and is retained as shipped.' },
  { path: 'pmo-portal/src/components/panel/QuestionChips.tsx', rule: 'raw-control', count: 1, reason: 'Existing question entry control is outside A1 ownership and is retained as shipped.' },
  { path: 'pmo-portal/src/components/procurement/ProcurementBlock.tsx', rule: 'raw-control', count: 3, reason: 'Existing procurement filters and selection control are retained; their screen-level work is outside A1 ownership.' },
  { path: 'pmo-portal/src/components/ui/DataTableDesktop.tsx', rule: 'raw-control', count: 1, reason: 'The shared table owns its native selection control to preserve the browser checkbox semantics.' },
  { path: 'pmo-portal/src/components/ui/FormFields.tsx', rule: 'raw-control', count: 6, reason: 'FormFields owns the native input, select and textarea elements that implement the shared field primitives.' },
  { path: 'pmo-portal/src/components/ui/TableControls.tsx', rule: 'raw-control', count: 1, reason: 'SearchMini owns the native search input so browser search semantics stay inside the shared control.' },
  { path: 'pmo-portal/components/IncidentFormModal.tsx', rule: 'raw-control', count: 1, reason: 'Existing incident form control is outside A1 ownership and is retained as shipped.' },
  { path: 'pmo-portal/components/project-status/ProjectTransitionConfirm.tsx', rule: 'raw-control', count: 1, reason: 'Existing transition form control is outside A1 ownership and is retained as shipped.' },
  { path: 'pmo-portal/components/project-status/WinDetailsFields.tsx', rule: 'raw-control', count: 2, reason: 'Existing win detail controls are outside A1 ownership and are retained as shipped.' },
];

const RULES = {
  uppercase: (line) => /\buppercase\b/.test(line),
  button: (line) =>
    /<Button\b[^>]*className="[^"]*(?<![-\w])(h-\d|h-\[|text-xs|text-sm|text-\[)/.test(line) ||
    /<(Link|a|button)\b[^>]*className="[^"]*\brounded-(md|lg)\b[^"]*(border-input|bg-primary\b)/.test(line),
  avatar: (line) =>
    /--avatar-\d|avatarHue/.test(line) ||
    (/rounded-full/.test(line) && /place-items-center|items-center justify-center/.test(line) && /\bsize-\d/.test(line) && /bg-secondary\b/.test(line) && /text-\[|font-(bold|semibold)/.test(line)),
};

/** Read JSX opening tags without stopping at `>` inside a quoted value or brace expression. */
function findOpeningTags(source, tagName) {
  const startPattern = new RegExp(`<${tagName}\\b(?=[\\s/>])`, 'g');
  const openings = [];
  let match;

  while ((match = startPattern.exec(source))) {
    let index = startPattern.lastIndex;
    let expressionDepth = 0;
    let quote = null;
    let escaped = false;

    for (; index < source.length; index += 1) {
      const character = source[index];
      if (quote) {
        if (escaped) escaped = false;
        else if (character === '\\') escaped = true;
        else if (character === quote) quote = null;
        continue;
      }
      if (character === '"' || character === "'" || character === '`') {
        quote = character;
        continue;
      }
      if (character === '{') {
        expressionDepth += 1;
        continue;
      }
      if (character === '}' && expressionDepth > 0) {
        expressionDepth -= 1;
        continue;
      }
      if (character === '>' && expressionDepth === 0) break;
    }

    if (index < source.length) {
      openings.push({
        attributes: source.slice(startPattern.lastIndex, index),
        line: source.slice(0, match.index).split('\n').length,
      });
    }
  }

  return openings;
}

export function scan(path, text) {
  const hits = [];
  text.split('\n').forEach((line, i) => {
    for (const [rule, test] of Object.entries(RULES)) if (test(line)) hits.push({ path, line: i + 1, rule });
  });
  for (const opening of findOpeningTags(text, 'Button')) {
    if (!/(?:^|\s)variant\s*=/.test(opening.attributes)) {
      hits.push({ path, line: opening.line, rule: 'button-default' });
    }
  }
  for (const tagName of ['input', 'select', 'textarea']) {
    for (const opening of findOpeningTags(text, tagName)) {
      hits.push({ path, line: opening.line, rule: 'raw-control' });
    }
  }
  return hits;
}

function walk(dir, out = []) {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (/\.tsx$/.test(name) && !SKIP.test(p)) out.push(p);
  }
  return out;
}

export function evaluate(hits) {
  const used = new Set();
  const failures = [];
  const structuralHits = new Map();
  const structuralAllow = new Map(STRUCTURAL_ALLOW.map((entry) => [`${entry.path}#${entry.rule}`, entry]));

  for (const h of hits) {
    if (h.rule === 'button-default' || h.rule === 'raw-control') {
      const key = `${h.path}#${h.rule}`;
      const group = structuralHits.get(key) ?? [];
      group.push(h);
      structuralHits.set(key, group);
      continue;
    }
    const a = ALLOW[h.path];
    if (a && a.rule === h.rule) used.add(h.path);
    else failures.push(`${h.path}:${h.line} ${h.rule}`);
  }
  for (const p of Object.keys(ALLOW)) if (!used.has(p)) failures.push(`${p} stale allowlist entry (${ALLOW[p].rule})`);

  for (const [key, matches] of structuralHits) {
    const allowed = structuralAllow.get(key);
    if (!allowed) {
      for (const hit of matches) failures.push(`${hit.path}:${hit.line} ${hit.rule}`);
      continue;
    }
    if (matches.length < allowed.count) {
      failures.push(`${allowed.path} stale allowlist entry (${allowed.rule}; expected ${allowed.count}, found ${matches.length})`);
    }
    for (const hit of matches.slice(allowed.count)) {
      failures.push(`${hit.path}:${hit.line} ${hit.rule} (allowlist cap ${allowed.count}; ${allowed.reason})`);
    }
  }

  for (const [key, allowed] of structuralAllow) {
    if (!structuralHits.has(key)) {
      failures.push(`${allowed.path} stale allowlist entry (${allowed.rule}; ${allowed.reason})`);
    }
  }
  return failures;
}

function selfTest() {
  const bad = {
    uppercase: '<p className="text-[11px] uppercase tracking-wide">Status</p>',
    button: '<Button variant="outline" className="h-9 px-2">Go</Button>',
    buttonDefault: '<Button onClick={save}>Save</Button>',
    nativeInput: '<input type="text" aria-label="Name" />',
    nativeSelect: '<select aria-label="Status"><option>Open</option></select>',
    nativeTextarea: '<textarea aria-label="Notes" />',
    button2: '<Link className="rounded-md border border-input px-3" to="/x">Go</Link>',
    avatar: '<span className="grid size-6 place-items-center rounded-full bg-secondary text-[11px] font-bold">RK</span>',
    avatar2: "style={{ background: 'hsl(var(--avatar-2))' }}",
  };
  const good = ['<Button variant="outline" size="sm" className="w-full">Go</Button>', '<span className="rounded-full bg-primary size-2" />'];
  const structuralRules = {
    buttonDefault: 'button-default',
    nativeInput: 'raw-control',
    nativeSelect: 'raw-control',
    nativeTextarea: 'raw-control',
  };
  for (const [k, line] of Object.entries(bad)) {
    const hits = scan('x.tsx', line);
    if (!hits.length) throw new Error(`self-test: ${k} not caught`);
    if (structuralRules[k] && !hits.some((hit) => hit.rule === structuralRules[k])) {
      throw new Error(`self-test: ${k} did not trigger ${structuralRules[k]}`);
    }
  }
  for (const line of good) if (scan('x.tsx', line).length) throw new Error(`self-test: false positive on ${line}`);
  if (!evaluate([]).some((f) => f.includes('stale'))) throw new Error('self-test: stale entry not caught');
  console.log('check-ui-system self-test ok');
}

if (process.argv.includes('--self-test')) selfTest();
else {
  const hits = ROOTS.flatMap((r) => walk(join(REPO, r))).flatMap((f) => scan(relative(REPO, f), readFileSync(f, 'utf8')));
  const failures = evaluate(hits);
  if (failures.length) {
    console.error('UI system guard failed (#2059):\n' + failures.map((f) => '  ' + f).join('\n'));
    process.exit(1);
  }
  console.log('check-ui-system ok');
}
