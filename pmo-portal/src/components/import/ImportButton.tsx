import React, { useState } from 'react';
import { Button, Icon } from '@/src/components/ui';
import { usePermission } from '@/src/auth/usePermission';
import type { Entity } from '@/src/auth/policy';
import type { ImportDescriptor } from '@/src/lib/import';
import { lazyWithPreload } from '@/src/lib/lazyWithPreload';
import type { ImportWizardProps } from './ImportWizard';

type ImportWizardComponent = <Input>(props: ImportWizardProps<Input>) => React.ReactElement;
const LazyImportWizard = lazyWithPreload<ImportWizardComponent>(() =>
  import('./ImportWizard').then((module) => ({ default: module.ImportWizard as ImportWizardComponent })),
);

function ImportWizardForDescriptor<Input>(props: ImportWizardProps<Input>) {
  // React.lazy erases a generic component's call signature to `unknown`; retain
  // the descriptor's type at the button boundary while using the same runtime component.
  const Component = LazyImportWizard as unknown as React.ComponentType<ImportWizardProps<Input>>;
  return <Component {...props} />;
}

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
  /** Button text. Defaults to `Import`; set it when a page carries more than one importer, because
   *  two buttons both reading "Import" is not a toolbar (DD-BIMP-4). */
  label?: string;
  className?: string;
}

export function ImportButton<Input>({
  entity,
  descriptor,
  onImported,
  label = 'Import',
  className,
}: ImportButtonProps<Input>) {
  const may = usePermission();
  const [open, setOpen] = useState(false);

  // FR-IMP-006: hide (not disable) the affordance for a non-create role.
  if (!may('create', entity)) return null;

  return (
    <>
      <Button variant="outline" onClick={() => { void LazyImportWizard.preload(); setOpen(true); }} className={className}>
        <Icon name="upload" />
        {label}
      </Button>
      {open && (
        <React.Suspense fallback={null}>
          <ImportWizardForDescriptor
            descriptor={descriptor}
            onClose={(didImport) => {
              setOpen(false);
              if (didImport) onImported?.();
            }}
          />
        </React.Suspense>
      )}
    </>
  );
}
