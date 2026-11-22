import { useContext } from 'react';
import { useMutation, useQuery } from '@tanstack/react-query';
import { AuthContext } from '@/src/auth/AuthContext';
import { repositories } from '@/src/lib/repositories';
import { queryClient } from '@/src/lib/queryClient';
import type { SupplyRiskStatus } from '@/src/lib/supplyRisk';

/** #2583 — a supplier's payables-age suggestion (computed in the database; read-only). */
export function useSupplyRiskSuggestion(companyId: string | undefined, enabled = true) {
  const orgId = useContext(AuthContext)?.currentUser?.org_id;
  return useQuery(
    {
      queryKey: ['supply-risk', 'suggestion', orgId, companyId],
      queryFn: () => repositories.supplyRisk.suggestion(companyId as string),
      enabled: Boolean(companyId) && enabled,
      staleTime: 30_000,
      retry: false,
    },
    queryClient,
  );
}

/** Work orders exposed to the supplier (open orders) and its project-level orders. */
export function useSupplierExposure(companyId: string | undefined, enabled = true) {
  const orgId = useContext(AuthContext)?.currentUser?.org_id;
  return useQuery(
    {
      queryKey: ['supply-risk', 'exposure', orgId, companyId],
      queryFn: () => repositories.supplyRisk.exposure(companyId as string),
      enabled: Boolean(companyId) && enabled,
      staleTime: 30_000,
      retry: false,
    },
    queryClient,
  );
}

/** Display name of whoever last changed the supplier's status. */
export function useSupplyRiskSetterName(profileId: string | null | undefined) {
  return useQuery(
    {
      queryKey: ['supply-risk', 'setter', profileId],
      queryFn: () => repositories.supplyRisk.setterName(profileId as string),
      enabled: Boolean(profileId),
      staleTime: 60_000,
      retry: false,
    },
    queryClient,
  );
}

/** Warnings on a project's work orders (or one work order) exposed to an at_risk/inactive supplier. */
export function useSupplyRiskWarnings(scope: { projectId?: string; workOrderId?: string }) {
  const orgId = useContext(AuthContext)?.currentUser?.org_id;
  return useQuery(
    {
      queryKey: ['supply-risk', 'warnings', orgId, scope.projectId ?? null, scope.workOrderId ?? null],
      queryFn: () => repositories.supplyRisk.warnings(scope),
      enabled: Boolean(scope.projectId || scope.workOrderId),
      staleTime: 30_000,
      retry: false,
    },
    queryClient,
  );
}

/** The governed status write; refreshes the company record, the suggestion, the exposure and the warnings. */
export function useSetSupplyRiskStatus(companyId: string) {
  return useMutation(
    {
      mutationFn: (input: { status: SupplyRiskStatus; reason: string | null }) =>
        repositories.supplyRisk.setStatus(companyId, input.status, input.reason),
      onSuccess: () => {
        void queryClient.invalidateQueries({ queryKey: ['company'] });
        void queryClient.invalidateQueries({ queryKey: ['companies'] });
        void queryClient.invalidateQueries({ queryKey: ['supply-risk'] });
        void queryClient.invalidateQueries({ queryKey: ['record-history'] });
      },
    },
    queryClient,
  );
}
