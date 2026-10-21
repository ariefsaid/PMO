import { useCallback, useEffect, useRef } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { useAuth } from '@/src/auth/useAuth';
import { useEffectiveRole } from '@/src/auth/impersonation';
import { can } from '@/src/auth/policy';
import { useOptionalToast } from '@/src/components/ui/Toast';
import { repositories } from '@/src/lib/repositories';
import type { RecordFolderOutcome, RecordFolderTarget } from '@/src/lib/m365/recordFolders';
import {
  recordFolderErrorCopy,
  recordFolderOutcomeCopy,
  recordFolderText,
  type RecordFolderCopy,
} from '@/src/lib/m365/recordFolderCopy';
import {
  invalidateRecordFolderRegister,
  recordFolderKey,
  writeRecordFolderState,
  type RecordFolderState,
} from './recordFolderState';

/** `useEffectiveRole` throws outside its provider; a hook run in isolation must deny, not crash. */
function useRoles(): ReturnType<typeof useEffectiveRole> | null {
  try {
    return useEffectiveRole();
  } catch {
    return null;
  }
}

/**
 * Create-success coordinator (AC-M365DOC-071). A project / purchase case has just been saved; this
 * kicks off the server-side "link or create the SharePoint folder" step WITHOUT ever delaying or
 * failing the save:
 *
 *   • `start()` returns void synchronously. The ensure promise is never returned to (or awaited by)
 *     a mutation, and every rejection is caught here — a folder failure cannot reach the caller.
 *   • State is written to the query cache under an org+user+record key, so the register still shows
 *     the outcome after the create modal unmounted or the user navigated away.
 *   • It runs only because a create hook called it: no mount/refetch/reconnect auto-start, no timer,
 *     no automatic retry. The persistent retry affordance is the register's single Create button.
 *   • View-only impersonation and non-writer roles never start it (real JWT role, ADR-0016).
 */
export function useStartRecordFolder(): (target: RecordFolderTarget) => void {
  const qc = useQueryClient();
  const { currentUser } = useAuth();
  const roles = useRoles();
  const toastApi = useOptionalToast();
  const { t } = useTranslation('recordFolders');

  const orgId = currentUser?.org_id ?? null;
  const userId = currentUser?.id ?? null;
  const realRole = roles?.realRole ?? null;
  const viewOnly = !roles || roles.realRole !== roles.effectiveRole;

  // Latest values for the late-settling promise (the create dialog may be long gone by then).
  const live = useRef({ orgId, userId, toast: toastApi?.toast, t });
  useEffect(() => {
    live.current = { orgId, userId, toast: toastApi?.toast, t };
  });

  return useCallback((target: RecordFolderTarget): void => {
    try {
      if (!orgId || !userId || viewOnly) return;
      const allowed = can('create', target.kind === 'project' ? 'document' : 'procDoc', { realRole });
      if (!allowed) return;

      const key = recordFolderKey(orgId, userId, target);
      if ((qc.getQueryData(key) as RecordFolderState | undefined)?.status === 'pending') return;
      writeRecordFolderState(qc, key, { status: 'pending' });

      const sameIdentity = () => live.current.orgId === orgId && live.current.userId === userId;
      const announce = (copy: RecordFolderCopy | null) => {
        if (!sameIdentity()) return;
        const { toast, t: tr } = live.current;
        if (!toast) return;
        if (copy === null) toast(tr('status.pending', 'Creating folder…'), 'info');
        else if (copy.ok) toast(tr('status.linked', 'Folder linked'), 'success');
        else toast(tr('status.savedNotLinked', 'Record saved. Folder not linked.'), recordFolderText(tr, copy.key), 'warning');
      };
      const settle = (copy: RecordFolderCopy) => {
        try {
          writeRecordFolderState(qc, key, { status: 'settled', copy });
          if (copy.ok) invalidateRecordFolderRegister(qc, orgId, target);
          announce(copy);
        } catch {
          /* a failure to report must never surface as an unhandled rejection */
        }
      };

      announce(null);
      let pending: Promise<RecordFolderOutcome>;
      try {
        pending = Promise.resolve(repositories.m365RecordFolders.ensure(target));
      } catch (error) {
        pending = Promise.reject(error);
      }
      pending.then(
          (outcome) => settle(recordFolderOutcomeCopy(outcome)),
          (error: unknown) => settle(recordFolderErrorCopy(error)),
        );
    } catch {
      /* start() is fire-and-forget: nothing here may throw into a save-success path */
    }
  }, [qc, orgId, userId, realRole, viewOnly]);
}
