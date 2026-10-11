---
name: edge-function
description: Create or fix a Supabase Edge Function (Deno) that calls Gemini or ElevenLabs. Use for extract-recipe, coach-frame, tts, recap, or any new server-side AI call.
---

# Supabase Edge Function

1. Path: `supabase/functions/<name>/index.ts`. Deno runtime, `Deno.serve`.
2. Secrets via `Deno.env.get('GEMINI_API_KEY')` / `ELEVENLABS_API_KEY`. Never return secrets.
3. Handle CORS preflight; return JSON with `{ ok: boolean }` and status 200 even on model failure so the app degrades instead of crashing.
4. Gemini: always go through `../_shared/gemini.ts`:
   - `geminiGenerate({ model, system, parts, maxTokens })` — sets `response_mime_type: application/json`, temperature 0.2, timeout.
   - `geminiUploadFile(blob, mime)` — Files API for video/audio > 20 MB, polls until ACTIVE.
   - Images under ~4 MB go inline as `{ inline_data: { mime_type: 'image/jpeg', data: b64 } }`. Label each image with a preceding `{ text: 'REFERENCE:' }` part.
5. Models (override via env): `GEMINI_EXTRACT_MODEL` default `gemini-3.1-pro-preview`; `GEMINI_COACH_MODEL` default `gemini-3.8-flash`, drop to `gemini-3.5-flash-lite` if p50 latency > 1.5 s. Check https://ai.google.dev/models for current IDs.
6. Prompts come from `../_shared/prompts.ts`; schemas from `../_shared/guards.ts`. Parse with `parseModelJson(schema, text)`. Do not inline either.
7. Log `${name} ${model} ${ms}ms` on every call.
8. Test locally: `supabase functions serve <name> --env-file supabase/.env` then curl with `sample.json` in the function folder.
9. Free-tier rate limits are per minute; if you see 429, add exponential backoff (max 2 retries) in `gemini.ts`, do not retry in the app.
