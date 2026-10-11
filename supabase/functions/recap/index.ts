// recap: original recipe + cook_events timeline + rating/notes -> Gemini Flash -> CookDiffSchema.
// Body: { cook_id, rating, notes } -> { ok, diff, proposed_version, spoken_recap, suggestion }
// The app saves the proposed version on confirm (lib/db.ts saveVersion). STUB_MODE=1 returns sample.json.
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { RECAP_SYSTEM, recapUser } from '../_shared/prompts.ts';
import { CookDiffSchema, RecipeSchema, parseModelJson, type CookDiff } from '../_shared/guards.ts';
import { ADAPTATION_CONTRACT, hasAdaptations, preserveIntentions, ingredientKey } from '../_shared/recipeOptions.ts';
import { geminiGenerate, STUB_MODE } from '../_shared/gemini.ts';
import sample from './sample.json' with { type: 'json' };

// gemini-3.8-flash regularly needs 30 s+ to rewrite a whole recipe; flash-lite does it in about 4 s.
// So lite goes first, Flash is the fallback. Each attempt has its own time slice; total stays under the
// phone's 60 s request limit.
const ATTEMPTS = (Deno.env.get('GEMINI_RECAP_MODELS') ?? 'gemini-3.5-flash-lite,gemini-3.8-flash,gemini-3.1-flash-lite').split(',').map(m => m.trim()).filter(Boolean).slice(0, 3);
const ATTEMPT_MS = [18_000, 25_000, 12_000];
const MODEL = ATTEMPTS[0];
const sb = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);
const cors = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type' };
const json = (b: unknown) => Response.json(b, { headers: cors });

type EventRow = { step_n: number; at: string; event: Record<string, unknown> };

/** Collapse raw per-frame events into one compact line per step so the prompt stays small. */
function compactTimeline(events: EventRow[]) {
  type Acc = { first: number; last: number; added: Record<string, string | null>; deviations: Set<string>; states: string[] };
  const by = new Map<number, Acc>();
  for (const e of events) {
    const t = Date.parse(e.at);
    let s = by.get(e.step_n);
    if (!s) { s = { first: t, last: t, added: {}, deviations: new Set(), states: [] }; by.set(e.step_n, s); }
    s.first = Math.min(s.first, t); s.last = Math.max(s.last, t);
    const ev = e.event;
    if (typeof ev.ingredient_added === 'string') s.added[ev.ingredient_added] = typeof ev.qty_estimate === 'string' ? ev.qty_estimate : null;
    if (typeof ev.deviation === 'string') s.deviations.add(ev.deviation);
    if (typeof ev.step_state === 'string') s.states.push(ev.step_state);
  }
  const steps = [...by.entries()].sort((a, b) => a[0] - b[0]);
  return steps.map(([n, s], i) => {
    const next = steps[i + 1]?.[1];
    const seconds = Math.round(((next ? next.first : s.last) - s.first) / 1000);
    return { step_n: n, seconds_in_step: seconds, ingredients_added: s.added, deviations: [...s.deviations], final_state: s.states.at(-1) ?? 'unknown' };
  });
}

Deno.serve(async req => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });
  const t0 = Date.now();
  try {
    const { capability_check, cook_id, rating = null, notes = '' } = await req.json();
    if (capability_check === true) return json({ ok: true, adaptation_contract: ADAPTATION_CONTRACT, scripted: STUB_MODE });
    if (!cook_id) return json({ ok: false, error: 'cook_id required' });

    const { error: cookUpdateError } = await sb.from('cooks').update({ ended_at: new Date().toISOString(), rating, notes: notes || null }).eq('id', cook_id);
    if (cookUpdateError) return json({ ok: false, error: 'Could not save cook details. Retry when connected.' });

    const { data: cook } = await sb.from('cooks').select('recipe_id, base_version_id').eq('id', cook_id).single();
    if (!cook) return json({ ok: false, error: 'cook not found' });
    const { data: ver } = await sb.from('versions').select('number, recipe_json').eq('id', cook.base_version_id).single();
    if (!ver) return json({ ok: false, error: 'version not found' });
    const base = RecipeSchema.parse(ver.recipe_json);
    if (STUB_MODE) return json(hasAdaptations(base) ? {
      ok: true, diff: [], proposed_version: { ...base, notes },
      spoken_recap: 'Your intentional changes are saved. Backend STUB_MODE cannot measure differences from an adapted cook.', suggestion: null,
      scripted: true,
    } : { ...sample, scripted: true });
    const { data: events } = await sb.from('cook_events').select('step_n, at, event').eq('cook_id', cook_id).order('at');
    const { data: history } = await sb.from('versions').select('number, rating, notes, diff_json').eq('recipe_id', cook.recipe_id).not('rating', 'is', null).order('number');
    const { data: latest } = await sb.from('versions').select('number').eq('recipe_id', cook.recipe_id).order('number', { ascending: false }).limit(1).maybeSingle();

    const prompt = recapUser({
      recipe: ver.recipe_json,
      timeline: compactTimeline((events ?? []) as EventRow[]),
      rating,
      notes,
      history: history ?? [],
      nextVersion: (latest?.number ?? ver.number) + 1,
    });
    // Malformed JSON (a missing comma deep in proposed_version) or a slow model moves on to the next attempt.
    // Raw output of a bad answer is logged for prompt tuning.
    let parsed: { ok: true; data: CookDiff } | { ok: false; error: string } = { ok: false, error: 'not run' };
    let lastError = '';
    let used = MODEL;
    for (let i = 0; i < ATTEMPTS.length && !parsed.ok; i++) {
      used = ATTEMPTS[i];
      try {
        const text = await geminiGenerate({
          model: used,
          system: RECAP_SYSTEM,
          parts: [{ text: lastError.startsWith('bad JSON') ? `${prompt}\n\nA previous answer was not valid JSON. Return one complete, valid JSON object.` : prompt }],
          maxTokens: 8000,
          timeoutMs: ATTEMPT_MS[i],
          retries: 0,
        });
        parsed = parseModelJson(CookDiffSchema, text);
        if (!parsed.ok) {
          lastError = `bad JSON: ${parsed.error}`;
          console.warn(`recap ${used} ${lastError} | raw: ${text.slice(0, 300)} ... ${text.slice(-200)}`);
        }
      } catch (e) {
        lastError = (e as Error).message;
        console.warn(`recap ${used} failed after ${Date.now() - t0}ms: ${lastError}`);
      }
    }
    if (!parsed.ok) return json({ ok: false, error: `Couldn't write the recap this time. Tap Generate to try again. (${lastError.slice(0, 160)})` });

    console.log(`recap ${used} ${Date.now() - t0}ms ${(events ?? []).length} events`);
    const result = parsed.data;
    if (hasAdaptations(base)) {
      result.proposed_version = preserveIntentions(base, result.proposed_version);
      const intentional = base.ingredients.filter(i => i.omitted || i.source_qty !== undefined).map(i => ingredientKey(i.name));
      result.diff = result.diff.filter(d => !intentional.some(name => ingredientKey(d.field).includes(name)));
      result.spoken_recap = result.diff.length ? 'Intentional choices preserved. Review the estimated differences below before saving.' : 'Intentional choices preserved. No additional supported differences to save.';
      result.suggestion = null; // do not leak source-based correction advice into the adapted recap
    }
    return json({ ok: true, ...result, scripted: false });
  } catch (e) {
    return json({ ok: false, error: (e as Error).message });
  }
});
