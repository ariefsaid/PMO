import { useAuth } from '@/src/auth/useAuth';
import { usePermission } from '@/src/auth/usePermission';
import { useEffectiveRole } from '@/src/auth/impersonation';

export function useDocumentLinkPermissions() {
  const { currentUser } = useAuth();
  const may = usePermission();
  const { realRole, effectiveRole } = useEffectiveRole();
  const writable = realRole !== null && realRole === effectiveRole;
  return {
    projectCreate: () => writable && may('create', 'document'),
    projectEdit: (authorId: string | null, status: string) => writable && status === 'Draft' && may('edit', 'document', { currentUserId: currentUser?.id, record: { author_id: authorId } }),
    procurementCreate: () => writable && may('create', 'procDoc'),
    procurementEdit: () => writable && may('edit', 'procDoc'),
    budgetEdit: (status: string) => writable && status === 'Draft' && may('edit', 'budgetLine'),
    manageDefault: () => writable && may('manage', 'integration'),
  };
}
