// renderers.ts — which renderer a document needs (FR-005/009). A pure function of the name and the source
// kind: Microsoft files are previewed by Microsoft (the server decides), private files natively or through
// Microsoft's public Office viewer, everything else falls back to Download.

export type RendererKind = 'native-pdf' | 'native-image' | 'office-online' | 'microsoft' | 'unsupported';

const IMAGE = new Set(['png', 'jpg', 'jpeg', 'webp']);
// Legacy doc/xls/ppt are best effort: previewed when the public viewer can, never promised (NFR-006).
const OFFICE = new Set(['docx', 'xlsx', 'pptx', 'doc', 'xls', 'ppt']);

export function selectRenderer(input: { name: string; source: 'private' | 'microsoft' }): RendererKind {
  if (input.source === 'microsoft') return 'microsoft';
  const base = input.name.split('/').pop() ?? '';
  const dot = base.lastIndexOf('.');
  const ext = dot < 0 ? '' : base.slice(dot + 1).toLowerCase();
  if (ext === 'pdf') return 'native-pdf';
  if (IMAGE.has(ext)) return 'native-image';
  return OFFICE.has(ext) ? 'office-online' : 'unsupported';
}

export const officeViewerUrl = (signedUrl: string): string =>
  `https://view.officeapps.live.com/op/embed.aspx?src=${encodeURIComponent(signedUrl)}`;
