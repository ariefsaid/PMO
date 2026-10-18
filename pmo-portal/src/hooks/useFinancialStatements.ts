import { useEffect, useMemo, useRef, useState, type Dispatch, type SetStateAction } from 'react';
import {
  useQuery,
  useQueryClient,
  type UseQueryResult,
} from '@tanstack/react-query';
import { useAuth } from '@/src/auth/useAuth';
import { usePermission } from '@/src/auth/usePermission';
import { useEffectiveRole } from '@/src/auth/impersonation';
import type { FinancialStatementCatalogue, FinancialStatementRead } from '@/src/lib/financialStatements';
import type { GetFinancialStatementInput } from '@/src/lib/db/financialStatements';
import { repositories } from '@/src/lib/repositories';

const FEATURE_KEY = ['financial-statements'] as const;
const ACCESS_LOSS_CODES = new Set(['42501', 'PGRST301', 'PGRST302', '28000', '28P01']);

type FinancialStatementCatalogueScope =
  | { kind: 'company' }
  | { kind: 'project'; projectId: string };

type GuardedQueryResult<T> = Omit<UseQueryResult<T, Error>, 'data'> & {
  data: T | undefined;
  /** True only while active auth and the real-role policy permit this scope. */
  eligible: boolean;
  /** True after an eligible query has completed; inspect the repository envelope for its state. */
  ready: boolean;
};

type AuthFence = {
  signature: string;
  epoch: number;
};

type LiveAuth = {
  identity: string;
  epoch: number;
  eligible: boolean;
};

type RequestGuard = {
  key: string;
  authEligible: boolean;
  enabled: boolean;
};

class QueryAdmissionDenied extends Error {
  constructor() {
    super('Statement request is not available.');
    this.name = 'QueryAdmissionDenied';
  }
}

function errorCode(error: unknown): string | undefined {
  if (typeof error !== 'object' || error === null || !('code' in error)) return undefined;
  const code = error.code;
  return typeof code === 'string' ? code : undefined;
}

function isAccessLoss(error: unknown): boolean {
  const code = errorCode(error);
  return code !== undefined && ACCESS_LOSS_CODES.has(code);
}

function keyToken(key: readonly unknown[]): string {
  return JSON.stringify(key);
}

/**
 * Retire only this feature's now-unused keys. A same-key observer keeps the shared query alive
 * during scope changes; identity/access retirement is forced only after that scope is no longer valid.
 */
function retireQueries(
  queryClient: ReturnType<typeof useQueryClient>,
  prefix: readonly unknown[],
  exactKey?: readonly unknown[],
  forceRetirement = false,
): void {
  queueMicrotask(() => {
    const candidates = queryClient.getQueryCache().findAll({ queryKey: prefix });
    for (const query of candidates) {
      if (exactKey && keyToken(query.queryKey) !== keyToken(exactKey)) continue;
      if (query.getObserversCount() > 0 && !forceRetirement) continue;
      void queryClient.cancelQueries({ queryKey: query.queryKey, exact: true });
      queryClient.removeQueries({ queryKey: query.queryKey, exact: true });
    }
  });
}

function useLiveAuth() {
  const { session, currentUser, loading, profileError } = useAuth();
  const { realRole } = useEffectiveRole();
  const may = usePermission();
  const sessionUserId = session?.user.id ?? null;
  const profileUserId = currentUser?.id ?? null;
  const orgId = currentUser?.org_id ?? null;
  const sessionMatches = sessionUserId !== null && profileUserId === sessionUserId;
  const roleMatches = currentUser !== null && realRole !== null && currentUser.role === realRole;
  const active = currentUser?.status === 'active';
  const authEligible = !loading && profileError === null && sessionMatches &&
    typeof orgId === 'string' && orgId.trim().length > 0 && roleMatches && active;

  // The auth identity belongs in every key. The session/profile match is also represented so
  // a transitional mismatched profile cannot share another user's cached result.
  const identityParts = useMemo(
    () => [orgId, sessionUserId, profileUserId, realRole, authEligible] as const,
    [authEligible, orgId, profileUserId, realRole, sessionUserId],
  );
  const identity = keyToken(identityParts);
  const signature = keyToken([
    identity,
    authEligible,
    loading,
    profileError !== null,
    sessionMatches,
    roleMatches,
    active,
  ]);
  const fenceRef = useRef<AuthFence>({ signature, epoch: 0 });
  if (fenceRef.current.signature !== signature) {
    fenceRef.current = { signature, epoch: fenceRef.current.epoch + 1 };
  }
  const liveAuthRef = useRef<LiveAuth>({ identity, epoch: fenceRef.current.epoch, eligible: authEligible });
  liveAuthRef.current = { identity, epoch: fenceRef.current.epoch, eligible: authEligible };

  return {
    identityParts,
    identity,
    liveAuthRef,
    authEligible,
    may,
  };
}

function useRetirement(
  queryKey: readonly unknown[],
  identityPrefix: readonly unknown[],
  identity: string,
  authEligible: boolean,
  enabled: boolean,
  queryClient: ReturnType<typeof useQueryClient>,
  accessRetiredKey: string | null,
  setAccessRetiredKey: Dispatch<SetStateAction<string | null>>,
  accessLost: boolean,
): void {
  const key = keyToken(queryKey);
  const previousRef = useRef<{
    identity: string;
    identityPrefix: readonly unknown[];
    authEligible: boolean;
    key: readonly unknown[];
    keyToken: string;
    enabled: boolean;
  } | null>(null);

  useEffect(() => {
    const previous = previousRef.current;
    if (previous) {
      if (previous.identity !== identity || (previous.authEligible && !authEligible)) {
        retireQueries(queryClient, previous.identityPrefix);
      } else if (previous.keyToken !== key || (previous.enabled && !enabled)) {
        retireQueries(queryClient, previous.key, previous.key);
      }
    }
    previousRef.current = {
      identity,
      identityPrefix,
      authEligible,
      key: queryKey,
      keyToken: key,
      enabled,
    };
  }, [authEligible, enabled, identity, identityPrefix, key, queryClient, queryKey]);

  useEffect(() => {
    if (accessLost) setAccessRetiredKey(key);
  }, [accessLost, key, setAccessRetiredKey]);

  useEffect(() => {
    if (accessRetiredKey !== key) return;
    // Access loss is authoritative for this exact feature query, including all observers of
    // this same query. The hook stays disabled after removal until identity/key changes.
    retireQueries(queryClient, identityPrefix, queryKey, true);
  }, [accessRetiredKey, identityPrefix, key, queryClient, queryKey]);

  useEffect(() => {
    if (accessRetiredKey !== null && accessRetiredKey !== key) setAccessRetiredKey(null);
  }, [accessRetiredKey, key, setAccessRetiredKey]);
}

/**
 * Read the published catalogue for an already-authorized host scope. Project hosts mount this
 * hook only after their real ProjectDetail read succeeds; the supplied id is never itself a
 * visibility grant and server-side catalogue/read authorization remains authoritative.
 */
export function useFinancialStatementCatalogue(
  scope: FinancialStatementCatalogueScope,
  enabled = true,
): GuardedQueryResult<FinancialStatementCatalogue> {
  const queryClient = useQueryClient();
  const auth = useLiveAuth();
  const policyAllowed = scope.kind === 'company'
    ? auth.may('view', 'financialStatements')
    : auth.may('view', 'projectProfitLoss');
  const eligible = auth.authEligible && policyAllowed;
  const projectId = scope.kind === 'project' ? scope.projectId : null;
  const key = useMemo(
    () => [FEATURE_KEY[0], ...auth.identityParts, 'catalogue', scope.kind, projectId] as const,
    [auth.identityParts, projectId, scope.kind],
  );
  const keyId = keyToken(key);
  const identityPrefix = useMemo(() => [FEATURE_KEY[0], ...auth.identityParts] as const, [auth.identityParts]);
  const guardRef = useRef<RequestGuard>({ key: keyId, authEligible: eligible, enabled });
  guardRef.current = { key: keyId, authEligible: eligible, enabled };
  const [accessRetiredKey, setAccessRetiredKey] = useState<string | null>(null);
  const retiredRef = useRef<string | null>(null);
  const requestEnabled = eligible && enabled && accessRetiredKey !== keyId;

  const query = useQuery<FinancialStatementCatalogue, Error>({
    queryKey: key,
    enabled: requestEnabled,
    retry: false,
    queryFn: async ({ signal }) => {
      const guard = guardRef.current;
      const state = queryClient.getQueryState<FinancialStatementCatalogue, Error>(key);
      const accessDenied = retiredRef.current === keyId || isAccessLoss(state?.error);
      if (accessDenied) setAccessRetiredKey(keyId);
      if (!guard.authEligible || !guard.enabled || guard.key !== keyId || accessDenied) {
        throw new QueryAdmissionDenied();
      }
      const requestAuth = auth.liveAuthRef.current;
      if (!requestAuth.eligible) throw new QueryAdmissionDenied();
      try {
        const result = await repositories.financialStatements.catalogue(
          scope.kind === 'project' ? { projectId: scope.projectId } : {},
        );
        const currentAuth = auth.liveAuthRef.current;
        if (signal.aborted || !currentAuth.eligible || currentAuth.identity !== requestAuth.identity ||
            currentAuth.epoch !== requestAuth.epoch) {
          throw new Error('Statement request was cancelled.');
        }
        return result;
      } catch (error) {
        if (isAccessLoss(error)) {
          retiredRef.current = keyId;
          setAccessRetiredKey(keyId);
          retireQueries(queryClient, identityPrefix, key, true);
        }
        throw error;
      }
    },
  });
  const accessLost = isAccessLoss(query.error);
  useRetirement(
    key,
    identityPrefix,
    auth.identity,
    auth.authEligible,
    requestEnabled,
    queryClient,
    accessRetiredKey,
    setAccessRetiredKey,
    accessLost,
  );
  const allowedToExpose = eligible && enabled && !accessLost && accessRetiredKey !== keyId;
  return {
    ...query,
    data: allowedToExpose ? query.data : undefined,
    eligible: eligible && !accessLost && accessRetiredKey !== keyId,
    ready: allowedToExpose && query.isSuccess,
  };
}

function normalizeSelection(selection: GetFinancialStatementInput | null): {
  request: GetFinancialStatementInput | null;
  valid: boolean;
  policy: 'financialStatements' | 'projectProfitLoss' | null;
  selectedStatement: GetFinancialStatementInput['statement'] | null;
} {
  if (selection === null) return { request: null, valid: false, policy: null, selectedStatement: null };
  const isProject = selection.projectId !== undefined;
  const viewKind = selection.viewKind ?? 'account_breakdown';
  const validView = viewKind === 'account_breakdown' || viewKind === 'project_totals';
  const validScope = validView &&
    (isProject || viewKind === 'account_breakdown') &&
    (!isProject || viewKind === 'project_totals' || selection.statement === 'profit_and_loss');
  const statement = isProject && viewKind === 'project_totals'
    ? 'profit_and_loss'
    : selection.statement;
  return {
    request: {
      ...selection,
      statement,
      viewKind,
    },
    valid: validScope,
    policy: isProject && viewKind === 'project_totals' ? 'projectProfitLoss' : 'financialStatements',
    selectedStatement: selection.statement,
  };
}

/** Read one selected company/detail or project statement result through the repository seam. */
export function useFinancialStatement(
  selection: GetFinancialStatementInput | null,
  enabled = true,
): GuardedQueryResult<FinancialStatementRead> {
  const queryClient = useQueryClient();
  const auth = useLiveAuth();
  const normalized = normalizeSelection(selection);
  const policyAllowed = normalized.policy === 'financialStatements'
    ? auth.may('view', 'financialStatements')
    : normalized.policy === 'projectProfitLoss'
      ? auth.may('view', 'projectProfitLoss')
      : false;
  const eligible = auth.authEligible && normalized.valid && policyAllowed;
  const request = normalized.request;
  const isProject = request?.projectId !== undefined;
  const viewKind = request?.viewKind ?? null;
  const projectId = isProject ? request?.projectId ?? null : null;
  const periodKind = request?.periodKind ?? null;
  const periodStart = request?.periodStart ?? null;
  const requestStatement = request?.statement ?? null;
  const key = useMemo(
    () => [
      FEATURE_KEY[0],
      ...auth.identityParts,
      'read',
      viewKind,
      isProject ? 'project' : 'company',
      projectId,
      periodKind,
      periodStart,
      normalized.selectedStatement,
      requestStatement,
    ] as const,
    [auth.identityParts, isProject, normalized.selectedStatement, periodKind, periodStart, projectId, requestStatement, viewKind],
  );
  const keyId = keyToken(key);
  const identityPrefix = useMemo(() => [FEATURE_KEY[0], ...auth.identityParts] as const, [auth.identityParts]);
  const guardRef = useRef<RequestGuard>({ key: keyId, authEligible: eligible, enabled });
  guardRef.current = { key: keyId, authEligible: eligible, enabled };
  const [accessRetiredKey, setAccessRetiredKey] = useState<string | null>(null);
  const retiredRef = useRef<string | null>(null);
  const requestEnabled = eligible && enabled && request !== null && accessRetiredKey !== keyId;

  const query = useQuery<FinancialStatementRead, Error>({
    queryKey: key,
    enabled: requestEnabled,
    retry: false,
    queryFn: async ({ signal }) => {
      const guard = guardRef.current;
      const state = queryClient.getQueryState<FinancialStatementRead, Error>(key);
      const accessDenied = retiredRef.current === keyId || isAccessLoss(state?.error);
      if (accessDenied) setAccessRetiredKey(keyId);
      if (!guard.authEligible || !guard.enabled || guard.key !== keyId || request === null || accessDenied) {
        throw new QueryAdmissionDenied();
      }
      const requestAuth = auth.liveAuthRef.current;
      if (!requestAuth.eligible) throw new QueryAdmissionDenied();
      try {
        const result = await repositories.financialStatements.get(request);
        const currentAuth = auth.liveAuthRef.current;
        if (signal.aborted || !currentAuth.eligible || currentAuth.identity !== requestAuth.identity ||
            currentAuth.epoch !== requestAuth.epoch) {
          throw new Error('Statement request was cancelled.');
        }
        return result;
      } catch (error) {
        if (isAccessLoss(error)) {
          retiredRef.current = keyId;
          setAccessRetiredKey(keyId);
          retireQueries(queryClient, identityPrefix, key, true);
        }
        throw error;
      }
    },
  });
  const accessLost = isAccessLoss(query.error);
  useRetirement(
    key,
    identityPrefix,
    auth.identity,
    auth.authEligible,
    requestEnabled,
    queryClient,
    accessRetiredKey,
    setAccessRetiredKey,
    accessLost,
  );
  const allowedToExpose = eligible && enabled && !accessLost && accessRetiredKey !== keyId;
  return {
    ...query,
    data: allowedToExpose ? query.data : undefined,
    eligible: eligible && !accessLost && accessRetiredKey !== keyId,
    ready: allowedToExpose && query.isSuccess,
  };
}
