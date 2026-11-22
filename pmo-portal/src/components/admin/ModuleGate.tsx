import type { ReactNode } from 'react';
import { useModuleOn } from '@/src/hooks/useOrgSwitch';
import type { OrgModuleKey } from '@/src/lib/repositories/orgSwitches';

/** Renders its children only while the module is on (#2746): the one check a module screen, panel, field or Admin list sits behind. */
export function ModuleGate({ module, children }: { module: OrgModuleKey; children: ReactNode }) {
  return useModuleOn(module) ? <>{children}</> : null;
}
