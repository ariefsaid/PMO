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
  /**
   * Internal field (e.g. the contract line's import key, DD-CQ-7): still mapped + validated, but held
   * OUT of the preview table's columns (#1278 round A item 6). The Row number already identifies a row;
   * an error on a hidden field surfaces under the row's Status so the refusal is never silent.
   */
  hideInPreview?: boolean;
  /** A figure: right-aligned, tabular, never wrapped, in the wide preview (#1278 round B). */
  numeric?: boolean;
  /** Other header texts that map to this field (a sheet made before a label was renamed, either language). */
  aliases?: string[];
  /** The phone card's heading already names this field's value, so the card's detail list leaves it out. */
  inRowTitle?: boolean;
  /** One short line under the field's label in the match-columns step: what the column holds, in plain words. */
  hint?: string;
  /**
   * The cell as the reader's language shows it (#1278 round C): the PARSED value through the app's number
   * formatter, so what the preview shows is what the import will write. `null` = the cell cannot be read, and
   * the preview keeps the file's own text (the row carries its error).
   */
  format?: (raw: string) => string | null;
  /** Column width in px in the wide preview (all columns, with Row 64 and Status 240, must sum to the dialog body, 1088px at most). */
  previewSize?: number;
}

export interface ImportDescriptor<Input> {
  /** Display name + sheet-name match ("Companies"). */
  entity: string;
  /**
   * OPTIONAL entity word for the wizard's title and Import button, in the reader's language, already
   * lowercased the way the title reads it ("contract lines" → "Impor baris kontrak", #1278 round A item 4).
   * ABSENT → the wizard falls back to `entity.toLowerCase()`, which keeps the analytics + table-id keys
   * that read `entity` stable in every locale.
   */
  entityDisplay?: string;
  /** The same word for exactly one record ("contract line"): the Import button's singular. ABSENT → `entityDisplay`. */
  entityDisplayOne?: string;
  /** What a phone preview card is headed by (item code and description); empty/absent → "Row n". */
  rowTitle?: (cells: Record<string, string>) => string;
  /**
   * OPTIONAL wide preview (#1278 round B): a wider dialog whose preview table fits without sideways scroll, one
   * line per cell (long text truncates, full text in `title`), and every row error in plain words under the
   * row's Status instead of under each cell. Needs every error message to name its field, and a
   * `previewSize` on each field. ABSENT → the narrow dialog with errors under their cell.
   */
  wide?: boolean;
  fields: ImportField<Input>[];
  /** OPTIONAL row cap for this entity's sheet; ABSENT → `MAX_IMPORT_ROWS`. A large reference list (the rate catalogue, #2520) sets it. */
  maxRows?: number;
  /**
   * OPTIONAL cross-field row rule, run after every per-cell `validate` (#513).
   *
   * Some constraints are not properties of one cell: 0197's
   * `check (contract_value = 0 or (tax_treatment is not null and tax_amount is not null))` is a
   * relationship BETWEEN cells, so no `FieldValidate` can see it. Returns a sparse map keyed by
   * `field.key`, merged into the row's errors — key it to the field the user must fix so the
   * preview shows the message on that column.
   *
   * ⛔ This runs at PREVIEW, where the row is rejected with ZERO writes. The DB would reject it
   * too, but only after the commit had started writing the rest of the sheet; preview being the
   * oracle is the importer's whole contract.
   */
  //  ⚑ Keyed to `keyof Input`, not `string`. The wizard renders an error only via `errors[field.key]`,
  //  so a typo'd key would mark the row INVALID with no message on any column — an unfixable row from
  //  the user's side, and invisible from here.
  validateRow?: (cells: Record<string, string>) => Partial<Record<keyof Input & string, string>>;
  /**
   * OPTIONAL whole-sheet rule: sees every row's cells at once (for constraints between rows, e.g. a key
   * repeated in one sheet). Returns one sparse error map per row, same shape as `validateRow`, merged
   * after it. Runs at preview with ZERO writes.
   */
  validateSheet?: (rows: Record<string, string>[]) => Partial<Record<keyof Input & string, string>>[];
  /**
   * OPTIONAL (#1278 round D): the records already on the target, read ONCE when the preview opens, so a row that
   * will be skipped is flagged and left out of the count and the button instead of promised as "Valid". RLS decides
   * what the read returns; no org id comes from the client. The insert-time skip (`IMPORT_SKIPPED`) stays as the
   * backstop for a record added between preview and import. A failed read never blocks the import.
   */
  existingKeys?: {
    load: () => Promise<Iterable<string>>;
    /** The row's key, written exactly as `create` writes it. */
    keyOf: (cells: Record<string, string>) => string;
    /** Under a flagged row's Status. */
    alreadyThere: string;
    /** One line when `load` failed. */
    unavailable: string;
    /** The disabled button's reason, when no row is left to import. */
    nothingNew: string;
  };
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
  /** The row's key is already on the target (`existingKeys`): not valid, not an error; it will be skipped. */
  already?: boolean;
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
  /** Which rows were skipped (0-based sheet row indexes), so the result can name them. */
  skippedIndexes: number[];
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
    public readonly code: 'not_xlsx' | 'empty' | 'too_many_rows' | 'too_many_columns' | 'fileTooLarge' | 'emptyFile' | 'unsupportedFile' | 'invalidCsv',
    message: string,
  ) {
    super(message);
    this.name = 'ImportParseError';
  }
}

/** Max data rows accepted in a single import (Director lock). Over this → parse refuses. */
export const MAX_IMPORT_ROWS = 500;
