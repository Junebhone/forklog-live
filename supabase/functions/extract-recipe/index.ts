// extract-recipe: video in Supabase storage -> Gemini (video + audio in one call) -> RecipeSchema -> version 1.
// Body: { recipe_id, video_path, caption_text? }
// No ffmpeg, no Scribe: Gemini reads the video and its audio track directly.
// Reference frames: Gemini returns ref_frame_sec per step; the APP grabs those thumbnails with
// expo-video-thumbnails and uploads them to bucket "frames" (see lib/refFrames.ts).
// STUB_MODE=1 returns sample.json (still persists it as version 1 so the rest of the app works).
// The response is streamed with a keep-alive space every 10 s: iOS drops a request that is silent for 60 s,
// and a real extraction takes longer than that.
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { RECIPE_EXTRACTION_SYSTEM, recipeExtractionUser } from '../_shared/prompts.ts';
import { RecipeSchema, parseModelJson } from '../_shared/guards.ts';
import { geminiGenerate, geminiUploadFile, normalizeVideoMime, STUB_MODE, HARD_QUOTA, TRANSIENT, type Part } from '../_shared/gemini.ts';
import sample from './sample.json' with { type: 'json' };

// Model cascade: the configured model first, then fallbacks on quota / overload / timeout.
// Free-tier keys have no quota on the Pro preview, and Flash returns 503 at peak; the next model beats failing.
// (gemini-2.5-flash is closed to new API users and returns 404.)
const MODELS = [...new Set([
  Deno.env.get('GEMINI_EXTRACT_MODEL') ?? 'gemini-3.1-pro-preview',
  ...(Deno.env.get('GEMINI_FALLBACK_MODELS') ?? 'gemini-3.8-flash,gemini-3.5-flash-lite').split(',').map(s => s.trim()).filter(Boolean),
])];
// Supabase stops a function at its wall-clock limit (150 s on the free plan); stop trying models before that.
const BUDGET_MS = Number(Deno.env.get('EXTRACT_BUDGET_MS') ?? 140_000);
let firstModel = 0; // warm instances skip models that returned a hard (billing) quota error

const sb = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);
const cors = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type' };
const json = (b: unknown) => Response.json(b, { headers: cors });

/** Stream the JSON result, sending a space every 10 s so the phone's idle timeout cannot drop a slow extraction.
 *  Leading whitespace is valid JSON, so supabase-js parses the body unchanged. */
function streamJson(work: () => Promise<unknown>): Response {
  const enc = new TextEncoder();
  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      const send = (s: string) => { try { controller.enqueue(enc.encode(s)); } catch { /* client gone */ } };
      const beat = setInterval(() => send(' '), 10_000);
      work()
        .then(r => send(JSON.stringify(r)), e => send(JSON.stringify({ ok: false, error: (e as Error).message })))
        .finally(() => { clearInterval(beat); try { controller.close(); } catch { /* already closed */ } });
    },
  });
  return new Response(body, { headers: { ...cors, 'content-type': 'application/json' } });
}

async function extract(body: { recipe_id?: string; video_path?: string; caption_text?: string }, t0: number) {
  const { recipe_id, video_path, caption_text = '' } = body;
  if (!recipe_id) return { ok: false, error: 'recipe_id required' };

  let text: string;
  let used = 'stub';
  if (STUB_MODE) {
    text = JSON.stringify(sample.recipe);
  } else {
    if (!video_path) return { ok: false, error: 'video_path required' };
    // 1. pull video from storage, push to Gemini Files API (handles > 20 MB; waits until ACTIVE)
    const { data: blob, error } = await sb.storage.from('videos').download(video_path);
    if (error || !blob) return { ok: false, error: `video download failed: ${error?.message ?? 'empty'}` };
    const mime = normalizeVideoMime(blob.type || (video_path.toLowerCase().endsWith('.mov') ? 'video/mov' : 'video/mp4'));
    const file = await geminiUploadFile(blob, mime);
    console.log(`extract-recipe video ready for gemini after ${Date.now() - t0}ms`);

    // 2. one call: video + audio + caption -> recipe JSON, trying the next model on quota / overload / timeout.
    const parts: Part[] = [
      { file_data: { file_uri: file.uri, mime_type: file.mimeType } },
      { text: recipeExtractionUser({ captionText: caption_text }) },
    ];
    const failures: string[] = [];
    let out: string | null = null;
    for (let i = firstModel; i < MODELS.length && out === null; i++) {
      const remaining = t0 + BUDGET_MS - Date.now();
      if (remaining < 15_000) break;
      const model = MODELS[i];
      try {
        out = await geminiGenerate({ model, system: RECIPE_EXTRACTION_SYSTEM, parts, maxTokens: 6000, timeoutMs: remaining, retries: 0 });
        used = model;
      } catch (e) {
        const msg = (e as Error).message;
        console.warn(`extract-recipe ${model} failed after ${Date.now() - t0}ms: ${msg}`);
        failures.push(`${model}: ${msg}`);
        if (HARD_QUOTA.test(msg)) firstModel = Math.max(firstModel, i + 1);
        if (!TRANSIENT.test(msg)) throw e;
      }
    }
    if (out === null) return { ok: false, error: `Gemini could not process the video in time. ${failures.join(' | ')}`.slice(0, 600) };
    text = out;
  }

  const parsed = parseModelJson(RecipeSchema, text);
  if (!parsed.ok) return { ok: false, error: parsed.error, raw: text.slice(0, 500) };
  const recipe = parsed.data;

  // 3. persist version 1 (ref frames are uploaded by the app next)
  const { data: ver, error: verErr } = await sb.from('versions').insert({ recipe_id, number: 1, recipe_json: recipe }).select('id').single();
  if (verErr || !ver) return { ok: false, error: `save failed: ${verErr?.message ?? 'no row'}` };
  await sb.from('recipes').update({ title: recipe.title, source_summary: recipe.source_summary }).eq('id', recipe_id);

  console.log(`extract-recipe ${used} ${Date.now() - t0}ms`);
  return { ok: true, version_id: ver.id, recipe };
}

Deno.serve(async req => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });
  const t0 = Date.now();
  let body: { recipe_id?: string; video_path?: string; caption_text?: string };
  try { body = await req.json(); } catch { return json({ ok: false, error: 'invalid JSON body' }); }
  return streamJson(() => extract(body, t0));
});
