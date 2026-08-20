/**
 * Bulk-import descriptor + parse/validate contracts (ADR-0027).
 *
 * The wizard is generic over an `ImportDescriptor<Input>`: it parses an `.xlsx` into
 * headers + string rows, auto-maps columns to the descriptor's target fields, validates
 * every row client-side (the dry-run oracle — ZERO writes), then on one explicit confirm
 * creates one record per VALID row via the entity's EXISTING create repository (per-row
 * best-effort). `org_id` is NEVER threaded from the client — RLS stamps + enforces it.
 *
 * v1 ships only `companyImportDescriptor`; Projects/Tasks are descriptor-only fast-follows.
 */

/** A pure cell validator: null = ok; otherwise a human-readable error message. */
export type FieldValidate = (raw: string) => string | null;

export interface ImportField<Input> {
  /** Target field key on the create `Input`. */
  key: keyof Input & string;
  /** Expected header label (auto-mapped by case/whitespace-insensitive match). */
  label: string;
  required: boolean;
  /** Required / type / enum-membership check on the raw cell string. */
  validate: FieldValidate;
}

export interface ImportDescriptor<Input> {
  /** Display name + sheet-name match ("Companies"). */
  entity: string;
  fields: ImportField<Input>[];
  /** Mapped cells → the entity's create `Input` (trims, casts; emits NO org_id). */
  toInput: (cells: Record<string, string>) => Input;
  /** The entity's existing create repository fn. RLS stamps org_id + gates the role. */
  create: (input: Input) => Promise<unknown>;
}

/** A parsed worksheet: header labels + raw data-row cell strings. */
export interface ParsedSheet {
  headers: string[];
  rows: string[][];
}

/** field.key → header column index (null = unmapped). */
export type Mapping = Record<string, number | null>;

export interface RowValidation {
  index: number;
  errors: Partial<Record<string, string>>;
  valid: boolean;
}

export interface ImportResult {
  created: number;
  /**
   * Rows a descriptor recognised as ALREADY imported and deliberately wrote nothing for
   * (`IMPORT_SKIPPED`). Counted apart from `created` because a re-run that reports "42 created"
   * having written nothing is a false signal about the one thing an idempotent importer exists to
   * demonstrate (DD-BIMP-8). Descriptors that never return the sentinel always see 0 here.
   */
  skipped: number;
  failed: { index: number; reason: string }[];
}

/**
 * A descriptor's `create` resolves to THIS when the row was already imported and nothing was
 * written. A sentinel rather than a `{ skipped: true }` shape: `create` returns `unknown`, and any
 * object literal could collide with a real created row: a unique symbol cannot.
 */
export const IMPORT_SKIPPED: unique symbol = Symbol('import.skipped');

/** Parse-time rejection: bad file, empty sheet, or over the row cap. Carries a typed `code`. */
export class ImportParseError extends Error {
  constructor(
    public readonly code: 'not_xlsx' | 'empty' | 'too_many_rows',
    message: string,
  ) {
    super(message);
    this.name = 'ImportParseError';
  }
}

/** Max data rows accepted in a single import (Director lock). Over this → parse refuses. */
export const MAX_IMPORT_ROWS = 500;
