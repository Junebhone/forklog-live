// extract-recipe: video in Supabase storage -> Gemini (video + audio in one call) -> RecipeSchema -> version 1.
// Body: { recipe_id, video_path, caption_text? }
// No ffmpeg, no Scribe: Gemini reads the video and its audio track directly.
// Reference frames: Gemini returns ref_frame_sec per step; the APP grabs those thumbnails with
// expo-video-thumbnails and uploads them to bucket "frames" (see lib/refFrames.ts).
// STUB_MODE=1 returns sample.json (still persists it as version 1 so the rest of the app works).
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { RECIPE_EXTRACTION_SYSTEM, recipeExtractionUser } from '../_shared/prompts.ts';
import { RecipeSchema, parseModelJson } from '../_shared/guards.ts';
import { geminiGenerate, geminiUploadFile, normalizeVideoMime, STUB_MODE, type Part } from '../_shared/gemini.ts';
import sample from './sample.json' with { type: 'json' };

const MODEL = Deno.env.get('GEMINI_EXTRACT_MODEL') ?? 'gemini-3.1-pro-preview';
// Free-tier keys have little or no quota on the Pro preview; fall back to Flash instead of failing the import.
const FALLBACK_MODEL = Deno.env.get('GEMINI_FALLBACK_MODEL') ?? 'gemini-3.8-flash';
const QUOTA_ERROR = /429|quota|RESOURCE_EXHAUSTED/i;
const sb = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);
const cors = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type' };
const json = (b: unknown) => Response.json(b, { headers: cors });

Deno.serve(async req => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });
  const t0 = Date.now();
  try {
    const { recipe_id, video_path, caption_text = '' } = await req.json();
    if (!recipe_id) return json({ ok: false, error: 'recipe_id required' });

    let text: string;
    let model = MODEL;
    if (STUB_MODE) {
      text = JSON.stringify(sample.recipe);
    } else {
      if (!video_path) return json({ ok: false, error: 'video_path required' });
      // 1. pull video from storage, push to Gemini Files API (handles > 20 MB; waits until ACTIVE)
      const { data: blob, error } = await sb.storage.from('videos').download(video_path);
      if (error || !blob) return json({ ok: false, error: `video download failed: ${error?.message ?? 'empty'}` });
      const mime = normalizeVideoMime(blob.type || (video_path.toLowerCase().endsWith('.mov') ? 'video/mov' : 'video/mp4'));
      const file = await geminiUploadFile(blob, mime);

      // 2. one call: video + audio + caption -> recipe JSON
      const parts: Part[] = [
        { file_data: { file_uri: file.uri, mime_type: file.mimeType } },
        { text: recipeExtractionUser({ captionText: caption_text }) },
      ];
      const generate = (model: string) => geminiGenerate({ model, system: RECIPE_EXTRACTION_SYSTEM, parts, maxTokens: 6000, timeoutMs: 120_000 });
      try {
        text = await generate(model);
      } catch (e) {
        if (!QUOTA_ERROR.test((e as Error).message) || model === FALLBACK_MODEL) throw e;
        console.warn(`extract-recipe ${model} quota exhausted, falling back to ${FALLBACK_MODEL}`);
        model = FALLBACK_MODEL;
        text = await generate(model); // the uploaded file is reused, only the generate call repeats
      }
    }
    const parsed = parseModelJson(RecipeSchema, text);
    if (!parsed.ok) return json({ ok: false, error: parsed.error, raw: text.slice(0, 500) });
    const recipe = parsed.data;

    // 3. persist version 1 (ref frames are uploaded by the app next)
    const { data: ver, error: verErr } = await sb.from('versions').insert({ recipe_id, number: 1, recipe_json: recipe }).select('id').single();
    if (verErr || !ver) return json({ ok: false, error: `save failed: ${verErr?.message ?? 'no row'}` });
    await sb.from('recipes').update({ title: recipe.title, source_summary: recipe.source_summary }).eq('id', recipe_id);

    console.log(`extract-recipe ${STUB_MODE ? 'stub' : model} ${Date.now() - t0}ms`);
    return json({ ok: true, version_id: ver.id, recipe });
  } catch (e) {
    return json({ ok: false, error: (e as Error).message });
  }
});
