/**
 * historicalImportSummary.mjs — pure helpers for the >1yr advisory (FR-HIST-010) and the
 * completion summary report (FR-HIST-014). No I/O — console.log happens in import-historical.mjs.
 */
const ONE_YEAR_MS = 365 * 24 * 60 * 60 * 1000;

export function warnIfOlderThanOneYear(dateStr, now = new Date()) {
  const d = new Date(dateStr + 'T00:00:00Z');
  if (now.getTime() - d.getTime() > ONE_YEAR_MS) {
    return `date ${dateStr} is more than 1 year before the run date — summary-grade scope is ≤ 1yr (advisory only, not blocked).`;
  }
  return null;
}

function line(label, counts) {
  return `  ${label}: created: ${counts.created}, skipped: ${counts.skipped}, failed: ${counts.failed}`;
}

export function buildSummary({ importBatchId, projects, cases, recordsByType, references }) {
  const lines = [
    `import_batch_id: ${importBatchId}`,
    'projects:',
    line('projects', projects),
    'cases:',
    line('cases', cases),
    'records by type:',
    ...Object.entries(recordsByType).map(([type, counts]) => line(type, counts)),
    `references: resolved ${references.resolved}, created ${references.created}`,
  ];
  return lines.join('\n');
}
