import React, { useState, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { usePermission } from '@/src/auth/usePermission';
import { Button, FieldError, ListState, TextField, useToast } from '@/src/components/ui';
import { classifyMutationError } from '@/src/lib/classifyMutationError';
import {
  usePurchaseOrderSettings,
  usePurchaseOrderSettingsMutations,
} from '@/src/hooks/usePurchaseOrderSettings';

const MAX_COLLECTORS = 50;
const MAX_SIGNATURE_BLOCKS = 10;

/**
 * Purchase order print settings section (#2688) in Administration › Accounting.
 * Admin configures printable purchase order enablement, signature blocks, and
 * authorised collectors list. Non-admin users see read-only controls.
 */
export default function PurchaseOrderSettingsSection() {
  const { t } = useTranslation(['procurement', 'administration']);
  const { toast } = useToast();
  const canManage = usePermission()('manage', 'orgAccounting');
  const query = usePurchaseOrderSettings();
  const mutations = usePurchaseOrderSettingsMutations();

  const [signatureBlocks, setSignatureBlocks] = useState<string[]>([]);
  const [authorisedCollectors, setAuthorisedCollectors] = useState<string[]>([]);
  const [newCollector, setNewCollector] = useState('');
  const [newBlock, setNewBlock] = useState('');
  const [isDirty, setIsDirty] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Sync state when query data arrives
  useEffect(() => {
    if (query.data && !isDirty) {
      setSignatureBlocks(query.data.signatureBlocks);
      setAuthorisedCollectors(query.data.authorisedCollectors);
    }
  }, [query.data, isDirty]);

  const handleAddCollector = (e: React.FormEvent) => {
    e.preventDefault();
    const trimmed = newCollector.trim();
    if (!trimmed || trimmed.length > 100) return;
    if (authorisedCollectors.length >= MAX_COLLECTORS) return;
    if (authorisedCollectors.includes(trimmed)) return;

    setAuthorisedCollectors([...authorisedCollectors, trimmed]);
    setNewCollector('');
    setIsDirty(true);
  };

  const handleRemoveCollector = (collector: string) => {
    setAuthorisedCollectors(authorisedCollectors.filter((c) => c !== collector));
    setIsDirty(true);
  };

  const handleAddBlock = (e: React.FormEvent) => {
    e.preventDefault();
    const trimmed = newBlock.trim();
    if (!trimmed || trimmed.length > 80) return;
    if (signatureBlocks.length >= MAX_SIGNATURE_BLOCKS) return;
    if (signatureBlocks.includes(trimmed)) return;

    setSignatureBlocks([...signatureBlocks, trimmed]);
    setNewBlock('');
    setIsDirty(true);
  };

  const handleRemoveBlock = (block: string) => {
    setSignatureBlocks(signatureBlocks.filter((b) => b !== block));
    setIsDirty(true);
  };

  const handleSave = async () => {
    setError(null);
    try {
      await mutations.setSettings.mutateAsync({
        enabled: true,
        signatureBlocks,
        authorisedCollectors,
      });
      setIsDirty(false);
      toast(t('procurement:poSettings.savedToast', 'Purchase order settings saved'), undefined, 'success');
    } catch (err) {
      const classified = classifyMutationError(err);
      setError(classified.detail || classified.headline);
    }
  };

  return (
    <section aria-labelledby="po-print-settings-heading">
      <h2
        id="po-print-settings-heading"
        tabIndex={-1}
        className="scroll-mt-4 text-group font-semibold"
      >
        {t('procurement:poSettings.heading', 'Purchase order printing')}
      </h2>
      <p className="mt-1 text-control text-muted-foreground">
        {t(
          'procurement:poSettings.subline',
          'Configure printable purchase order formatting, signature blocks, and authorised collectors.',
        )}
      </p>

      <div className="mt-4 max-w-xl space-y-6">
        {query.isError ? (
          <ListState
            variant="error"
            title={t('procurement:poSettings.loadError', 'Couldn’t load purchase order settings')}
            onRetry={() => void query.refetch()}
          />
        ) : query.isPending ? (
          <ListState variant="loading" rows={3} />
        ) : (
          <>
            {/* Authorised Collectors List */}
            <div className="space-y-3">
              <div>
                <h3 className="text-sm font-semibold">
                  {t('procurement:poSettings.collectorsHeading', 'Authorised collectors')}
                </h3>
                <p className="text-control text-muted-foreground">
                  {t(
                    'procurement:poSettings.collectorsHelp',
                    'Named individuals authorised to collect purchased items. If empty, the document prints an open line for any collector.',
                  )}
                </p>
              </div>

              {authorisedCollectors.length === 0 ? (
                <p className="text-control text-muted-foreground">
                  {t('procurement:poSettings.noCollectors', 'No named collectors configured (open collection line).')}
                </p>
              ) : (
                <ul className="divide-y divide-border">
                  {authorisedCollectors.map((collector) => (
                    <li
                      key={collector}
                      className="flex min-h-11 items-center justify-between py-1.5 text-control"
                    >
                      <span className="font-medium">{collector}</span>
                      {canManage && (
                        <Button
                          variant="ghost"
                          size="sm"
                          aria-label={`${t('procurement:poSettings.removeCollector', 'Remove collector')}: ${collector}`}
                          onClick={() => handleRemoveCollector(collector)}
                          disabled={mutations.setSettings.isPending}
                          className="text-destructive-text hover:bg-destructive/10 hover:text-destructive-text"
                        >
                          {t('common.remove', 'Remove')}
                        </Button>
                      )}
                    </li>
                  ))}
                </ul>
              )}

              {canManage && authorisedCollectors.length >= MAX_COLLECTORS ? (
                <p className="text-control text-muted-foreground">
                  {t('procurement:poSettings.maxCollectors', 'Up to 50 names, 100 characters each.')}
                </p>
              ) : null}

              {canManage && authorisedCollectors.length < MAX_COLLECTORS && (
                <form onSubmit={handleAddCollector} className="flex items-end gap-2 pt-2">
                  <TextField
                    label={t('procurement:poSettings.newCollectorLabel', 'New authorised collector')}
                    value={newCollector}
                    onChange={setNewCollector}
                    maxLength={100}
                    disabled={mutations.setSettings.isPending}
                    className="flex-1"
                  />
                  <Button
                    type="submit"
                    variant="outline"
                    disabled={!newCollector.trim() || mutations.setSettings.isPending}
                  >
                    {t('procurement:poSettings.addCollector', 'Add collector')}
                  </Button>
                </form>
              )}
            </div>

            {/* Signature Blocks List */}
            <div className="space-y-1">
              <div>
                <h3 className="text-sm font-semibold">
                  {t('procurement:poSettings.signatureBlocksHeading', 'Signature blocks')}
                </h3>
                <p className="text-control text-muted-foreground">
                  {t(
                    'procurement:poSettings.signatureBlocksHelp',
                    'Signature lines printed at the bottom of the purchase order (e.g. Prepared by, Approved by).',
                  )}
                </p>
              </div>

              {signatureBlocks.length === 0 ? (
                <p className="text-control text-muted-foreground">
                  {t('procurement:poSettings.noSignatureBlocks', 'No signature blocks configured.')}
                </p>
              ) : (
                <ul className="divide-y divide-border">
                  {signatureBlocks.map((block) => (
                    <li
                      key={block}
                      className="flex min-h-11 items-center justify-between py-1.5 text-control"
                    >
                      <span className="font-medium">{block}</span>
                      {canManage && (
                        <Button
                          variant="ghost"
                          size="sm"
                          aria-label={`${t('procurement:poSettings.removeBlock', 'Remove signature block')}: ${block}`}
                          onClick={() => handleRemoveBlock(block)}
                          disabled={mutations.setSettings.isPending}
                          className="text-destructive-text hover:bg-destructive/10 hover:text-destructive-text"
                        >
                          {t('common.remove', 'Remove')}
                        </Button>
                      )}
                    </li>
                  ))}
                </ul>
              )}

              {canManage && signatureBlocks.length >= MAX_SIGNATURE_BLOCKS ? (
                <p className="text-control text-muted-foreground">
                  {t('procurement:poSettings.maxSignatureBlocks', 'Up to 10 blocks, 80 characters each.')}
                </p>
              ) : null}

              {canManage && signatureBlocks.length < MAX_SIGNATURE_BLOCKS && (
                <form onSubmit={handleAddBlock} className="flex items-end gap-2 pt-2">
                  <TextField
                    label={t('procurement:poSettings.newSignatureBlockLabel', 'New signature block')}
                    value={newBlock}
                    onChange={setNewBlock}
                    maxLength={80}
                    disabled={mutations.setSettings.isPending}
                    className="flex-1"
                  />
                  <Button
                    type="submit"
                    variant="outline"
                    disabled={!newBlock.trim() || mutations.setSettings.isPending}
                  >
                    {t('procurement:poSettings.addBlock', 'Add block')}
                  </Button>
                </form>
              )}
            </div>

            {/* Admin Notice or Actions */}
            {!canManage ? (
              <p className="mt-2 text-control text-muted-foreground">
                {t('procurement:gates.onlyAdmin', 'Only an Admin can change this.')}
              </p>
            ) : (
              <div className="flex items-center gap-3 pt-2">
                <Button
                  variant="primary"
                  onClick={handleSave}
                  loading={mutations.setSettings.isPending}
                  disabled={!isDirty || mutations.setSettings.isPending}
                >
                  {t('procurement:poSettings.saveChanges', 'Save changes')}
                </Button>
                <span role="status" className="min-h-5 text-control text-muted-foreground">
                  {mutations.setSettings.isPending
                    ? t('procurement:poSettings.saving', 'Saving…')
                    : mutations.setSettings.isSuccess && !isDirty
                      ? t('procurement:poSettings.saved', 'Saved')
                      : ''}
                </span>
              </div>
            )}

            {error && <FieldError>{error}</FieldError>}
          </>
        )}
      </div>
    </section>
  );
}
