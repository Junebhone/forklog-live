// coach-frame: per-frame live coaching with Gemini Flash.
// Body: { recipe_id, cook_id, step_n, user_frame_b64, already_detected, elapsed_sec }
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { COACH_FRAME_SYSTEM, coachFrameUser } from '../_shared/prompts.ts';
import { CoachEventSchema, parseModelJson } from '../_shared/guards.ts';
import { geminiGenerate } from '../_shared/gemini.ts';

const MODEL = Deno.env.get('GEMINI_COACH_MODEL') ?? 'gemini-3.8-flash'; // try gemini-3.5-flash-lite if latency > 1.5 s
const sb = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);
const refCache = new Map<string, string>(); // `${versionId}:${stepN}` -> base64 jpeg

const cors = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'authorization, content-type' };
const json = (b: unknown) => Response.json(b, { headers: cors });

Deno.serve(async req => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });
  const t0 = Date.now();
  try {
    const { cook_id, step_n, user_frame_b64, already_detected = [], elapsed_sec = 0 } = await req.json();

    const { data: cook } = await sb.from('cooks').select('base_version_id').eq('id', cook_id).single();
    const { data: ver } = await sb.from('versions').select('recipe_json').eq('id', cook!.base_version_id).single();
    const step = ver!.recipe_json.steps.find((s: any) => s.n === step_n);
    if (!step) return json({ ok: false, error: 'step not found' });

    const key = `${cook!.base_version_id}:${step_n}`;
    let ref = refCache.get(key);
    if (!ref) {
      const { data: rf } = await sb.from('ref_frames').select('storage_path').eq('version_id', cook!.base_version_id).eq('step_n', step_n).maybeSingle();
      if (rf) {
        const { data: blob } = await sb.storage.from('frames').download(rf.storage_path);
        ref = btoa(String.fromCharCode(...new Uint8Array(await blob!.arrayBuffer())));
        refCache.set(key, ref);
      }
    }

    const parts: any[] = [];
    if (ref) parts.push({ text: 'REFERENCE (creator, end of this step):' }, { inline_data: { mime_type: 'image/jpeg', data: ref } });
    parts.push({ text: 'USER (live):' }, { inline_data: { mime_type: 'image/jpeg', data: user_frame_b64 } });
    parts.push({ text: coachFrameUser({ stepText: step.text, expectedIngredients: step.ingredients, alreadyDetected: already_detected, elapsedSec: elapsed_sec, visualCue: step.visual_cue, hasReference: !!ref }) });

    const text = await geminiGenerate({ model: MODEL, system: COACH_FRAME_SYSTEM, parts, maxTokens: 300, timeoutMs: 15_000 });
    const parsed = parseModelJson(CoachEventSchema, text);
    if (!parsed.ok) return json({ ok: false, error: parsed.error });

    await sb.from('cook_events').insert({ cook_id, step_n, event: parsed.data });
    console.log(`coach-frame ${MODEL} ${Date.now() - t0}ms`);
    return json({ ok: true, event: parsed.data });
  } catch (e) {
    return json({ ok: false, error: (e as Error).message });
  }
});
