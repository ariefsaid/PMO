import React from 'react';
import { useTranslation } from 'react-i18next';
import { ConfirmDialog } from './ConfirmDialog';

export interface UnsavedChangesDialogProps {
  open: boolean;
  onDiscard: () => void;
  onKeepEditing: () => void;
  title?: string;
  description?: React.ReactNode;
  discardLabel?: string;
  keepEditingLabel?: string;
  loading?: boolean;
  discardDisabled?: boolean;
  alternateAction?: { label: string; onClick: () => void };
}

/** Shared confirmation for leaving a form with unsaved work. Keeping the form is the safe default. */
export const UnsavedChangesDialog: React.FC<UnsavedChangesDialogProps> = ({
  open,
  onDiscard,
  onKeepEditing,
  title,
  description,
  discardLabel,
  keepEditingLabel,
  loading,
  discardDisabled,
  alternateAction,
}) => {
  const { t } = useTranslation('common');

  return (
    <ConfirmDialog
      open={open}
      tone="destructive"
      title={title ?? t('unsavedChanges.title', 'Discard your changes?')}
      description={description ?? t('unsavedChanges.body', 'What you typed here will be lost.')}
      confirmLabel={discardLabel ?? t('unsavedChanges.discard', 'Discard')}
      cancelLabel={keepEditingLabel ?? t('unsavedChanges.keepEditing', 'Keep editing')}
      loading={loading}
      confirmDisabled={discardDisabled}
      secondaryAction={alternateAction}
      cancelFirstOnMobile
      onConfirm={onDiscard}
      onCancel={onKeepEditing}
    />
  );
};

UnsavedChangesDialog.displayName = 'UnsavedChangesDialog';
