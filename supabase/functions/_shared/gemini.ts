// Shared Gemini helpers (REST, no SDK). Docs: https://ai.google.dev/gemini-api/docs
const KEY = Deno.env.get('GEMINI_API_KEY')!;
const BASE = 'https://generativelanguage.googleapis.com';

type Part =
  | { text: string }
  | { inline_data: { mime_type: string; data: string } }
  | { file_data: { file_uri: string; mime_type: string } };

export async function geminiGenerate(o: { model: string; system: string; parts: Part[]; maxTokens?: number; timeoutMs?: number }): Promise<string> {
  const ctrl = new AbortController();
  const to = setTimeout(() => ctrl.abort(), o.timeoutMs ?? 50_000);
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
    if (!r.ok) throw new Error(out?.error?.message ?? `gemini ${r.status}`);
    return out?.candidates?.[0]?.content?.parts?.map((p: any) => p.text ?? '').join('') ?? '';
  } finally { clearTimeout(to); }
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
  if (!uploadUrl) throw new Error('gemini upload start failed');
  const fin = await fetch(uploadUrl, {
    method: 'POST',
    headers: { 'X-Goog-Upload-Command': 'upload, finalize', 'X-Goog-Upload-Offset': '0', 'content-type': mimeType },
    body: bytes,
  });
  let file = (await fin.json()).file;
  // poll until processed (videos take a few seconds)
  for (let i = 0; i < 30 && file.state === 'PROCESSING'; i++) {
    await new Promise(r => setTimeout(r, 2000));
    file = await (await fetch(`${BASE}/v1beta/${file.name}`, { headers: { 'x-goog-api-key': KEY } })).json();
  }
  if (file.state !== 'ACTIVE') throw new Error(`gemini file state ${file.state}`);
  return { uri: file.uri, mimeType };
}
