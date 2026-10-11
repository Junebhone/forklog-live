// coach-frame: per-frame live coaching with Gemini Flash.
// Body: { recipe_id, cook_id, step_n, user_frame_b64, already_detected, elapsed_sec }
// STUB_MODE=1 returns sample.json without calling Gemini.
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { COACH_FRAME_SYSTEM, coachFrameUser } from '../_shared/prompts.ts';
import { CoachEventSchema, RecipeSchema, parseModelJson } from '../_shared/guards.ts';
import { ADAPTATION_CONTRACT, stepOptions, adaptationSummary, adaptCoachEvent } from '../_shared/recipeOptions.ts';
import { geminiGenerate, bytesToBase64, STUB_MODE, type Part } from '../_shared/gemini.ts';
import sample from './sample.json' with { type: 'json' };

const MODEL = Deno.env.get('GEMINI_COACH_MODEL') ?? 'gemini-3.8-flash'; // try gemini-3.5-flash-lite if latency > 1.5 s
const sb = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);
const refCache = new Map<string, string>(); // `${versionId}:${stepN}` -> base64 jpeg

const cors = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type' };
const json = (b: unknown) => Response.json(b, { headers: cors });

Deno.serve(async req => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });
  const t0 = Date.now();
  try {
    const { capability_check, cook_id, step_n, user_frame_b64, already_detected = [], elapsed_sec = 0 } = await req.json();
    if (capability_check === true) return json({ ok: true, adaptation_contract: ADAPTATION_CONTRACT, scripted: STUB_MODE });
    if (!cook_id || !step_n || !user_frame_b64) return json({ ok: false, error: 'cook_id, step_n, user_frame_b64 required' });

    const { data: cook } = await sb.from('cooks').select('base_version_id').eq('id', cook_id).single();
    if (!cook) return json({ ok: false, error: 'cook not found' });
    const { data: ver } = await sb.from('versions').select('recipe_json').eq('id', cook.base_version_id).single();
    const parsedRecipe = RecipeSchema.safeParse(ver?.recipe_json);
    if (!parsedRecipe.success) return json({ ok: false, error: 'invalid saved recipe' });
    const recipe = parsedRecipe.data;
    const { step, expected, allOmitted } = stepOptions(recipe, step_n);
    if (!step) return json({ ok: false, error: 'step not found' });
    if (allOmitted) return json({ ok: true, event: null, intentionally_skipped: true, adaptation_contract: ADAPTATION_CONTRACT, scripted: STUB_MODE });
    if (STUB_MODE) {
      const event = adaptCoachEvent(sample.event, recipe, step_n, true);
      if (event) {
        const { error } = await sb.from('cook_events').insert({ cook_id, step_n, event });
        if (error) return json({ ok: false, error: 'Could not save the scripted observation. Check backend connectivity.' });
      }
      return json({ ok: true, event, scripted: true, adaptation_contract: ADAPTATION_CONTRACT });
    }

    const key = `${cook.base_version_id}:${step_n}`;
    let ref = refCache.get(key);
    if (!ref) {
      const { data: rf } = await sb.from('ref_frames').select('storage_path').eq('version_id', cook.base_version_id).eq('step_n', step_n).maybeSingle();
      if (rf) {
        const { data: blob } = await sb.storage.from('frames').download(rf.storage_path);
        if (blob) {
          ref = bytesToBase64(new Uint8Array(await blob.arrayBuffer()));
          refCache.set(key, ref);
        }
      }
    }

    const parts: Part[] = [];
    if (ref) parts.push({ text: 'REFERENCE (creator, end of this step):' }, { inline_data: { mime_type: 'image/jpeg', data: ref } });
    parts.push({ text: 'USER (live):' }, { inline_data: { mime_type: 'image/jpeg', data: user_frame_b64 } });
    parts.push({ text: coachFrameUser({ stepText: step.text, expectedIngredients: expected, alreadyDetected: already_detected, elapsedSec: elapsed_sec, visualCue: step.visual_cue, hasReference: !!ref, intentionalChanges: adaptationSummary(recipe), quantities: recipe.ingredients.filter(i => !i.omitted && expected.includes(i.name)).map(i => `${i.name}: ${i.qty} ${i.unit}`).join('; ') }) });

    const text = await geminiGenerate({ model: MODEL, system: COACH_FRAME_SYSTEM, parts, maxTokens: 300, timeoutMs: 15_000 });
    const parsed = parseModelJson(CoachEventSchema, text);
    if (!parsed.ok) return json({ ok: false, error: parsed.error });

    // A request may finish after the user saved another adaptation. Do not record its obsolete result.
    const { data: currentCook } = await sb.from('cooks').select('base_version_id,ended_at').eq('id', cook_id).single();
    if (!currentCook || currentCook.ended_at || currentCook.base_version_id !== cook.base_version_id) return json({ ok: false, error: 'cook context changed; discard frame' });
    const event = adaptCoachEvent(parsed.data, recipe, step_n);
    if (event) {
      const { error } = await sb.from('cook_events').insert({ cook_id, step_n, event });
      if (error) return json({ ok: false, error: 'Could not save the observation. Check backend connectivity.' });
    }
    console.log(`coach-frame ${MODEL} ${Date.now() - t0}ms`);
    return json({ ok: true, event, adaptation_contract: ADAPTATION_CONTRACT, scripted: false });
  } catch (e) {
    return json({ ok: false, error: (e as Error).message });
  }
});
