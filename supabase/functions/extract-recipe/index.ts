// extract-recipe: video in Supabase storage -> Gemini (video + audio in one call) -> RecipeSchema -> version 1.
// Body: { recipe_id, video_path, caption_text? }
// No ffmpeg, no Scribe: Gemini reads the video and its audio track directly.
// Reference frames: Gemini returns ref_frame_sec per step; the APP grabs those thumbnails with
// expo-video-thumbnails and uploads them to bucket "frames" (see lib/refFrames.ts).
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { RECIPE_EXTRACTION_SYSTEM, recipeExtractionUser } from '../_shared/prompts.ts';
import { RecipeSchema, parseModelJson } from '../_shared/guards.ts';
import { geminiGenerate, geminiUploadFile } from '../_shared/gemini.ts';

const MODEL = Deno.env.get('GEMINI_EXTRACT_MODEL') ?? 'gemini-3.1-pro-preview';
const sb = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);
const cors = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'authorization, content-type' };
const json = (b: unknown) => Response.json(b, { headers: cors });

Deno.serve(async req => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });
  const t0 = Date.now();
  try {
    const { recipe_id, video_path, caption_text = '' } = await req.json();

    // 1. pull video from storage, push to Gemini Files API (handles > 20 MB; waits until ACTIVE)
    const { data: blob, error } = await sb.storage.from('videos').download(video_path);
    if (error || !blob) return json({ ok: false, error: 'video download failed' });
    const file = await geminiUploadFile(blob, blob.type || 'video/mp4');

    // 2. one call: video + audio + caption -> recipe JSON
    const text = await geminiGenerate({
      model: MODEL,
      system: RECIPE_EXTRACTION_SYSTEM,
      parts: [
        { file_data: { file_uri: file.uri, mime_type: file.mimeType } },
        { text: recipeExtractionUser({ captionText: caption_text }) },
      ],
      maxTokens: 6000,
    });
    const parsed = parseModelJson(RecipeSchema, text);
    if (!parsed.ok) return json({ ok: false, error: parsed.error, raw: text.slice(0, 500) });
    const recipe = parsed.data;

    // 3. persist version 1 (ref frames are uploaded by the app next)
    const { data: ver } = await sb.from('versions').insert({ recipe_id, number: 1, recipe_json: recipe }).select('id').single();
    await sb.from('recipes').update({ title: recipe.title, source_summary: recipe.source_summary }).eq('id', recipe_id);

    console.log(`extract-recipe ${Date.now() - t0}ms`);
    return json({ ok: true, version_id: ver!.id, recipe });
  } catch (e) {
    return json({ ok: false, error: (e as Error).message });
  }
});
