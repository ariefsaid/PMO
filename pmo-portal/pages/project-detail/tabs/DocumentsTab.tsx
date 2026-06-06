import React from 'react';
import { ListState } from '@/src/components/ui';

/**
 * DEFERRED module (OQ-2). Document management is schema-ready but has no DAL/UI
 * yet; the legacy mock upload is intentionally NOT ported (no fake rows, no
 * disabled-upload theatre). The on-brand ListState placeholder teaches what's
 * coming.
 */
const DocumentsTab: React.FC = () => (
  <div className="rounded-lg border border-border bg-card">
    <ListState
      variant="empty"
      icon="doc"
      title="Document management is coming soon"
      sub="Drawings, transmittals, and submittals will live here with revision tracking."
    />
  </div>
);

export default DocumentsTab;
