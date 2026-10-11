# Hackathon runbook (15 h)

## Contract (agree first, then freeze)
```
extract-recipe  POST { recipe_id, video_path, caption_text? } -> { ok, version_id, recipe }   // RecipeSchema
coach-frame     POST { cook_id, step_n, user_frame_b64, already_detected[], elapsed_sec } -> { ok, event }  // CoachEventSchema
recap           POST { cook_id, rating, notes } -> { ok, diff, proposed_version, spoken_recap, suggestion }
tts             POST { text } -> { ok, audio_b64 }
```
JN commits a `sample.json` per function in hour 1 so screens can be built before the real function lands.

## JN — app + AI + Edge Functions
- H0–1: Expo project, dev build, keys into `supabase secrets`, 4 stub functions returning `sample.json`
- H1–4: `extract-recipe` real on the demo video, then `import.tsx` + review screen against it
- H4–7: `coach-frame` real + `VisionLoop` + `cook/[recipeId].tsx` + `speaker` queue, tune `CONF`
- H7–10: `recap` + `tts` functions, `recap/[cookId].tsx` diff view, `refFrames.ts`
- H10–12: ElevenLabs agent wiring, `history/[recipeId].tsx`, 429 backoff
- H12–15: hotfixes during dry runs

## Teammate — infra, ops, demo
Scope: Supabase project + deploys, ElevenLabs dashboard, test footage, slides, submission. No `app/` or `supabase/functions/` edits; report bugs to JN with a screen recording.
- H0–1: Supabase project, `schema.sql`, buckets `videos` + `frames`; send JN URL/anon/service-role keys. Create Gemini + ElevenLabs keys. Pick demo video (≤90 s). Buy ingredients x2.
- H1–4: Install Supabase CLI, own `supabase functions deploy`. ElevenLabs agent with `VOICE_AGENT_SYSTEM`, pick voice, send agent ID + voice ID. Film 10 kitchen frames → fixtures for JN.
- H4–7: Test every build on a second phone; log bugs (step, result, recording). Watch function logs; flag coach-frame p50 > 1.5 s.
- H7–10: Cook test #1 with real food. Slides: problem, 40 s clip, architecture, future. Draft README + submission text.
- H10–12: Cook test #2 → backup demo video (screen + kitchen), edit to 90 s.
- H12–15: Rehearse 3× with timer, charge phones, submit.
- Optional if they code: `(tabs)/index.tsx` and `history/[recipeId].tsx` at H7 (plain Supabase reads).

## Sync points
H1 keys + stubs · H4 real extraction from the app · H7 cook test #1 · H10 cook test #2 + backup video

## Kill list (cut in this order if behind)
1. Agent voice Q&A → keep only TTS + push-to-talk STT-less demo
2. Recap suggestion field
3. History screen → show v1→v2 in recap only
4. Reference-frame compare → coach from the written visual cue only

## Demo script (3 min)
1. (20 s) "You saw it on TikTok. Now cook it with the creator watching." Paste video → extracted recipe appears.
2. (90 s) Cook live. Camera notes garlic. Add too much soy → voice corrects. Ask "what did she add next?"
3. (40 s) Recap diff, rate "8", save v2. Show history.
4. (30 s) Architecture + what's next.
