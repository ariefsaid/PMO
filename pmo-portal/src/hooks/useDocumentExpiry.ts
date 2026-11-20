import { useQuery } from '@tanstack/react-query';
import { repositories } from '@/src/lib/repositories';
import { useAuth } from '@/src/auth/useAuth';
import { EXPIRY_WINDOW_DAYS } from '@/src/lib/db/documentExpiry';

/** The expiry list (#2527) over the repository seam; the key carries org_id (tenant scope). */
export function useExpiringDocuments(days: number = EXPIRY_WINDOW_DAYS) {
  const orgId = useAuth().currentUser?.org_id;
  return useQuery({
    queryKey: ['document-expiry', orgId, days],
    queryFn: () => repositories.documentExpiry.listExpiring(days),
    enabled: Boolean(orgId),
  });
}

import { useMutation, useQueryClient } from '@tanstack/react-query';
import type { SubjectKind, ExpiryDocumentFields, CreateExpiryDocumentInput } from '@/src/lib/db/documentExpiry';

/** The subject's live documents (#2542); the key carries org_id (tenant scope). */
export function useSubjectDocuments(kind: SubjectKind, subjectId: string) {
  const orgId = useAuth().currentUser?.org_id;
  return useQuery({
    queryKey: ['document-expiry', orgId, 'subject', kind, subjectId],
    queryFn: () => repositories.documentExpiry.listForSubject(kind, subjectId),
    enabled: Boolean(orgId && subjectId),
  });
}
export function useDocumentTypes(kind: SubjectKind) {
  const orgId = useAuth().currentUser?.org_id;
  return useQuery({
    queryKey: ['document-types', orgId, kind],
    queryFn: () => repositories.documentExpiry.listTypes(kind),
    enabled: Boolean(orgId),
  });
}
export function usePerson(personId: string) {
  const orgId = useAuth().currentUser?.org_id;
  return useQuery({
    queryKey: ['people', orgId, personId],
    queryFn: () => repositories.documentExpiry.getPerson(personId),
    enabled: Boolean(orgId && personId),
  });
}

/** Create, edit and archive; each refreshes the subject card and the expiry list. */
export function useExpiryDocumentMutations(kind: SubjectKind, subjectId: string) {
  const qc = useQueryClient();
  const repo = repositories.documentExpiry;
  const refresh = () => qc.invalidateQueries({ queryKey: ['document-expiry'] });
  const create = useMutation({
    mutationFn: async (v: Omit<CreateExpiryDocumentInput, 'subject_kind' | 'subject_id' | 'attachment_path'> & { file: File | null }) => {
      const path = v.file ? await repo.uploadAttachment(kind, subjectId, v.file) : null;
      try {
        const { file: _file, ...rest } = v;
        return await repo.create({ ...rest, subject_kind: kind, subject_id: subjectId, attachment_path: path });
      } catch (err) { await repo.removeAttachment(path).catch(() => undefined); throw err; }
    },
    onSuccess: refresh,
  });
  const update = useMutation({
    mutationFn: async (v: { id: string; fields: ExpiryDocumentFields; file: File | null; previousPath: string | null }) => {
      const path = v.file ? await repo.uploadAttachment(kind, subjectId, v.file) : undefined;
      try {
        await repo.update(v.id, path === undefined ? v.fields : { ...v.fields, attachment_path: path });
      } catch (err) { await repo.removeAttachment(path ?? null).catch(() => undefined); throw err; }
      if (path) await repo.removeAttachment(v.previousPath).catch(() => undefined);
    },
    onSuccess: refresh,
  });
  const archive = useMutation({ mutationFn: (id: string) => repo.archive(id), onSuccess: refresh });
  return { create, update, archive };
}

// ── Administration: document types and warning days (#2614) ─────────────────────────────────────────────────────
import type { CreateDocumentTypeInput, DocumentTypeInput } from '@/src/lib/db/documentExpiry';

export function useAdminDocumentTypes() {
  const orgId = useAuth().currentUser?.org_id;
  return useQuery({
    queryKey: ['document-types', orgId, 'admin'],
    queryFn: () => repositories.documentExpiry.listAdminTypes(),
    enabled: Boolean(orgId),
  });
}
export function useDocumentWarningDays() {
  const orgId = useAuth().currentUser?.org_id;
  return useQuery({
    queryKey: ['document-warning-days', orgId],
    queryFn: () => repositories.documentExpiry.getWarningDays(),
    enabled: Boolean(orgId),
  });
}
/** Create, rename/re-role and archive a type; each refreshes every type list (the Add document picker included). */
export function useDocumentTypeMutations() {
  const qc = useQueryClient();
  const repo = repositories.documentExpiry;
  const refresh = () => qc.invalidateQueries({ queryKey: ['document-types'] });
  return {
    create: useMutation({ mutationFn: (v: CreateDocumentTypeInput) => repo.createType(v), onSuccess: refresh }),
    update: useMutation({ mutationFn: (v: { id: string; input: DocumentTypeInput }) => repo.updateType(v.id, v.input), onSuccess: refresh }),
    archive: useMutation({ mutationFn: (id: string) => repo.archiveType(id), onSuccess: refresh }),
  };
}
export function useSetDocumentWarningDays() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (days: number[]) => repositories.documentExpiry.setWarningDays(days),
    onSuccess: () => Promise.all([
      qc.invalidateQueries({ queryKey: ['document-warning-days'] }),
    ]),
  });
}
