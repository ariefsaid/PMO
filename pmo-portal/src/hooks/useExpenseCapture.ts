import { useCallback, useRef, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { useAuth } from '@/src/auth/useAuth';
import { AppError } from '@/src/lib/appError';
import { FILE_MIME_BY_EXT, MAX_FILE_SIZE_BYTES } from '@/src/lib/fileConstants';
import { RECEIPT_EXTENSIONS, receiptExtension } from '@/src/lib/db/expenseReceipts';
import type { ExpenseClaimInput, ExpenseLineInput } from '@/src/lib/db/expenseClaims';
import { uploadWithProgress } from '@/src/lib/uploadTransport';
import {
  cleanupUnlinkedExpenseCaptureReceipt, confirmExpenseCaptureReceipt, expenseCaptureRepository,
} from '@/src/lib/repositories/expenseCapture';
import { EXPENSE_QUERY_ROOTS } from './useExpenseClaims';

export interface ExpenseCaptureInput {
  header: ExpenseClaimInput;
  firstLine: ExpenseLineInput | null;
  receiptFile: File | null;
}

export type ExpenseCaptureAttachmentState = 'selected' | 'prepared' | 'uploaded' | 'confirmed' | 'cleanup-required';
export type ExpenseCapturePhase = 'saving-draft' | 'draft-saved' | 'preparing-receipt' | 'uploading-receipt' | 'confirming-receipt' | 'receipt-upload-failed' | 'complete';

export interface ExpenseCaptureRecovery {
  claimId: string;
  draftSaved: boolean;
  phase: ExpenseCapturePhase;
  attachment: { fileId: string; path: string | null; state: ExpenseCaptureAttachmentState } | null;
  error: string | null;
}

interface CaptureIntent extends ExpenseCaptureInput {
  claimId: string;
  lineId: string | null;
  fileId: string | null;
  path: string | null;
  draftSaved: boolean;
  attachmentState: ExpenseCaptureAttachmentState | null;
}

function sameIntent(intent: CaptureIntent, input: ExpenseCaptureInput): boolean {
  return intent.receiptFile === input.receiptFile
    && JSON.stringify(intent.header) === JSON.stringify(input.header)
    && JSON.stringify(intent.firstLine) === JSON.stringify(input.firstLine);
}

function snapshot(intent: CaptureIntent, phase: ExpenseCapturePhase, error: string | null = null): ExpenseCaptureRecovery {
  return {
    claimId: intent.claimId,
    draftSaved: intent.draftSaved,
    phase,
    attachment: intent.fileId && intent.attachmentState
      ? { fileId: intent.fileId, path: intent.path, state: intent.attachmentState }
      : null,
    error,
  };
}

function assertReceiptFile(file: File): void {
  const extension = receiptExtension(file.name);
  if (!(RECEIPT_EXTENSIONS as readonly string[]).includes(extension)) throw new AppError(`File type not allowed (${extension || 'none'})`);
  if (file.size > MAX_FILE_SIZE_BYTES) throw new AppError('Receipt file exceeds the 5 MB limit.', '413');
}

export function useExpenseCapture() {
  const queryClient = useQueryClient();
  const orgId = useAuth().currentUser?.org_id;
  const intentRef = useRef<CaptureIntent | null>(null);
  const [recovery, setRecovery] = useState<ExpenseCaptureRecovery | null>(null);
  const [progress, setProgress] = useState<number | null>(null);

  const invalidateDraftReads = useCallback((claimId: string) => {
    for (const root of EXPENSE_QUERY_ROOTS) void queryClient.invalidateQueries({ queryKey: [root] });
    void queryClient.invalidateQueries({ queryKey: ['expense-receipts', orgId, claimId] });
  }, [orgId, queryClient]);

  const capture = useCallback(async (input: ExpenseCaptureInput): Promise<string> => {
    if (input.header.kind !== 'claim') throw new AppError('Expense capture accepts claims only.', '22023');
    if (input.receiptFile) assertReceiptFile(input.receiptFile);

    let intent = intentRef.current;
    if (intent && !sameIntent(intent, input)) {
      if (intent.draftSaved) throw new AppError('This saved draft is tied to the current receipt and line. Retry it or open the saved draft before changing the capture.', '55000');
      intent = null;
    }
    if (!intent) {
      intent = {
        ...input,
        claimId: crypto.randomUUID(),
        lineId: input.firstLine ? crypto.randomUUID() : null,
        fileId: input.receiptFile ? crypto.randomUUID() : null,
        path: null,
        draftSaved: false,
        attachmentState: input.receiptFile ? 'selected' : null,
      };
      intentRef.current = intent;
    }

    try {
      if (!intent.draftSaved) {
        setRecovery(snapshot(intent, 'saving-draft'));
        await expenseCaptureRepository.create({
          claimId: intent.claimId,
          lineId: intent.lineId,
          header: intent.header,
          firstLine: intent.firstLine,
        });
        intent.draftSaved = true;
        invalidateDraftReads(intent.claimId);
      }

      if (!intent.receiptFile || !intent.fileId) {
        setRecovery(snapshot(intent, 'complete'));
        return intent.claimId;
      }

      setRecovery(snapshot(intent, 'preparing-receipt'));
      const prepared = await expenseCaptureRepository.prepareReceipt(intent.claimId, intent.fileId, intent.receiptFile.name);
      if (intent.path && intent.path !== prepared.path) throw new AppError('Receipt retry produced a different storage path; the saved draft has been retained.', '55000');
      intent.path = prepared.path;
      intent.attachmentState = 'prepared';

      setRecovery(snapshot(intent, 'uploading-receipt'));
      let objectExists = await expenseCaptureRepository.objectExists(intent.path);
      if (!objectExists) {
        const extension = receiptExtension(intent.receiptFile.name);
        const contentType = FILE_MIME_BY_EXT[extension] || intent.receiptFile.type || 'application/octet-stream';
        try {
          await uploadWithProgress(prepared.signedUrl, intent.receiptFile, {
            contentType,
            upsert: false,
            onProgress: setProgress,
          });
          objectExists = true;
        } catch (uploadError) {
          objectExists = await expenseCaptureRepository.objectExists(intent.path);
          if (!objectExists) throw uploadError;
        }
      }
      if (!objectExists) throw new AppError('Receipt upload could not be confirmed. Keep the draft and retry.');
      intent.attachmentState = 'uploaded';
      setProgress(null);

      setRecovery(snapshot(intent, 'confirming-receipt'));
      await confirmExpenseCaptureReceipt(intent.claimId, intent.fileId, intent.path);
      intent.attachmentState = 'confirmed';
      invalidateDraftReads(intent.claimId);
      setRecovery(snapshot(intent, 'complete'));
      return intent.claimId;
    } catch (error) {
      setProgress(null);
      const phase: ExpenseCapturePhase = intent.draftSaved ? 'receipt-upload-failed' : 'saving-draft';
      setRecovery(snapshot(intent, phase, error instanceof Error ? error.message : 'Expense capture failed.'));
      throw error;
    }
  }, [invalidateDraftReads]);

  const cleanupUnlinkedAttachment = useCallback(async () => {
    const intent = intentRef.current;
    if (!intent?.draftSaved || !intent.fileId || !intent.path) return;
    try {
      await cleanupUnlinkedExpenseCaptureReceipt(intent.claimId, intent.fileId, intent.path);
      intent.path = null;
      intent.attachmentState = 'selected';
      setRecovery(snapshot(intent, 'receipt-upload-failed'));
    } catch (error) {
      intent.attachmentState = 'cleanup-required';
      setRecovery(snapshot(intent, 'receipt-upload-failed', error instanceof Error ? error.message : 'Receipt cleanup needs retry.'));
      throw error;
    }
  }, []);

  return { capture, recovery, progress, cleanupUnlinkedAttachment };
}
