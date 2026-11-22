import { supabase } from '@/src/lib/supabase/client';
import { AppError } from '@/src/lib/appError';

/**
 * Survey record DAL (survey-cap-record; migrations 1784-1787). Reads are RLS-scoped (own organisation, never a light account); every
 * write is a SECURITY DEFINER RPC and org_id is never sent. A refusal arrives as `SVY_CODE: sentence`; the refusals catalogue
 * turns the code into the person's own words. Who took part is data: a typed name, an optional company and role, an optional account.
 */
const RECORD_LIMIT = 500;

export interface SurveyParticipantInput {
  name: string;
  company?: string;
  role?: string;
}

export interface SurveyParticipant {
  id: string;
  name: string;
  company: string | null;
  role: string | null;
}

export interface SurveyRecord {
  id: string;
  boqItemId: string;
  surveyDate: string;
  surveyedQuantity: number;
  qualityReadyQuantity: number;
  note: string | null;
  status: 'draft' | 'confirmed';
  recordedBy: string;
  recordedByName: string | null;
  confirmedByName: string | null;
  confirmBasis: string | null;
  supersedesId: string | null;
  supersededAt: string | null;
  participants: SurveyParticipant[];
  documentIds: string[];
}

export interface RecordSurveyInput {
  workOrderId: string;
  boqItemId: string;
  surveyDate: string;
  surveyedQuantity: number;
  qualityReadyQuantity: number;
  participants: SurveyParticipantInput[];
  supersedesId?: string;
  note?: string;
  documentIds?: string[];
}

function fail(error: { message: string; code?: string }): never {
  throw new AppError(error.message, error.code);
}

/** The work order's live records (not discarded), newest first; superseded ones stay in the list as history. */
export async function listSurveyRecords(workOrderId: string): Promise<SurveyRecord[]> {
  const { data, error } = await supabase.from('survey_records')
    .select('id,boq_item_id,survey_date,surveyed_quantity,quality_ready_quantity,note,status,recorded_by,confirm_basis,supersedes_id,superseded_at,recorder:profiles!recorded_by(full_name),confirmer:profiles!confirmed_by(full_name),participants:survey_participants(id,name,company,role_label),documents:survey_record_documents(document_id)')
    .eq('work_order_id', workOrderId).is('archived_at', null)
    .order('survey_date', { ascending: false }).order('recorded_at', { ascending: false }).limit(RECORD_LIMIT);
  if (error) fail(error);
  return (data ?? []).map((r) => ({
    id: r.id,
    boqItemId: r.boq_item_id,
    surveyDate: r.survey_date,
    surveyedQuantity: Number(r.surveyed_quantity),
    qualityReadyQuantity: Number(r.quality_ready_quantity),
    note: r.note,
    status: r.status === 'confirmed' ? 'confirmed' : 'draft',
    recordedBy: r.recorded_by,
    recordedByName: (r.recorder as { full_name: string | null } | null)?.full_name ?? null,
    confirmedByName: (r.confirmer as { full_name: string | null } | null)?.full_name ?? null,
    confirmBasis: r.confirm_basis,
    supersedesId: r.supersedes_id,
    supersededAt: r.superseded_at,
    participants: (r.participants ?? []).map((p) => ({ id: p.id, name: p.name, company: p.company, role: p.role_label })),
    documentIds: (r.documents ?? []).map((d) => d.document_id),
  }));
}

/** Records a draft, then attaches its documents. A refused attachment leaves the draft; the person sees why and can retry. */
export async function recordSurvey(input: RecordSurveyInput): Promise<string> {
  const { data, error } = await supabase.rpc('record_survey', {
    p_work_order: input.workOrderId,
    p_boq_item: input.boqItemId,
    p_date: input.surveyDate,
    p_surveyed: input.surveyedQuantity,
    p_quality_ready: input.qualityReadyQuantity,
    p_participants: input.participants.map((p) => ({ name: p.name, company: p.company ?? null, role: p.role ?? null })),
    ...(input.supersedesId ? { p_supersedes: input.supersedesId } : {}),
    ...(input.note ? { p_note: input.note } : {}),
  });
  if (error) fail(error);
  if (typeof data !== 'string' || data === '') throw new AppError('the server recorded the survey but returned no id', 'survey-malformed');
  for (const documentId of input.documentIds ?? []) await attachSurveyDocument(data, documentId);
  return data;
}

export async function attachSurveyDocument(id: string, documentId: string): Promise<void> {
  const { error } = await supabase.rpc('attach_survey_document', { p_id: id, p_document: documentId });
  if (error) fail(error);
}

export async function confirmSurvey(id: string): Promise<void> {
  const { error } = await supabase.rpc('confirm_survey', { p_id: id });
  if (error) fail(error);
}

export async function archiveSurveyDraft(id: string): Promise<void> {
  const { error } = await supabase.rpc('archive_survey_draft', { p_id: id });
  if (error) fail(error);
}
