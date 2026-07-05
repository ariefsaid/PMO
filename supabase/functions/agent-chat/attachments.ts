import type { ModelMessage } from '../_shared/modelClient.ts';

export const AGENT_ATTACHMENT_TEXT_CHAR_CAP = 16_000;

export type AttachmentTextStatus = 'pending' | 'ready' | 'failed' | 'skipped';

export interface ResolvedAttachment {
  id: string;
  originalFilename: string;
  mimeType: string;
  extractedTextStatus: AttachmentTextStatus;
  extractedText?: string | null;
}

function boundText(text: string): { text: string; truncated: boolean } {
  if (text.length <= AGENT_ATTACHMENT_TEXT_CHAR_CAP) {
    return { text, truncated: false };
  }
  return {
    text: text.slice(0, AGENT_ATTACHMENT_TEXT_CHAR_CAP),
    truncated: true,
  };
}

function contextForAttachment(attachment: ResolvedAttachment): string {
  if (attachment.extractedTextStatus !== 'ready' || !attachment.extractedText) {
    return [
      `[Untrusted attachment content: ${attachment.originalFilename}]`,
      `Attachment id: ${attachment.id}`,
      `MIME type: ${attachment.mimeType}`,
      `Status: ${attachment.extractedTextStatus}. The assistant cannot read this attachment's text yet.`,
      '[/Untrusted attachment content]',
    ].join('\n');
  }

  const bounded = boundText(attachment.extractedText);
  return [
    `[Untrusted attachment content: ${attachment.originalFilename}]`,
    `Attachment id: ${attachment.id}`,
    `MIME type: ${attachment.mimeType}`,
    bounded.text,
    bounded.truncated ? '[truncated]' : '',
    '[/Untrusted attachment content]',
  ].filter(Boolean).join('\n');
}

export function buildAttachmentContextMessages(
  attachments: ResolvedAttachment[],
): ModelMessage[] {
  return attachments.map((attachment) => ({
    role: 'user',
    content: contextForAttachment(attachment),
  }));
}
