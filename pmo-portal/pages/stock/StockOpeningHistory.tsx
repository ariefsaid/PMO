import React, { useMemo, useRef, useState } from 'react';
import { Link, useNavigate } from 'react-router';
import { useTranslation } from 'react-i18next';
import { useMutation, useQuery } from '@tanstack/react-query';
import { Button, DataTable, DateField, ListPage, ListState, useToast, type Column } from '@/src/components/ui';
import { FileInput } from '@/src/components/ui/FormFields';
import { StockTabs } from '@/src/components/stock/StockTabs';
import { usePermission } from '@/src/auth/usePermission';
import { useEffectiveRole } from '@/src/auth/impersonation';
import { useAuth } from '@/src/auth/useAuth';
import { repositories } from '@/src/lib/repositories';
import { useRefusalText } from '@/src/lib/refusals';
import { useOrgCurrency } from '@/src/hooks/useOrgCurrency';
import { formatQuantity, formatStockValue } from '@/src/lib/stockFormat';
import { getNumberLocale } from '@/src/lib/locale/activeLocale';
import { triggerBlobDownload } from '@/src/lib/download';
import { exportFilename } from '@/src/lib/export';
import { autoMap, parseWorkbook, rowToCells, validateRows } from '@/src/lib/import';
import { buildTemplateWorkbook } from '@/src/lib/import/templateFile';
import { ImportParseError } from '@/src/lib/import/types';
import { makeStockMovementHistoryDescriptor, movementRowFromCells, STOCK_MOVEMENT_MAX_ROWS, type StockMovementRow } from '@/src/lib/import/stockMovementHistoryDescriptor';
import type { OpeningPreviewRow } from '@/src/lib/db/stockOpening';

const XLSX_MIME = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
const MAX_SHOWN_CLIENT_ERRORS = 100;

interface ClientError { row: number; column: string; message: string }
interface LoadedFile { id: number; name: string; rows: StockMovementRow[]; clientErrors: ClientError[]; problem: string | null }
interface Closing { key: string; location: string; item: string; qty: number; value: number | null; zeroCost: boolean }

const todayIso = (): string => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};

/** The last accepted row per location and item, in the order the database applied them (date, then file order). */
function closingBalances(rows: readonly OpeningPreviewRow[]): Closing[] {
  const last = new Map<string, OpeningPreviewRow>();
  for (const r of rows) {
    if (r.verdict !== 'ok' || r.locationCode === null || r.itemCode === null) continue;
    const key = `${r.locationCode}\u0000${r.itemCode}`;
    const prev = last.get(key);
    if (!prev || (r.occurredOn ?? '') > (prev.occurredOn ?? '') || ((r.occurredOn ?? '') === (prev.occurredOn ?? '') && r.rowNo > prev.rowNo)) last.set(key, r);
  }
  return [...last.entries()]
    .map(([key, r]) => ({ key, location: r.locationCode ?? '', item: r.itemCode ?? '', qty: r.runQty ?? 0, value: r.runVal, zeroCost: r.zeroCost }))
    .sort((a, b) => a.location.localeCompare(b.location) || a.item.localeCompare(b.item));
}

/**
 * Opening stock with movement history (docs/specs/opening-stock-history.spec.md): an Admin loads the dated in-and-out movements of
 * each item and location from one template. Nothing posts until the preview is clean and the Admin confirms; the database runs the
 * same checks for the preview and the confirm.
 */
const StockOpeningHistory: React.FC = () => {
  const { t } = useTranslation(['stock', 'import']);
  const may = usePermission();
  const { realRole, effectiveRole } = useEffectiveRole();
  const { toast } = useToast();
  const refusal = useRefusalText();
  const navigate = useNavigate();
  const currency = useOrgCurrency();
  const loc = getNumberLocale();
  const orgId = useAuth().currentUser?.org_id;
  const canLoad = may('manage', 'warehouse', { record: { viewOnly: realRole !== effectiveRole } });
  const descriptor = useMemo(() => makeStockMovementHistoryDescriptor(t), [t]);

  const [asOf, setAsOf] = useState('');
  const [file, setFile] = useState<LoadedFile | null>(null);
  const [loaded, setLoaded] = useState<number | null>(null);
  const requestId = useRef<string>('');
  const seq = useRef(0);

  const ready = Boolean(file) && file!.problem === null && file!.clientErrors.length === 0 && asOf !== '';
  const preview = useQuery({
    queryKey: ['stock-opening-preview', orgId, file?.id, asOf],
    queryFn: () => repositories.stockOpening.preview(asOf, file?.rows ?? []),
    enabled: ready && canLoad,
    retry: false,
    gcTime: 0,
  });
  const confirm = useMutation({
    mutationFn: () => repositories.stockOpening.load(asOf, file?.rows ?? [], requestId.current),
    onSuccess: (ids) => { setLoaded(ids.length); setFile(null); },
    onError: (err) => { const r = refusal(err); toast(r.headline, r.detail || undefined, 'warning'); },
  });

  const selectFile = async (f: File) => {
    setLoaded(null);
    const id = ++seq.current;
    requestId.current = crypto.randomUUID();
    try {
      const sheet = await parseWorkbook(await f.arrayBuffer(), STOCK_MOVEMENT_MAX_ROWS);
      const mapping = autoMap(sheet.headers, descriptor.fields);
      const missing = descriptor.fields.find((x) => x.required && mapping[x.key] == null);
      if (missing) { setFile({ id, name: f.name, rows: [], clientErrors: [], problem: t('stock:opening.errors.missingColumn', { column: missing.label }) }); return; }
      const checks = validateRows(sheet.rows, descriptor.fields, mapping);
      const clientErrors: ClientError[] = checks.flatMap((c) => Object.entries(c.errors).map(([key, message]) => ({
        row: c.index + 1, column: descriptor.fields.find((x) => x.key === key)?.label ?? key, message: message ?? '',
      })));
      const rows = sheet.rows.map((r) => movementRowFromCells(rowToCells(r, descriptor.fields, mapping)));
      setFile({ id, name: f.name, rows, clientErrors, problem: null });
    } catch (err) {
      const tooMany = err instanceof ImportParseError && err.code === 'too_many_rows';
      setFile({ id, name: f.name, rows: [], clientErrors: [], problem: tooMany ? t('stock:opening.errors.tooMany', { max: formatQuantity(String(STOCK_MOVEMENT_MAX_ROWS), loc) }) : t('stock:opening.errors.file') });
    }
  };

  const downloadTemplate = () => {
    void buildTemplateWorkbook(descriptor, {
      sheet: t('import:template.sheet', 'Template'), notes: t('import:template.notes', 'Notes'), field: t('import:template.field', 'Field'),
      required: t('import:template.required', 'Required'), optional: t('import:template.optional', 'Optional'),
      meaning: t('import:template.meaning', 'Meaning'), accepted: t('import:template.accepted', 'Accepted values'),
      rowCap: t('import:template.rowCap', 'Up to {{max}} rows per file.'),
    }).then((buf) => triggerBlobDownload(new Blob([buf], { type: XLSX_MIME }), exportFilename('opening-stock-template')));
  };

  const rows = useMemo(() => preview.data ?? [], [preview.data]);
  const refused = rows.filter((r) => r.verdict === 'refused').length;
  const closing = useMemo(() => closingBalances(rows), [rows]);
  const previewing = ready && preview.isPending;

  const blocker = !file ? t('stock:opening.confirm.noFile')
    : file.problem || file.clientErrors.length > 0 ? t('stock:opening.confirm.fixFile')
    : asOf === '' ? t('stock:opening.confirm.noDate')
    : preview.isError ? t('stock:opening.confirm.checkFailed')
    : previewing ? t('stock:opening.confirm.checking')
    : refused > 0 ? t('stock:opening.confirm.refused', { count: refused })
    : null;

  const templateColumns: Column<(typeof descriptor.fields)[number]>[] = [
    { key: 'column', header: t('stock:opening.template.column'), rowHeader: true, cell: (f) => <span className="font-medium text-foreground">{f.label}</span> },
    { key: 'required', header: t('stock:opening.template.required'), cell: (f) => <span className="text-sm">{f.required ? t('stock:opening.template.yes') : t('stock:opening.template.no')}</span> },
    { key: 'holds', header: t('stock:opening.template.holds'), cell: (f) => <span className="text-sm text-muted-foreground">{f.hint ?? ''}</span> },
  ];
  const errorColumns: Column<ClientError>[] = [
    { key: 'row', header: t('stock:opening.preview.row'), align: 'num', cell: (e) => <span className="tabular-nums">{e.row}</span> },
    { key: 'column', header: t('stock:opening.preview.column'), cell: (e) => e.column },
    { key: 'message', header: t('stock:opening.preview.status'), cell: (e) => <span className="text-sm text-destructive-text">{e.message}</span> },
  ];
  const verdictText = (r: OpeningPreviewRow): string => {
    if (r.verdict === 'ok') return t('stock:opening.preview.accepted');
    const code = (r.message ?? '').split(':')[0];
    return refusal({ message: `${code}: ` }).headline;
  };
  const previewColumns: Column<OpeningPreviewRow>[] = [
    { key: 'row', header: t('stock:opening.preview.row'), align: 'num', cell: (r) => <span className="tabular-nums">{r.rowNo}</span> },
    { key: 'date', header: t('stock:opening.preview.date'), cell: (r) => <span className="tabular-nums">{r.occurredOn ?? ''}</span> },
    { key: 'location', header: t('stock:opening.preview.location'), cell: (r) => r.locationCode ?? '' },
    { key: 'item', header: t('stock:opening.preview.item'), cell: (r) => r.itemCode ?? '' },
    { key: 'direction', header: t('stock:opening.preview.direction'), cell: (r) => (r.direction === 'out' ? t('stock:opening.preview.out') : r.direction === 'in' ? t('stock:opening.preview.in') : '') },
    { key: 'quantity', header: t('stock:opening.preview.quantity'), align: 'num', cell: (r) => <span className="tabular-nums">{r.quantity === null ? '' : formatQuantity(String(r.quantity), loc)}</span> },
    { key: 'status', header: t('stock:opening.preview.status'), cell: (r) => <span className={r.verdict === 'ok' ? 'text-sm text-muted-foreground' : 'text-sm font-medium text-destructive-text'}>{verdictText(r)}</span> },
  ];
  const closingColumns: Column<Closing>[] = [
    { key: 'location', header: t('stock:opening.preview.location'), rowHeader: true, cell: (c) => c.location },
    { key: 'item', header: t('stock:opening.preview.item'), cell: (c) => c.item },
    { key: 'qty', header: t('stock:opening.preview.quantity'), align: 'num', cell: (c) => <span className="tabular-nums">{formatQuantity(String(c.qty), loc)}</span> },
    { key: 'value', header: t('stock:opening.closing.value'), align: 'num', cell: (c) => (c.zeroCost ? <span className="text-sm text-muted-foreground">{t('stock:opening.closing.clientSupplied')}</span> : <span className="tabular-nums">{formatStockValue(c.value === null ? null : String(c.value), currency, loc)}</span>) },
  ];

  return (
    <ListPage title={t('stock:opening.title')}>
      <div className="mb-3 flex flex-wrap items-center gap-x-4 gap-y-1 text-sm">
        <Link to="/stock/setup" className="touch-target inline-flex min-h-9 items-center rounded-sm font-medium text-primary-text underline underline-offset-4 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring">
          {t('stock:opening.backToSetup')}
        </Link>
      </div>
      <StockTabs />
      {!canLoad ? (
        <ListState variant="empty" icon="folder" title={t('stock:opening.notAdmin.title')} sub={t('stock:opening.notAdmin.sub')} />
      ) : loaded !== null ? (
        <ListState variant="empty" icon="folder" title={t('stock:opening.done.title')} sub={t('stock:opening.done.sub', { count: loaded })}
          action={{ label: t('stock:opening.done.openLedger'), onClick: () => navigate('/stock/ledger') }} />
      ) : (
        <div className="flex flex-col gap-6">
          <section aria-labelledby="osh-template" className="flex flex-col gap-3">
            <h2 id="osh-template" className="text-base font-semibold text-foreground">{t('stock:opening.template.title')}</h2>
            <DataTable
              rows={descriptor.fields} columns={templateColumns} rowKey={(f) => f.key} tableId="stock-opening-template" accessibleName={t('stock:opening.template.title')}
              mobileCardTitle={(f) => <span className="block min-h-11 font-semibold text-foreground">{f.label}</span>}
              mobileCardDetails={(f) => (
                <dl className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-3 gap-y-0.5 text-control">
                  <dt className="text-muted-foreground">{t('stock:opening.template.required')}</dt><dd>{f.required ? t('stock:opening.template.yes') : t('stock:opening.template.no')}</dd>
                  <dt className="text-muted-foreground">{t('stock:opening.template.holds')}</dt><dd className="min-w-0">{f.hint ?? ''}</dd>
                </dl>
              )}
            />
            <div><Button variant="outline" size="sm" onClick={downloadTemplate} data-testid="opening-download-template">{t('stock:opening.template.download')}</Button></div>
          </section>

          <section aria-labelledby="osh-file" className="flex flex-col gap-3">
            <h2 id="osh-file" className="text-base font-semibold text-foreground">{t('stock:opening.file.title')}</h2>
            <div className="max-w-xs">
              <DateField label={t('stock:opening.asOf')} value={asOf} onChange={setAsOf} max={todayIso()} required />
            </div>
            <div className="flex flex-wrap items-center gap-3">
              <label className="inline-flex">
                <span className="touch-target inline-flex min-h-9 cursor-pointer items-center rounded-md border border-border px-3 text-sm font-medium text-foreground focus-within:outline focus-within:outline-2 focus-within:outline-ring">
                  {file ? t('stock:opening.file.change') : t('stock:opening.file.choose')}
                </span>
                <FileInput
                  accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" className="sr-only" data-testid="opening-file"
                  aria-label={t('stock:opening.file.choose')}
                  onChange={(e) => { const f = e.target.files?.[0]; if (f) void selectFile(f); e.target.value = ''; }}
                />
              </label>
              {file && <span className="text-sm text-muted-foreground">{file.name} · {t('stock:opening.file.rows', { count: file.rows.length })}</span>}
            </div>
            {file?.problem && <p role="alert" className="text-sm font-medium text-destructive-text">{file.problem}</p>}
          </section>

          {file && file.clientErrors.length > 0 && (
            <section aria-labelledby="osh-errors" className="flex flex-col gap-3">
              <h2 id="osh-errors" className="text-base font-semibold text-foreground">{t('stock:opening.preview.title')}</h2>
              <DataTable rows={file.clientErrors.slice(0, MAX_SHOWN_CLIENT_ERRORS)} columns={errorColumns} rowKey={(e) => `${e.row}-${e.column}`} tableId="stock-opening-file-errors" accessibleName={t('stock:opening.preview.title')}
                mobileCardTitle={(e) => <span className="block min-h-11 font-semibold text-foreground">{t('stock:opening.preview.rowN', { n: e.row })} · {e.column}</span>}
                mobileCardDetails={(e) => <p className="text-sm text-destructive-text">{e.message}</p>} />
            </section>
          )}

          {ready && (
            <section aria-labelledby="osh-preview" className="flex flex-col gap-3">
              <h2 id="osh-preview" className="text-base font-semibold text-foreground">{t('stock:opening.preview.title')}</h2>
              {previewing && <div className="rounded-lg border border-border bg-card"><ListState variant="loading" rows={4} /></div>}
              {preview.isError && (
                <p role="alert" className="text-sm font-medium text-destructive-text">{refusal(preview.error).headline}</p>
              )}
              {preview.isSuccess && (
                <>
                  <p className="text-sm text-muted-foreground">
                    {t('stock:opening.preview.summary', { accepted: rows.length - refused, refused })}
                  </p>
                  <DataTable<OpeningPreviewRow>
                    rows={rows} columns={previewColumns} rowKey={(r) => String(r.rowNo)} tableId="stock-opening-preview" accessibleName={t('stock:opening.preview.title')}
                    mobileCardTitle={(r) => <span className="block min-h-11 font-semibold text-foreground">{t('stock:opening.preview.rowN', { n: r.rowNo })} · {r.itemCode ?? ''}</span>}
                    mobileCardDetails={(r) => (
                      <dl className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-3 gap-y-0.5 text-control">
                        <dt className="text-muted-foreground">{t('stock:opening.preview.location')}</dt><dd>{r.locationCode ?? ''}</dd>
                        <dt className="text-muted-foreground">{t('stock:opening.preview.date')}</dt><dd className="tabular-nums">{r.occurredOn ?? ''}</dd>
                        <dt className="text-muted-foreground">{t('stock:opening.preview.quantity')}</dt><dd className="tabular-nums">{r.quantity === null ? '' : formatQuantity(String(r.quantity), loc)}</dd>
                        <dt className="text-muted-foreground">{t('stock:opening.preview.status')}</dt><dd className={r.verdict === 'ok' ? '' : 'font-medium text-destructive-text'}>{verdictText(r)}</dd>
                      </dl>
                    )}
                  />
                  {closing.length > 0 && (
                    <>
                      <h3 className="text-sm font-semibold text-foreground">{t('stock:opening.closing.title')}</h3>
                      <DataTable<Closing>
                        rows={closing} columns={closingColumns} rowKey={(c) => c.key} tableId="stock-opening-closing" accessibleName={t('stock:opening.closing.title')}
                        mobileCardTitle={(c) => <span className="block min-h-11 font-semibold text-foreground">{c.location} · {c.item}</span>}
                        mobileCardDetails={(c) => (
                          <dl className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-3 gap-y-0.5 text-control">
                            <dt className="text-muted-foreground">{t('stock:opening.preview.quantity')}</dt><dd className="tabular-nums">{formatQuantity(String(c.qty), loc)}</dd>
                            <dt className="text-muted-foreground">{t('stock:opening.closing.value')}</dt>
                            <dd>{c.zeroCost ? t('stock:opening.closing.clientSupplied') : formatStockValue(c.value === null ? null : String(c.value), currency, loc)}</dd>
                          </dl>
                        )}
                      />
                    </>
                  )}
                </>
              )}
            </section>
          )}

          <div className="flex flex-wrap items-center gap-3">
            <Button variant="primary" disabled={blocker !== null || confirm.isPending} onClick={() => confirm.mutate()} aria-describedby={blocker ? 'osh-blocker' : undefined} data-testid="opening-confirm">
              {t('stock:opening.confirm.button')}
            </Button>
            {blocker && <span id="osh-blocker" className="text-sm text-muted-foreground">{blocker}</span>}
          </div>
        </div>
      )}
    </ListPage>
  );
};

export default StockOpeningHistory;
