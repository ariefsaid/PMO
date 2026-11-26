import React, { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  Button, Card, CardHead, CardPad, ConfirmDialog, DataTable, EntityFormModal, FormGrid, Icon, ListState, NumberField,
  SelectField, StatusPill, TextArea, TextField, useToast, type Column,
} from '@/src/components/ui';
import { usePermission } from '@/src/auth/usePermission';
import { useEffectiveRole } from '@/src/auth/impersonation';
import { useAuth } from '@/src/auth/useAuth';
import { useUsers } from '@/src/hooks/useUsers';
import { useCrews } from '@/src/hooks/useCrews';
import { useOpenToolReports, useToolLines, useToolMayManage, useToolMutations, useToolSettings } from '@/src/hooks/useCrewTools';
import type { ToolLineRow, ToolReportRow } from '@/src/lib/repositories/crewTools';
import { crewToolRepository } from '@/src/lib/repositories/crewTools';
import { canReport, summariseLine, type ToolReport, type ToolReportKind, type ToolResolution } from '@/src/lib/crewToolQuantity';
import { FileInput } from '@/src/components/ui/FormFields';
import { formatDay } from '@/src/lib/format';
import { localToday } from '@/src/lib/efaktur';
import { useCrewToolErrorText } from './crewErrors';

const asReport = (r: ToolReportRow): ToolReport => ({ id: r.id, kind: r.kind, qty: r.qty, status: r.status, due_on: r.due_on });

/** The report sheet: kind, quantity, a photo, a note. Three taps from the crew's tools screen (NFR-CTR-001). */
const ReportSheet: React.FC<{ line: ToolLineRow; reportId: string; onSubmitted: () => void; onClose: () => void }> = ({
  line, reportId, onSubmitted, onClose,
}) => {
  const { t } = useTranslation('crewTools');
  const writeError = useCrewToolErrorText();
  const { toast } = useToast();
  const { report } = useToolMutations();
  const [kind, setKind] = useState<ToolReportKind>('damaged');
  const [qty, setQty] = useState('1');
  const [note, setNote] = useState('');
  const [photo, setPhoto] = useState<File | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const n = Number(qty);
  const check = canReport(line.held_qty, [
    { id: 'open', kind: 'lost', qty: line.damaged_qty + line.lost_qty, status: 'open', due_on: null }], n);
  const qtyError = qty.trim() !== '' && !check.ok
    ? t('crewTools:errors.exceedsUsable', 'Only {{usable}} usable. Report that many or fewer.', { usable: check.usable }) : undefined;
  const photoError = kind === 'damaged' && !photo ? t('crewTools:photoRequired', 'Add a photo of the damaged tool') : undefined;
  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    setProblem(null);
    void (async () => {
      try {
        await report.mutateAsync({ reportId, lineId: line.id, kind, qty: n, note: note.trim() || null, photos: photo ? [photo] : [] });
        onSubmitted();
        toast(t('crewTools:reported', 'Reported. The equipment coordinator has a task.'), undefined, 'success');
        onClose();
      } catch (err) { setProblem(writeError(err)); }
    })();
  };
  return (
    <EntityFormModal open title={t('crewTools:reportTitle', 'Report {{tool}}', { tool: line.name })} submitLabel={t('crewTools:send', 'Send report')}
      onSubmit={submit} onClose={onClose} loading={report.isPending} dirty={note !== '' || photo !== null}
      submitDisabled={!check.ok || photoError !== undefined} submitError={problem ? { headline: t('crewTools:notSent', 'Not sent'), detail: problem } : null}>
      <FormGrid>
        <SelectField label={t('crewTools:kind', 'What happened')} value={kind} onChange={(v) => setKind(v as ToolReportKind)}
          options={[{ value: 'damaged', label: t('crewTools:kindDamaged', 'Damaged') }, { value: 'lost', label: t('crewTools:kindLost', 'Lost') }]} />
        <NumberField label={t('crewTools:quantity', 'Quantity')} required value={qty} onChange={setQty} inputMode="numeric" error={qtyError}
          helper={t('crewTools:usableNow', '{{usable}} usable now', { usable: check.usable })} />
        <div className="flex flex-col gap-1">
          <label htmlFor="crew-tool-photo" className="text-control font-semibold text-foreground">
            {kind === 'damaged' ? t('crewTools:photoRequiredLabel', 'Photo (required)') : t('crewTools:photoOptional', 'Photo (optional)')}
          </label>
          <FileInput id="crew-tool-photo" accept="image/png,image/jpeg,image/webp" capture="environment"
            onChange={(e) => setPhoto(e.currentTarget.files?.[0] ?? null)} />
        </div>
        <TextArea label={t('crewTools:note', 'Note')} value={note} onChange={setNote} rows={2} maxLength={500} fullWidth />
      </FormGrid>
    </EntityFormModal>
  );
};

/** Add or edit a tool line (FR-CTR-001/003). */
const LineModal: React.FC<{ crewId: string; line: ToolLineRow | null; onClose: () => void }> = ({ crewId, line, onClose }) => {
  const { t } = useTranslation('crewTools');
  const writeError = useCrewToolErrorText();
  const { toast } = useToast();
  const crews = useCrews();
  const { addLine, updateLine } = useToolMutations();
  const [name, setName] = useState(line?.name ?? '');
  const [code, setCode] = useState(line?.code ?? '');
  const [serial, setSerial] = useState(line?.serial ?? '');
  const [held, setHeld] = useState(String(line?.held_qty ?? 1));
  const [note, setNote] = useState(line?.note ?? '');
  const [crew, setCrew] = useState(line?.crew_id ?? crewId);
  const [problem, setProblem] = useState<string | null>(null);
  const qty = serial.trim() ? 1 : Number(held);
  const valid = name.trim() !== '' && Number.isInteger(qty) && qty >= 1;
  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    setProblem(null);
    void (async () => {
      const input = { crew_id: crew, name: name.trim(), code: code.trim() || null, serial: serial.trim() || null, held_qty: qty, note: note.trim() || null };
      try {
        if (line) await updateLine.mutateAsync({ id: line.id, patch: input });
        else await addLine.mutateAsync(input);
        toast(line ? t('crewTools:lineSaved', 'Tool saved') : t('crewTools:lineAdded', 'Tool added'), undefined, 'success');
        onClose();
      } catch (err) { setProblem(writeError(err)); }
    })();
  };
  return (
    <EntityFormModal open title={line ? t('crewTools:editTitle', 'Edit {{tool}}', { tool: line.name }) : t('crewTools:addTitle', 'Add a tool')}
      submitLabel={line ? t('crewTools:save', 'Save') : t('crewTools:add', 'Add tool')} onSubmit={submit} onClose={onClose}
      loading={addLine.isPending || updateLine.isPending} dirty submitDisabled={!valid}
      submitError={problem ? { headline: t('crewTools:notSaved', 'Not saved'), detail: problem } : null}>
      <FormGrid>
        <TextField label={t('crewTools:name', 'Tool')} required value={name} onChange={setName} />
        <TextField label={t('crewTools:code', 'Code')} code value={code} onChange={setCode} />
        <TextField label={t('crewTools:serial', 'Serial number')} code value={serial} onChange={setSerial} helper={t('crewTools:serialHelp', 'A tool with a serial number counts as 1.')} />
        <NumberField label={t('crewTools:held', 'Held')} required value={serial.trim() ? '1' : held} onChange={setHeld} inputMode="numeric" disabled={Boolean(serial.trim())} />
        {line && (
          <SelectField label={t('crewTools:crew', 'Crew')} value={crew} onChange={setCrew}
            options={(crews.data ?? []).map((c) => ({ value: c.id, label: `${c.code} ${c.name}` }))} />
        )}
        <TextField label={t('crewTools:note', 'Note')} value={note} onChange={setNote} fullWidth />
      </FormGrid>
    </EntityFormModal>
  );
};

/** Close a report with its resolution; this is also what sets the task Done (FR-CTR-014). */
const CloseModal: React.FC<{ report: ToolReportRow; onClose: () => void }> = ({ report, onClose }) => {
  const { t } = useTranslation('crewTools');
  const writeError = useCrewToolErrorText();
  const { toast } = useToast();
  const { close } = useToolMutations();
  const [resolution, setResolution] = useState<ToolResolution>('replaced');
  const [problem, setProblem] = useState<string | null>(null);
  const options = [
    { value: 'replaced', label: t('crewTools:resolution.replaced', 'Replaced') },
    ...(report.kind === 'damaged' ? [{ value: 'repaired', label: t('crewTools:resolution.repaired', 'Repaired') }] : []),
    { value: 'written_off', label: t('crewTools:resolution.writtenOff', 'Written off') },
  ];
  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    setProblem(null);
    void (async () => {
      try {
        await close.mutateAsync({ reportId: report.id, resolution });
        toast(t('crewTools:closed', 'Report closed'), undefined, 'success');
        onClose();
      } catch (err) { setProblem(writeError(err)); }
    })();
  };
  return (
    <EntityFormModal open title={t('crewTools:closeTitle', 'Close the report on {{tool}}', { tool: report.line_name })}
      submitLabel={t('crewTools:closeSubmit', 'Close report')} onSubmit={submit} onClose={onClose} loading={close.isPending}
      submitError={problem ? { headline: t('crewTools:notSaved', 'Not saved'), detail: problem } : null}>
      <SelectField label={t('crewTools:resolutionLabel', 'How was it resolved')} value={resolution} onChange={(v) => setResolution(v as ToolResolution)} options={options} />
      <p className="mt-2 text-control text-muted-foreground">
        {resolution === 'written_off'
          ? t('crewTools:writtenOffHelp', 'The crew now holds {{qty}} fewer.', { qty: report.qty })
          : t('crewTools:restoredHelp', 'The crew can use {{qty}} more again.', { qty: report.qty })}
      </p>
    </EntityFormModal>
  );
};

/** A crew manager corrects the kind or quantity of an open report, with a reason (FR-CTR-010). */
const CorrectModal: React.FC<{ report: ToolReportRow; onClose: () => void }> = ({ report, onClose }) => {
  const { t } = useTranslation('crewTools');
  const writeError = useCrewToolErrorText();
  const { toast } = useToast();
  const { correct } = useToolMutations();
  const [kind, setKind] = useState<ToolReportKind>(report.kind);
  const [qty, setQty] = useState(String(report.qty));
  const [reason, setReason] = useState('');
  const [problem, setProblem] = useState<string | null>(null);
  const n = Number(qty);
  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    setProblem(null);
    void (async () => {
      try {
        await correct.mutateAsync({ reportId: report.id, kind, qty: n, reason: reason.trim() });
        toast(t('crewTools:corrected', 'Report corrected'), undefined, 'success');
        onClose();
      } catch (err) { setProblem(writeError(err)); }
    })();
  };
  return (
    <EntityFormModal open title={t('crewTools:correctTitle', 'Correct the report on {{tool}}', { tool: report.line_name })}
      submitLabel={t('crewTools:correctSubmit', 'Save correction')} onSubmit={submit} onClose={onClose} loading={correct.isPending}
      submitDisabled={reason.trim() === '' || !Number.isInteger(n) || n < 1}
      submitError={problem ? { headline: t('crewTools:notSaved', 'Not saved'), detail: problem } : null}>
      <FormGrid>
        <SelectField label={t('crewTools:kind', 'What happened')} value={kind} onChange={(v) => setKind(v as ToolReportKind)}
          options={[{ value: 'damaged', label: t('crewTools:kindDamaged', 'Damaged') }, { value: 'lost', label: t('crewTools:kindLost', 'Lost') }]} />
        <NumberField label={t('crewTools:quantity', 'Quantity')} required value={qty} onChange={setQty} inputMode="numeric" />
        <TextField label={t('crewTools:reason', 'Reason for the correction')} required value={reason} onChange={setReason} fullWidth />
      </FormGrid>
    </EntityFormModal>
  );
};

/** The equipment coordinator and the task's due days (FR-CTR-012): Admin and Project Manager. */
const SettingsCard: React.FC = () => {
  const { t } = useTranslation('crewTools');
  const writeError = useCrewToolErrorText();
  const { toast } = useToast();
  const settings = useToolSettings();
  const users = useUsers();
  const { setSettings } = useToolMutations();
  const [coordinator, setCoordinator] = useState<string | null>(null);
  const [days, setDays] = useState<string | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const coordValue = coordinator ?? settings.data?.coordinator_id ?? '';
  const daysValue = days ?? String(settings.data?.task_due_days ?? 3);
  const save = () => {
    setProblem(null);
    void (async () => {
      try {
        await setSettings.mutateAsync({ coordinatorId: coordValue || null, dueDays: Number(daysValue) });
        setCoordinator(null); setDays(null);
        toast(t('crewTools:settingsSaved', 'Coordinator saved'), undefined, 'success');
      } catch (err) { setProblem(writeError(err)); }
    })();
  };
  return (
    <Card className="mt-6">
      <CardHead>{t('crewTools:settingsTitle', 'Equipment coordinator')}</CardHead>
      <CardPad>
        <div className="grid gap-3 sm:grid-cols-[1fr_160px_auto] sm:items-end">
          <SelectField label={t('crewTools:coordinator', 'Gets the replacement task')} value={coordValue} onChange={setCoordinator}
            helper={coordValue === '' ? t('crewTools:noCoordinatorHelp', 'None: Admin and Project Manager users are told instead.') : undefined}
            options={[{ value: '', label: t('crewTools:noCoordinator', 'No coordinator') },
              ...(users.data ?? []).filter((u) => u.status === 'active').map((u) => ({ value: u.id, label: u.full_name ?? u.email ?? u.id }))]} />
          <NumberField label={t('crewTools:dueDays', 'Due in days')} value={daysValue} onChange={setDays} inputMode="numeric" />
          <Button variant="outline" onClick={save} disabled={setSettings.isPending || !Number.isInteger(Number(daysValue))}>{t('crewTools:save', 'Save')}</Button>
        </div>
        {problem && <p role="alert" className="mt-2 text-sm text-destructive-text">{problem}</p>}
      </CardPad>
    </Card>
  );
};

/** Photos of one report, opened through short-lived links (the bucket is private). */
const ReportPhotos: React.FC<{ reportId: string }> = ({ reportId }) => {
  const { t } = useTranslation('crewTools');
  const [links, setLinks] = useState<{ id: string; title: string; url: string }[] | null>(null);
  const [problem, setProblem] = useState(false);
  const load = () => {
    setProblem(false);
    void (async () => {
      try {
        const photos = await crewToolRepository.photos(reportId);
        setLinks(await Promise.all(photos.map(async (p) => ({ id: p.id, title: p.title ?? t('crewTools:photo', 'Photo'), url: await crewToolRepository.photoUrl(p.file_path) }))));
      } catch { setProblem(true); }
    })();
  };
  if (links === null) {
    return <Button variant="ghost" size="sm" onClick={load}>{problem ? t('crewTools:photosRetry', 'Photos did not load. Retry') : t('crewTools:photos', 'Photos')}</Button>;
  }
  if (links.length === 0) return <span className="text-control text-muted-foreground">{t('crewTools:noPhotos', 'No photo')}</span>;
  return (
    <span className="flex flex-wrap gap-2">
      {links.map((l) => <a key={l.id} href={l.url} target="_blank" rel="noreferrer" className="text-control text-primary underline">{l.title}</a>)}
    </span>
  );
};

/** Crews → Tools: each crew's counted hand tools, the report sheet and the crew's open reports (#2581). */
export const CrewTools: React.FC = () => {
  const { t } = useTranslation('crewTools');
  const writeError = useCrewToolErrorText();
  const { toast } = useToast();
  const may = usePermission();
  const { currentUser } = useAuth();
  const { realRole, effectiveRole } = useEffectiveRole();
  const viewOnly = realRole !== effectiveRole;
  const crews = useCrews();
  const users = useUsers();
  const [crewId, setCrewId] = useState<string | null>(null);
  const [reporting, setReporting] = useState<ToolLineRow | null>(null);
  const [draftReportIds, setDraftReportIds] = useState<Record<string, string>>({});
  const [editing, setEditing] = useState<ToolLineRow | 'new' | null>(null);
  const [closing, setClosing] = useState<ToolReportRow | null>(null);
  const [correcting, setCorrecting] = useState<ToolReportRow | null>(null);
  const [archiving, setArchiving] = useState<ToolLineRow | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const { updateLine } = useToolMutations();

  const openReport = (l: ToolLineRow) => {
    setDraftReportIds((prev) => (prev[l.id] ? prev : { ...prev, [l.id]: crypto.randomUUID() }));
    setReporting(l);
  };

  const crewRows = useMemo(() => crews.data ?? [], [crews.data]);
  useEffect(() => {
    if (crewId !== null || crewRows.length === 0) return;
    // A field controller lands on their own crew; everyone else on the first.
    setCrewId((crewRows.find((c) => c.field_controller_id === currentUser?.id) ?? crewRows[0]).id);
  }, [crewId, crewRows, currentUser?.id]);
  const crew = crewRows.find((c) => c.id === crewId) ?? null;
  const lines = useToolLines(crewId);
  const reports = useOpenToolReports(crewId);

  const keepsCrewSite = useToolMayManage(crewId);
  const canManage = may('manage', 'crewTool', { record: { viewOnly, keepsCrewSite } });
  const canConfigure = may('configure', 'crewTool', { record: { viewOnly } });
  const canReportHere = may('report', 'crewTool', { currentUserId: currentUser?.id, record: { field_controller_id: crew?.field_controller_id ?? null, viewOnly, keepsCrewSite } });
  const canCloseReport = (r: ToolReportRow) => may('close', 'crewTool', { currentUserId: currentUser?.id, record: { assignee_id: r.assignee_id, viewOnly } });
  const today = localToday();
  const nameOf = (id: string | null) => (id ? users.data?.find((u) => u.id === id)?.full_name ?? '—' : '—');
  const lineRows = useMemo(() => lines.data ?? [], [lines.data]);
  const reportRows = useMemo(() => reports.data ?? [], [reports.data]);
  const overdue = useMemo(() => new Set(summariseLine(0, reportRows.map(asReport), today).overdueIds), [reportRows, today]);

  const archive = () => {
    const l = archiving;
    if (!l) return;
    setArchiving(null);
    setProblem(null);
    void (async () => {
      try {
        await updateLine.mutateAsync({ id: l.id, patch: { archived_at: new Date().toISOString() } });
        toast(t('crewTools:lineArchived', 'Tool archived'), undefined, 'success');
      } catch (err) { setProblem(writeError(err)); }
    })();
  };

  const lineColumns: Column<ToolLineRow>[] = [
    { key: 'name', header: t('crewTools:name', 'Tool'), kind: 'primary', rowHeader: true,
      cell: (l) => <span>{l.name}{(l.code || l.serial) && <span className="ml-2 record-id text-muted-foreground">{l.serial ?? l.code}</span>}</span> },
    { key: 'held', header: t('crewTools:held', 'Held'), align: 'num', cell: (l) => l.held_qty },
    { key: 'damaged', header: t('crewTools:damaged', 'Damaged'), align: 'num', cell: (l) => l.damaged_qty },
    { key: 'lost', header: t('crewTools:lost', 'Lost'), align: 'num', cell: (l) => l.lost_qty },
    { key: 'usable', header: t('crewTools:usable', 'Usable'), align: 'num', cell: (l) => <strong>{l.usable_qty}</strong> },
    { key: 'report', header: t('crewTools:reportColumn', 'Report'),
      cell: (l) => (canReportHere && l.usable_qty > 0
        ? <Button variant="outline" size="sm" className="whitespace-nowrap" onClick={() => openReport(l)}>{t('crewTools:reportProblem', 'Report a problem')}</Button> : null) },
  ];
  const reportColumns: Column<ToolReportRow>[] = [
    { key: 'tool', header: t('crewTools:name', 'Tool'), kind: 'primary', rowHeader: true, cell: (r) => `${r.line_name} x${r.qty}` },
    { key: 'kind', header: t('crewTools:kindColumn', 'Type'), cell: (r) => (r.kind === 'damaged' ? t('crewTools:kindDamaged', 'Damaged') : t('crewTools:kindLost', 'Lost')) },
    { key: 'due', header: t('crewTools:due', 'Due'),
      cell: (r) => (<span>{formatDay(r.due_on)}{overdue.has(r.id) && <StatusPill variant="overdue" className="ml-2">{t('crewTools:overdue', 'Overdue')}</StatusPill>}</span>) },
    { key: 'by', header: t('crewTools:reportedBy', 'Reported by'), cell: (r) => nameOf(r.reported_by) },
    { key: 'photos', header: t('crewTools:photos', 'Photos'), cell: (r) => <ReportPhotos reportId={r.id} /> },
    { key: 'act', header: t('crewTools:actions', 'Actions'),
      cell: (r) => (
        <span className="flex gap-2">
          {canCloseReport(r) && <Button variant="outline" size="sm" onClick={() => setClosing(r)}>{t('crewTools:close', 'Close')}</Button>}
          {canManage && <Button variant="ghost" size="sm" onClick={() => setCorrecting(r)}>{t('crewTools:correct', 'Correct')}</Button>}
        </span>
      ) },
  ];

  if (crews.isPending) return <ListState variant="loading" shape="table" rows={4} />;
  if (crews.isError) return <ListState variant="error" title={t('crewTools:error', "Couldn't load crews")} onRetry={() => void crews.refetch()} retryLabel={t('crewTools:retry', 'Retry')} />;
  if (crewRows.length === 0) return <ListState variant="empty" title={t('crewTools:noCrews', 'No crews yet. Add a crew first.')} />;

  return (
    <>
      <div className="mb-4 max-w-sm">
        <SelectField label={t('crewTools:crew', 'Crew')} value={crewId ?? ''} onChange={setCrewId}
          options={crewRows.map((c) => ({ value: c.id, label: `${c.code} ${c.name}` }))} />
      </div>
      {problem && <p role="alert" className="mb-3 text-sm text-destructive-text">{problem}</p>}
      <Card>
        <CardHead actions={canManage ? <Button variant="outline" size="sm" onClick={() => setEditing('new')}><Icon name="plus" />{t('crewTools:add', 'Add tool')}</Button> : undefined}>
          {t('crewTools:linesTitle', 'Tools of {{crew}}', { crew: crew?.name ?? '' })}
        </CardHead>
        <CardPad>
          {lines.isPending ? <ListState variant="loading" shape="table" rows={3} /> : lines.isError ? (
            <ListState variant="error" title={t('crewTools:linesError', "Couldn't load this crew's tools")} onRetry={() => void lines.refetch()} retryLabel={t('crewTools:retry', 'Retry')} />
          ) : (
            <DataTable<ToolLineRow> rows={lineRows} columns={lineColumns} rowKey={(l) => l.id} tableId="crew-tools-table"
              rowMenu={(l) => (canManage
                ? [{ label: t('crewTools:edit', 'Edit'), onClick: () => setEditing(l) }, { label: t('crewTools:archive', 'Archive'), onClick: () => setArchiving(l) }] : [])}
              state={lineRows.length === 0 ? 'empty' : undefined} emptyTitle={t('crewTools:noTools', 'No tools registered for this crew')}
              emptyAction={canManage ? { label: t('crewTools:add', 'Add tool'), onClick: () => setEditing('new') } : undefined} emptyActionVariant="outline" />
          )}
        </CardPad>
      </Card>
      <Card className="mt-6">
        <CardHead>{t('crewTools:openReports', 'Open reports')}</CardHead>
        <CardPad>
          {reports.isPending ? <ListState variant="loading" shape="table" rows={2} /> : reports.isError ? (
            <ListState variant="error" title={t('crewTools:reportsError', "Couldn't load the open reports")} onRetry={() => void reports.refetch()} retryLabel={t('crewTools:retry', 'Retry')} />
          ) : (
            <DataTable<ToolReportRow> rows={reportRows} columns={reportColumns} rowKey={(r) => r.id} tableId="crew-tool-reports-table"
              state={reportRows.length === 0 ? 'empty' : undefined} emptyTitle={t('crewTools:noReports', 'Nothing damaged or lost right now')} />
          )}
        </CardPad>
      </Card>
      {canConfigure && <SettingsCard />}
      {reporting && (
        <ReportSheet
          line={reporting}
          reportId={draftReportIds[reporting.id] ?? crypto.randomUUID()}
          onSubmitted={() => {
            const lineId = reporting.id;
            setDraftReportIds((prev) => {
              const next = { ...prev };
              delete next[lineId];
              return next;
            });
          }}
          onClose={() => setReporting(null)}
        />
      )}
      {editing && crewId && <LineModal crewId={crewId} line={editing === 'new' ? null : editing} onClose={() => setEditing(null)} />}
      {closing && <CloseModal report={closing} onClose={() => setClosing(null)} />}
      {correcting && <CorrectModal report={correcting} onClose={() => setCorrecting(null)} />}
      <ConfirmDialog open={archiving !== null} title={t('crewTools:archiveTitle', 'Archive this tool?')}
        description={t('crewTools:archiveBody', '{{name}} leaves the crew\'s list. Its history stays.', { name: archiving?.name ?? '' })}
        confirmLabel={t('crewTools:archive', 'Archive')} onCancel={() => setArchiving(null)} onConfirm={archive} />
    </>
  );
};
