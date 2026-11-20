/** A configured label can contain filesystem and spreadsheet reserved characters. */
export function safeExportLabel(label: string): string {
  // Control bytes cannot be used safely in download or spreadsheet names.
  // eslint-disable-next-line no-control-regex
  return label.replace(/[\\/*?:[\]<>"|\u0000-\u001f]/g, '-').trim() || 'Export';
}

export function safeSheetName(label: string): string {
  const name = safeExportLabel(label).slice(0, 31).replace(/^'+|'+$/g, '').trim() || 'Export';
  return name === 'History' ? 'History export' : name;
}
