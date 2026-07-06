export const AGENT_ATTACHMENT_IMAGE_MAX_DIMENSION = 1600;
export const AGENT_ATTACHMENT_IMAGE_QUALITY = 0.8;
export const AGENT_ATTACHMENT_IMAGE_OUTPUT_TYPE = 'image/webp';

function isImage(file: Pick<File, 'type'>): boolean {
  return file.type.startsWith('image/');
}

function outputName(filename: string): string {
  const dot = filename.lastIndexOf('.');
  const base = dot > 0 ? filename.slice(0, dot) : filename;
  return `${base}.webp`;
}

function scaleToFit(width: number, height: number, maxDimension: number) {
  const largest = Math.max(width, height);
  if (largest <= maxDimension) {
    return { width, height, changed: false };
  }

  const ratio = maxDimension / largest;
  return {
    width: Math.round(width * ratio),
    height: Math.round(height * ratio),
    changed: true,
  };
}

function canvasToBlob(
  canvas: HTMLCanvasElement,
  type: string,
  quality: number,
): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => {
      if (blob) {
        resolve(blob);
        return;
      }
      reject(new Error('Image transcode failed'));
    }, type, quality);
  });
}

export async function transcodeImage(file: File): Promise<File> {
  if (!isImage(file)) {
    throw new Error('Attachment is not an image');
  }

  const bitmap = await createImageBitmap(file);
  try {
    const target = scaleToFit(
      bitmap.width,
      bitmap.height,
      AGENT_ATTACHMENT_IMAGE_MAX_DIMENSION,
    );

    if (!target.changed) {
      return file;
    }

    const canvas = document.createElement('canvas');
    canvas.width = target.width;
    canvas.height = target.height;
    const ctx = canvas.getContext('2d');
    if (!ctx) {
      throw new Error('Image transcode is unavailable');
    }

    ctx.drawImage(bitmap, 0, 0, target.width, target.height);
    const blob = await canvasToBlob(
      canvas,
      AGENT_ATTACHMENT_IMAGE_OUTPUT_TYPE,
      AGENT_ATTACHMENT_IMAGE_QUALITY,
    );
    return new File([blob], outputName(file.name), {
      type: AGENT_ATTACHMENT_IMAGE_OUTPUT_TYPE,
      lastModified: file.lastModified,
    });
  } finally {
    bitmap.close();
  }
}
