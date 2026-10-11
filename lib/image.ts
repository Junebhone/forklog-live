// Small image helpers shared by the vision loop and reference-frame upload.
import { ImageManipulator, SaveFormat } from 'expo-image-manipulator';
import { File } from 'expo-file-system';

/** Resize to `width` px (keeps aspect) and re-encode as JPEG. Returns file uri + base64. */
export async function resizeJpeg(uri: string, width: number, compress: number): Promise<{ uri: string; base64: string }> {
  const ctx = ImageManipulator.manipulate(uri);
  ctx.resize({ width });
  const img = await ctx.renderAsync();
  try {
    const out = await img.saveAsync({ compress, format: SaveFormat.JPEG, base64: true });
    return { uri: out.uri, base64: out.base64 ?? '' };
  } finally {
    img.release();
    ctx.release();
  }
}

export function base64ToBytes(b64: string): Uint8Array {
  return Uint8Array.from(atob(b64), c => c.charCodeAt(0));
}

/** Supabase storage on React Native wants an ArrayBuffer body. */
export function base64ToArrayBuffer(b64: string): ArrayBuffer {
  return base64ToBytes(b64).buffer as ArrayBuffer;
}

/** Best-effort delete of a temp file; never throws. */
export function deleteQuietly(uri: string | undefined | null) {
  if (!uri) return;
  try {
    const f = new File(uri);
    if (f.exists) f.delete();
  } catch {
    // ignore
  }
}
