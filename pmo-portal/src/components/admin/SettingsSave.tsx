import React, { useCallback, useContext, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Button } from '../ui/Button';
import { SettingsSaveContext, type SaveEntry } from './settingsSaveContext';

/** Runs the existing independent writes; each setting retains its own error handling. */
export const SettingsSaveProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const entries = useRef(new Map<string, SaveEntry>());
  const [revision, setRevision] = useState(0);
  const savingRef = useRef(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(false);

  const register = useCallback((id: string, entry: SaveEntry | null) => {
    const previous = entries.current.get(id);
    if (entry) entries.current.set(id, entry);
    else entries.current.delete(id);
    // Replace the callback on every edit, but notify consumers only when button state changes.
    if (previous?.dirty !== entry?.dirty || previous?.invalid !== entry?.invalid || previous?.busy !== entry?.busy) {
      setRevision((n) => n + 1);
    }
  }, []);

  const saveAll = useCallback(async () => {
    if (savingRef.current) return;
    const pending = [...entries.current.values()].filter((entry) => entry.dirty);
    if (!pending.length || pending.some((entry) => entry.invalid || entry.busy)) return;
    savingRef.current = true;
    setSaving(true);
    setError(false);
    let failed = false;
    for (const entry of pending) {
      try { await entry.save(); }
      catch { failed = true; }
    }
    setError(failed);
    savingRef.current = false;
    setSaving(false);
  }, []);

  const value = useMemo(() => ({ entries: entries.current, register, saving, error, saveAll, revision }),
    [register, saving, error, saveAll, revision]);
  return <SettingsSaveContext.Provider value={value}>{children}</SettingsSaveContext.Provider>;
};

export const SettingsSaveAction: React.FC<{ describedBy?: string }> = ({ describedBy }) => {
  const context = useContext(SettingsSaveContext);
  const { t } = useTranslation();
  if (!context || context.entries.size === 0) return null;
  const pending = [...context.entries.values()].filter((entry) => entry.dirty);
  return (
    <div className="flex flex-wrap items-center gap-3">
      {context.error && <p role="alert" className="text-control text-destructive-text">
        {t('ui:pageSave.failed', 'Some changes were not saved. Try again.')}
      </p>}
      <Button variant="primary" aria-describedby={pending.length === 0 ? describedBy : undefined}
        loading={context.saving}
        disabled={pending.length === 0 || pending.some((entry) => entry.invalid || entry.busy)}
        onClick={() => void context.saveAll()}>
        {t('ui:pageSave.save', 'Save')}
      </Button>
    </div>
  );
};
