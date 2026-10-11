// Shared Gemini helpers (REST, no SDK). Docs: https://ai.google.dev/gemini-api/docs
const KEY = Deno.env.get('GEMINI_API_KEY') ?? '';
const BASE = 'https://generativelanguage.googleapis.com';

export type Part =
  | { text: string }
  | { inline_data: { mime_type: string; data: string } }
  | { file_data: { file_uri: string; mime_type: string } };

const RETRY_STATUS = new Set([429, 500, 503]);
const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));

/** Free-tier keys get this on models they have no quota for ("check your plan and billing"). Waiting does not help. */
export const HARD_QUOTA = /billing|plan/i;
/** Errors worth trying another model for: rate limits, overload, timeouts. */
export const TRANSIENT = /429|quota|RESOURCE_EXHAUSTED|503|overloaded|UNAVAILABLE|timeout/i;

/**
 * One generateContent call with JSON output. Retries 429/5xx (`retries` times, default 2) with backoff
 * inside the overall timeout. A hard quota error is thrown at once. Errors carry the HTTP status: "gemini 503: ...".
 */
export async function geminiGenerate(o: { model: string; system: string; parts: Part[]; maxTokens?: number; timeoutMs?: number; retries?: number }): Promise<string> {
  const deadline = Date.now() + (o.timeoutMs ?? 50_000);
  const retries = o.retries ?? 2;
  for (let attempt = 0; ; attempt++) {
    const remaining = deadline - Date.now();
    if (remaining <= 0) throw new Error('gemini timeout');
    const ctrl = new AbortController();
    const to = setTimeout(() => ctrl.abort(), remaining);
    try {
      const r = await fetch(`${BASE}/v1beta/models/${o.model}:generateContent`, {
        method: 'POST', signal: ctrl.signal,
        headers: { 'x-goog-api-key': KEY, 'content-type': 'application/json' },
        body: JSON.stringify({
          system_instruction: { parts: [{ text: o.system }] },
          contents: [{ role: 'user', parts: o.parts }],
          generationConfig: { response_mime_type: 'application/json', temperature: 0.2, max_output_tokens: o.maxTokens ?? 1024 },
        }),
      });
      const out = await r.json();
      if (!r.ok) {
        const msg = `gemini ${r.status}: ${out?.error?.message ?? 'no message'}`;
        const hardQuota = r.status === 429 && HARD_QUOTA.test(msg);
        if (RETRY_STATUS.has(r.status) && !hardQuota && attempt < retries) { console.warn(`gemini ${r.status}, retry ${attempt + 1}`); await sleep(1000 * 2 ** attempt); continue; }
        throw new Error(msg);
      }
      // deno-lint-ignore no-explicit-any
      return out?.candidates?.[0]?.content?.parts?.map((p: any) => p.text ?? '').join('') ?? '';
    } catch (e) {
      if (ctrl.signal.aborted) throw new Error('gemini timeout');
      throw e;
    } finally { clearTimeout(to); }
  }
}

/** Upload a video/audio blob via the Files API and wait until it is ACTIVE. */
export async function geminiUploadFile(blob: Blob, mimeType: string): Promise<{ uri: string; mimeType: string }> {
  const bytes = await blob.arrayBuffer();
  const start = await fetch(`${BASE}/upload/v1beta/files`, {
    method: 'POST',
    headers: {
      'x-goog-api-key': KEY,
      'X-Goog-Upload-Protocol': 'resumable', 'X-Goog-Upload-Command': 'start',
      'X-Goog-Upload-Header-Content-Length': String(bytes.byteLength),
      'X-Goog-Upload-Header-Content-Type': mimeType,
      'content-type': 'application/json',
    },
    body: JSON.stringify({ file: { display_name: `forklog-${Date.now()}` } }),
  });
  const uploadUrl = start.headers.get('x-goog-upload-url');
  if (!uploadUrl) throw new Error(`gemini upload start failed (${start.status})`);
  const fin = await fetch(uploadUrl, {
    method: 'POST',
    headers: { 'X-Goog-Upload-Command': 'upload, finalize', 'X-Goog-Upload-Offset': '0', 'content-type': mimeType },
    body: bytes,
  });
  let file = (await fin.json()).file;
  if (!file?.name) throw new Error('gemini upload finalize failed');
  // poll until processed (videos take a few seconds)
  for (let i = 0; i < 30 && file.state === 'PROCESSING'; i++) {
    await sleep(2000);
    file = await (await fetch(`${BASE}/v1beta/${file.name}`, { headers: { 'x-goog-api-key': KEY } })).json();
  }
  if (file.state !== 'ACTIVE') throw new Error(`gemini file state ${file.state}`);
  return { uri: file.uri, mimeType };
}

/** Gemini accepts video/mov, not video/quicktime (what iOS Photos reports). */
export function normalizeVideoMime(mime: string | undefined | null): string {
  const m = (mime ?? '').toLowerCase();
  if (!m) return 'video/mp4';
  if (m === 'video/quicktime' || m === 'video/x-quicktime') return 'video/mov';
  return m;
}

/** Chunked base64 — String.fromCharCode(...bigArray) overflows the call stack on large images. */
export function bytesToBase64(bytes: Uint8Array): string {
  let bin = '';
  const CH = 0x8000;
  for (let i = 0; i < bytes.length; i += CH) bin += String.fromCharCode(...bytes.subarray(i, i + CH));
  return btoa(bin);
}

export const STUB_MODE = Deno.env.get('STUB_MODE') === '1';
