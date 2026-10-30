import type { ProjectDocumentRow } from '@/src/lib/db/documents';

export const isMicrosoftFolder = (doc: ProjectDocumentRow) => doc.source === 'onedrive' && doc.ms_item_kind === 'folder';
