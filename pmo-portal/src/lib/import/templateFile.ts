import { safeCellText } from './spreadsheetText';
import { templateMarker } from './templateVersion';
import { MAX_IMPORT_ROWS, type ImportDescriptor } from './types';

export interface TemplateLabels {
  sheet: string;
  notes: string;
  field: string;
  required: string;
  optional: string;
  meaning: string;
  accepted: string;
  rowCap: string;
}

const DEFAULT_LABELS: TemplateLabels = {
  sheet: 'Template', notes: 'Notes', field: 'Field', required: 'Required', optional: 'Optional',
  meaning: 'Meaning', accepted: 'Accepted values', rowCap: 'Up to {{max}} rows per file.',
};

/** Excel's own cap for an inline list is 255 characters; a longer list is named on Notes instead. */
const INLINE_LIST_LIMIT = 255;
const ROWS_WITH_DROPDOWN = 500;

/**
 * The template workbook (#2530): sheet 1 has the field labels as headers and one example row; sheet "Notes" lists each
 * field with whether it is required, what it holds and its accepted values. The version marker rides in the file's
 * properties, so no extra column appears and an upload can be checked without mis-mapping columns.
 */
export async function buildTemplateWorkbook<Input>(d: Pick<ImportDescriptor<Input>, 'entity' | 'fields' | 'template' | 'maxRows' | 'extraSheet'>, labels: Partial<TemplateLabels> = {}): Promise<ArrayBuffer> {
  const L = { ...DEFAULT_LABELS, ...labels };
  const fields = d.fields.filter((f) => !f.internal);
  const ExcelJS = (await import('exceljs')).default;
  const wb = new ExcelJS.Workbook();
  wb.keywords = templateMarker(d);
  const ws = wb.addWorksheet(L.sheet.slice(0, 31));
  ws.addRow(fields.map((f) => f.label)).font = { bold: true };
  const example = d.template?.example ?? {};
  ws.addRow(fields.map((f) => safeCellText(example[f.key] ?? '')));
  const lists = d.template?.lists ?? {};
  fields.forEach((f, i) => {
    const values = lists[f.key];
    if (!values || values.length === 0) return;
    const inline = values.join(',');
    if (inline.length > INLINE_LIST_LIMIT || values.length > 200) return;
    for (let r = 2; r <= ROWS_WITH_DROPDOWN + 1; r += 1) {
      ws.getCell(r, i + 1).dataValidation = { type: 'list', allowBlank: true, formulae: [`"${inline}"`] };
    }
  });
  ws.columns.forEach((c) => { c.width = 22; });

  // The optional child sheet (work-order scope lines) is always the SECOND worksheet: the importer reads it by position.
  if (d.extraSheet) {
    const es = wb.addWorksheet(d.extraSheet.sheet.slice(0, 31));
    es.addRow(d.extraSheet.fields.map((f) => f.label)).font = { bold: true };
    es.addRow(d.extraSheet.fields.map((f) => safeCellText(d.extraSheet!.example[f.key] ?? '')));
    es.columns.forEach((c) => { c.width = 22; });
  }

  const notes = wb.addWorksheet(L.notes.slice(0, 31));
  notes.addRow([L.field, L.required, L.meaning, L.accepted]).font = { bold: true };
  for (const f of [...fields, ...(d.extraSheet?.fields ?? [])]) {
    notes.addRow([
      safeCellText(f.label),
      f.required ? L.required : L.optional,
      safeCellText(f.hint ?? ''),
      safeCellText((lists[f.key] ?? []).join(', ')),
    ]);
  }
  notes.addRow([]);
  notes.addRow([L.rowCap.replace('{{max}}', String(d.maxRows ?? MAX_IMPORT_ROWS))]);
  notes.columns.forEach((c, i) => { c.width = i === 2 ? 60 : 24; });
  return wb.xlsx.writeBuffer() as Promise<ArrayBuffer>;
}
