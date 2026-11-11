import { formatExactCents, parseExactCents } from '../exactDecimal';
import { Constants } from '../supabase/database.types';

export type PasteTsvRow = Readonly<{ rowNumber: number; cells: readonly string[] }>;

export class PasteRowsParseError extends Error {
  constructor() {
    super('Invalid TSV quoting.');
    this.name = 'PasteRowsParseError';
  }
}

/** Parse spreadsheet TSV without interpreting formula-like cells or changing cell content. */
export function parsePasteTsv(text: string): PasteTsvRow[] {
  const parsed: PasteTsvRow[] = [];
  let cells: string[] = [];
  let field = '';
  let sourceLine = 1;
  let rowNumber = 1;
  let quoted = false;
  let closedQuote = false;

  const finishField = () => {
    cells.push(field);
    field = '';
    closedQuote = false;
  };
  const finishRow = () => {
    finishField();
    if (cells.some((cell) => cell.trim() !== '')) {
      parsed.push(Object.freeze({ rowNumber, cells: Object.freeze([...cells]) }));
    }
    cells = [];
  };
  const consumeNewline = (index: number, preserve: boolean): number => {
    const isCrLf = text[index] === '\r' && text[index + 1] === '\n';
    if (preserve) field += isCrLf ? '\r\n' : text[index];
    sourceLine += 1;
    return isCrLf ? index + 1 : index;
  };

  for (let index = 0; index < text.length; index += 1) {
    const char = text[index];
    if (quoted) {
      if (char === '"') {
        if (text[index + 1] === '"') {
          field += '"';
          index += 1;
        } else {
          quoted = false;
          closedQuote = true;
        }
      } else if (char === '\n' || char === '\r') {
        index = consumeNewline(index, true);
      } else {
        field += char;
      }
      continue;
    }

    if (closedQuote) {
      if (char === '\t') {
        finishField();
      } else if (char === '\n' || char === '\r') {
        finishRow();
        index = consumeNewline(index, false);
        rowNumber = sourceLine;
      } else {
        throw new PasteRowsParseError();
      }
      continue;
    }

    if (char === '"') {
      if (field !== '') throw new PasteRowsParseError();
      quoted = true;
    } else if (char === '\t') {
      finishField();
    } else if (char === '\n' || char === '\r') {
      finishRow();
      index = consumeNewline(index, false);
      rowNumber = sourceLine;
    } else {
      field += char;
    }
  }

  if (quoted) throw new PasteRowsParseError();
  if (field !== '' || cells.length > 0 || closedQuote) finishRow();
  return parsed;
}

type ParsedDecimal = Readonly<{ coefficient: bigint; scale: number }>;

const MAX_INPUT_LENGTH = 128;
const MAX_CENTS = 99_999_999_999_999n;
const BUDGET_CATEGORIES = Constants.public.Enums.budget_category;
const BUDGET_CATEGORY_SET = new Set<string>(BUDGET_CATEGORIES);

function parseDecimalInput(raw: string): ParsedDecimal | null {
  if (raw.length > MAX_INPUT_LENGTH) return null;
  const value = raw.trim();
  if (value.length === 0 || value.length > MAX_INPUT_LENGTH) return null;
  const match = /^((?:\d+|\d{1,3}(?:,\d{3})+))(?:\.(\d+))?$/.exec(value);
  if (!match) return null;

  const integer = match[1].replaceAll(',', '');
  const fraction = match[2] ?? '';
  return { coefficient: BigInt(`${integer}${fraction}`), scale: fraction.length };
}

function centsFromDecimal(decimal: ParsedDecimal): bigint | null {
  if (decimal.scale <= 2) {
    return decimal.coefficient * (10n ** BigInt(2 - decimal.scale));
  }

  const divisor = 10n ** BigInt(decimal.scale - 2);
  if (decimal.coefficient % divisor !== 0n) return null;
  return decimal.coefficient / divisor;
}

function isValidAmountCents(cents: bigint): boolean {
  return cents > 0n && cents <= MAX_CENTS;
}

/** `12,345`: one comma, exactly three trailing digits, no other separator. Read as 12345, but an Indonesian comma decimal would mean 12.345. */
export function isAmbiguousCommaNumber(raw: string): boolean {
  return /^\d{1,3},\d{3}$/.test(raw.trim());
}

/** Parse a pasted amount into canonical cents precision without rounding. */
export function parsePasteAmount(raw: string): string | null {
  const decimal = parseDecimalInput(raw);
  if (!decimal || decimal.coefficient <= 0n) return null;
  const cents = centsFromDecimal(decimal);
  return cents !== null && isValidAmountCents(cents) ? formatExactCents(cents) : null;
}

/** Multiply positive decimal operands exactly; a fraction of a cent is invalid. */
export function multiplyPasteAmount(quantity: string, rate: string): string | null {
  const parsedQuantity = parseDecimalInput(quantity);
  const parsedRate = parseDecimalInput(rate);
  if (!parsedQuantity || !parsedRate || parsedQuantity.coefficient <= 0n || parsedRate.coefficient <= 0n) return null;

  const cents = centsFromDecimal({
    coefficient: parsedQuantity.coefficient * parsedRate.coefficient,
    scale: parsedQuantity.scale + parsedRate.scale,
  });
  return cents !== null && isValidAmountCents(cents) ? formatExactCents(cents) : null;
}

export type PasteMapping = Readonly<{
  category: number | null;
  description: number | null;
  amount: number | null;
  quantity: number | null;
  rate: number | null;
}>;

export type PasteMode = 'amount' | 'quantity-rate';
export type PasteBudgetCategory = (typeof Constants.public.Enums.budget_category)[number];
export type PasteCategoryAliasTarget = PasteBudgetCategory | readonly PasteBudgetCategory[];
export type PasteCategoryAliases = Readonly<Record<string, PasteCategoryAliasTarget>>;

export type PasteRowField = 'category' | 'amount' | 'quantity' | 'rate' | 'mode' | 'row';
export type PasteRowErrorCode =
  | 'mapping-required'
  | 'mode-required'
  | 'row-limit'
  | 'required'
  | 'unknown-category'
  | 'ambiguous-category'
  | 'invalid-amount'
  | 'invalid-quantity'
  | 'invalid-rate'
  | 'invalid-product';
export type PasteRowError = Readonly<{ field: PasteRowField; code: PasteRowErrorCode }>;

export type PastePreviewError = Readonly<{
  field: 'category' | 'amount' | 'quantity' | 'rate' | 'mode' | 'rows';
  code: 'mapping-required' | 'mode-required' | 'too-many-rows' | 'no-data';
}>;

export type PastePreviewRow = Readonly<{
  rowNumber: number;
  raw: Readonly<{ category: string; description: string; amount: string; quantity: string; rate: string }>;
  category: PasteBudgetCategory | null;
  description: string | null;
  amount: string | null;
  errors: readonly PasteRowError[];
}>;

export type PastePreview = Readonly<{
  rows: readonly PastePreviewRow[];
  validCount: number;
  invalidCount: number;
  totalCents: bigint;
  errors: readonly PastePreviewError[];
}>;

const MAPPING_FIELDS = ['category', 'description', 'amount', 'quantity', 'rate'] as const;
type MappingField = (typeof MAPPING_FIELDS)[number];

function isMappedIndex(index: number | null): index is number {
  return index !== null && Number.isInteger(index) && index >= 0;
}

function readCell(row: PasteTsvRow, index: number | null): string {
  return isMappedIndex(index) ? row.cells[index] ?? '' : '';
}

function normalizeCategory(value: string): string {
  return value.normalize('NFKC').trim().toLowerCase();
}

function resolveCategory(input: string, aliases: PasteCategoryAliases):
  | Readonly<{ category: PasteBudgetCategory; error: null }>
  | Readonly<{ category: null; error: 'required' | 'unknown-category' | 'ambiguous-category' }> {
  const normalized = normalizeCategory(input);
  if (!normalized) return { category: null, error: 'required' };

  const direct = BUDGET_CATEGORIES.find((category) => normalizeCategory(category) === normalized);
  if (direct) return { category: direct, error: null };

  const targets = Object.entries(aliases)
    .filter(([alias]) => normalizeCategory(alias) === normalized)
    .flatMap(([, target]) => Array.isArray(target) ? target : [target])
    .filter((target): target is PasteBudgetCategory => BUDGET_CATEGORY_SET.has(target));
  const matches = [...new Set(targets)];
  if (matches.length === 1) return { category: matches[0], error: null };
  if (matches.length > 1) return { category: null, error: 'ambiguous-category' };
  return { category: null, error: 'unknown-category' };
}

function isNonblankRow(row: PasteTsvRow): boolean {
  return row.cells.some((cell) => cell.trim() !== '');
}

function freezePreview(rows: PastePreviewRow[], errors: PastePreviewError[], totalCents: bigint): PastePreview {
  const frozenRows = Object.freeze(rows.map((row) => Object.freeze({
    ...row,
    raw: Object.freeze({ ...row.raw }),
    errors: Object.freeze(row.errors.map((error) => Object.freeze({ ...error }))),
  })));
  const frozenErrors = Object.freeze(errors.map((error) => Object.freeze({ ...error })));
  const validCount = frozenRows.filter((row) => row.errors.length === 0).length;
  return Object.freeze({
    rows: frozenRows,
    validCount,
    invalidCount: frozenRows.length - validCount,
    totalCents,
    errors: frozenErrors,
  });
}

/** Validate mapped TSV rows locally; returns an immutable review model and never writes data. */
export function previewPasteRows(
  sourceRows: readonly PasteTsvRow[],
  mapping: PasteMapping,
  header: boolean,
  mode: PasteMode | null,
  categoryAliases: PasteCategoryAliases,
): PastePreview {
  const dataRows = sourceRows.slice(header ? 1 : 0).filter(isNonblankRow);
  const previewErrors: PastePreviewError[] = [];
  const missingMappings = new Set<MappingField>();
  for (const field of MAPPING_FIELDS) {
    if (!isMappedIndex(mapping[field])) missingMappings.add(field);
  }

  if (missingMappings.has('category')) previewErrors.push({ field: 'category', code: 'mapping-required' });

  const directAvailable = !missingMappings.has('amount');
  const productAvailable = !missingMappings.has('quantity') && !missingMappings.has('rate');
  let selectedMode = mode;
  if (selectedMode === null) {
    if (directAvailable && productAvailable) {
      previewErrors.push({ field: 'mode', code: 'mode-required' });
    } else if (directAvailable) {
      selectedMode = 'amount';
    } else if (productAvailable || !missingMappings.has('quantity') || !missingMappings.has('rate')) {
      selectedMode = 'quantity-rate';
    }
  }

  if (selectedMode === 'amount' && missingMappings.has('amount')) {
    previewErrors.push({ field: 'amount', code: 'mapping-required' });
  }
  if (selectedMode === 'quantity-rate') {
    if (missingMappings.has('quantity')) previewErrors.push({ field: 'quantity', code: 'mapping-required' });
    if (missingMappings.has('rate')) previewErrors.push({ field: 'rate', code: 'mapping-required' });
  }
  if (selectedMode === null && !previewErrors.some((error) => error.field === 'mode')) {
    previewErrors.push({ field: 'amount', code: 'mapping-required' });
  }

  if (dataRows.length === 0) previewErrors.push({ field: 'rows', code: 'no-data' });
  if (dataRows.length > 500) previewErrors.push({ field: 'rows', code: 'too-many-rows' });

  if (dataRows.length > 500) {
    const overLimitRows = dataRows.map((source) => ({
      rowNumber: source.rowNumber,
      raw: {
        category: readCell(source, mapping.category),
        description: readCell(source, mapping.description),
        amount: readCell(source, mapping.amount),
        quantity: readCell(source, mapping.quantity),
        rate: readCell(source, mapping.rate),
      },
      category: null,
      description: null,
      amount: null,
      errors: [{ field: 'row' as const, code: 'row-limit' as const }],
    }));
    return freezePreview(overLimitRows, previewErrors, 0n);
  }

  const previewRows: PastePreviewRow[] = [];
  let totalCents = 0n;
  for (const source of dataRows) {
    const raw = {
      category: readCell(source, mapping.category),
      description: readCell(source, mapping.description),
      amount: readCell(source, mapping.amount),
      quantity: readCell(source, mapping.quantity),
      rate: readCell(source, mapping.rate),
    };
    const errors: PasteRowError[] = [];
    if (missingMappings.has('category')) errors.push({ field: 'category', code: 'mapping-required' });
    if (previewErrors.some((error) => error.field === 'mode' && error.code === 'mode-required')) {
      errors.push({ field: 'mode', code: 'mode-required' });
    }
    if (selectedMode === null && !previewErrors.some((error) => error.field === 'mode')) {
      errors.push({ field: 'amount', code: 'mapping-required' });
    }
    if (selectedMode === 'amount' && missingMappings.has('amount')) errors.push({ field: 'amount', code: 'mapping-required' });
    if (selectedMode === 'quantity-rate') {
      if (missingMappings.has('quantity')) errors.push({ field: 'quantity', code: 'mapping-required' });
      if (missingMappings.has('rate')) errors.push({ field: 'rate', code: 'mapping-required' });
    }

    let category: PasteBudgetCategory | null = null;
    if (isMappedIndex(mapping.category)) {
      const resolution = resolveCategory(raw.category, categoryAliases);
      category = resolution.category;
      if (resolution.error) errors.push({ field: 'category', code: resolution.error });
    }

    let amount: string | null = null;
    if (selectedMode === 'amount' && !missingMappings.has('amount')) {
      amount = parsePasteAmount(raw.amount);
      if (amount === null) errors.push({ field: 'amount', code: raw.amount.trim() ? 'invalid-amount' : 'required' });
    } else if (selectedMode === 'quantity-rate' && productAvailable) {
      const quantity = parseDecimalInput(raw.quantity);
      const rate = parseDecimalInput(raw.rate);
      if (!quantity || quantity.coefficient <= 0n) errors.push({ field: 'quantity', code: raw.quantity.trim() ? 'invalid-quantity' : 'required' });
      if (!rate || rate.coefficient <= 0n) errors.push({ field: 'rate', code: raw.rate.trim() ? 'invalid-rate' : 'required' });
      if (quantity && quantity.coefficient > 0n && rate && rate.coefficient > 0n) {
        amount = multiplyPasteAmount(raw.quantity, raw.rate);
        if (amount === null) errors.push({ field: 'amount', code: 'invalid-product' });
      }
    }

    const description = raw.description.trim() || null;
    const row = { rowNumber: source.rowNumber, raw, category, description, amount, errors };
    previewRows.push(row);
    if (errors.length === 0 && amount !== null) {
      const cents = parseExactCents(amount);
      if (cents !== null) totalCents += cents;
    }
  }

  return freezePreview(previewRows, previewErrors, totalCents);
}
