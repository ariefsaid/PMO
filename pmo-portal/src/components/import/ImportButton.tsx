import React, { useState } from 'react';
import { Button, Icon } from '@/src/components/ui';
import { usePermission } from '@/src/auth/usePermission';
import type { Entity } from '@/src/auth/policy';
import type { ImportDescriptor } from '@/src/lib/import';
import { ImportWizard } from './ImportWizard';

/**
 * ImportButton — shared opt-in bulk-import affordance, mirroring `<ExportButton>` (ADR-0027).
 * Drop into a page `<Toolbar>` beside Export:
 *   <ImportButton entity="company" descriptor={companyImportDescriptor} onImported={refetch} />
 *
 * RBAC: rendered ONLY when the REAL role may `create` the entity (FR-IMP-006) — `usePermission`
 * binds to the real JWT role, never the impersonated one. This hides the affordance for clarity;
 * RLS `companies_write` WITH CHECK remains the write authority (a non-writer's row insert still
 * returns 42501 even if the UI were bypassed). On a successful import the wizard close calls
 * `onImported` so the parent refetches its list.
 */
export interface ImportButtonProps<Input> {
  /** The policy entity key (e.g. 'company') gated via can('create', entity). */
  entity: Entity;
  /** The import descriptor (display label, field schema, create fn). */
  descriptor: ImportDescriptor<Input>;
  /** Called when the wizard closes after at least one row was created (drives a list refetch). */
  onImported?: () => void;
  className?: string;
}

export function ImportButton<Input>({
  entity,
  descriptor,
  onImported,
  className,
}: ImportButtonProps<Input>) {
  const may = usePermission();
  const [open, setOpen] = useState(false);

  // FR-IMP-006: hide (not disable) the affordance for a non-create role.
  if (!may('create', entity)) return null;

  return (
    <>
      <Button variant="outline" onClick={() => setOpen(true)} className={className}>
        <Icon name="upload" />
        Import
      </Button>
      {open && (
        <ImportWizard
          descriptor={descriptor}
          onClose={(didImport) => {
            setOpen(false);
            if (didImport) onImported?.();
          }}
        />
      )}
    </>
  );
}
