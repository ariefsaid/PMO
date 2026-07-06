import type { ClassifiedUploadError } from '@/src/lib/uploadTransport';

export const AGENT_ATTACHMENT_MAX_MB = 8;
export const AGENT_ATTACHMENT_MAX_BYTES = AGENT_ATTACHMENT_MAX_MB * 1024 * 1024;

export const ALLOWED_AGENT_ATTACHMENT_MIME = [
  'application/pdf',
  'image/png',
  'image/jpeg',
  'image/webp',
] as const;

export type AgentAttachmentMime = (typeof ALLOWED_AGENT_ATTACHMENT_MIME)[number];

export const AGENT_ATTACHMENT_ACCEPT = ALLOWED_AGENT_ATTACHMENT_MIME.join(',');

const MIME_BY_EXTENSION: Record<string, AgentAttachmentMime> = {
  '.pdf': 'application/pdf',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
};

function extensionOf(filename: string): string {
  const dot = filename.lastIndexOf('.');
  return dot >= 0 ? filename.slice(dot).toLowerCase() : '';
}

export function getAgentAttachmentContentType(file: Pick<File, 'name' | 'type'>): AgentAttachmentMime | null {
  if (ALLOWED_AGENT_ATTACHMENT_MIME.includes(file.type as AgentAttachmentMime)) {
    return file.type as AgentAttachmentMime;
  }

  return MIME_BY_EXTENSION[extensionOf(file.name)] ?? null;
}

export function classifyAttachmentError(
  file: Pick<File, 'name' | 'type' | 'size'>,
): ClassifiedUploadError | null {
  if (file.size > AGENT_ATTACHMENT_MAX_BYTES) {
    return {
      type: 'oversize',
      message: `File exceeds ${AGENT_ATTACHMENT_MAX_MB} MB limit`,
    };
  }

  if (!getAgentAttachmentContentType(file)) {
    return {
      type: 'type',
      message: 'File type not allowed',
    };
  }

  return null;
}
