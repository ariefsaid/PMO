/** The exact raw key emitted by the original app and loader writers. */
export function computeBudgetLineImportKey({ project, category, description, fiscalYear, amount, reference }) {
  const ref = reference.trim();
  return ref || `fp:${[project, category, description, fiscalYear, amount].map((v) => v.trim()).join('|')}`;
}

/** Identity inputs are already validated by the caller's import grammar. */
export function encodeBudgetImportIdentity({ projectUuid, project, category, rawCategory, description, fiscalYear, amountText, amount, reference }) {
  if (!Number.isFinite(amount) || amount < 0 || amount >= 1e12) throw new Error('Invalid budget amount');
  // Callers validate and normalize their accepted grammar first. Convert that normalized
  // decimal spelling with integer arithmetic, without binary floating-point rounding.
  const match = String(amount).match(/^(\d+)(?:\.(\d+))?(?:e([+-]?\d+))?$/i);
  if (!match) throw new Error('Invalid budget amount');
  const fraction = match[2] ?? '';
  const shift = Number(match[3] ?? 0) - fraction.length + 2;
  const digits = BigInt(match[1] + fraction);
  let cents;
  if (shift >= 0) cents = digits * 10n ** BigInt(shift);
  else {
    const divisor = 10n ** BigInt(-shift);
    cents = (digits + divisor / 2n) / divisor;
  }
  const decimal = `${cents / 100n}.${String(cents % 100n).padStart(2, '0')}`;
  const appNoise = Math.abs(amount - Number(decimal)) <= Math.max(1e-9, Math.abs(amount) * 5e-16);
  const loaderNoise = Math.abs(Math.round(amount * 100) - amount * 100) < 1e-6;
  if (!appNoise && !loaderNoise) throw new Error('Invalid budget amount');
  const ref = reference.trim();
  const legacyKey = computeBudgetLineImportKey({ project, category: rawCategory, description, fiscalYear, amount: amountText, reference });
  const tuple = ref ? ['r', ref] : ['f', projectUuid.toLowerCase(), category, description.trim(), fiscalYear.trim(), decimal];
  return { v2Key: `bimp2:${JSON.stringify(tuple)}`, legacyKey, hasReference: Boolean(ref), decimalAmount: decimal };
}
