---
name: vision-prompt
description: Edit, tune, or debug the Gemini vision prompts (recipe extraction from the whole video, live coach frame comparison). Use when detections are wrong, slow, or JSON is malformed.
---

# Vision prompt tuning

Prompts live in `prompts/index.ts` (`RECIPE_EXTRACTION_SYSTEM`, `COACH_FRAME_SYSTEM`). Schemas in `lib/guards.ts`.

## Rules
- Output must be a single JSON object matching the zod schema. Keep the schema in the prompt verbatim; if you change one, change both.
- Give the model a **short candidate list** (expected ingredients for the current step), never "identify everything".
- Always request `confidence` 0–1. The app ignores anything below `CONF.deviation` (0.7).
- Coach prompt receives: creator reference frame, user frame, current step text, expected ingredients, elapsed seconds. Ask for *differences and one action*, not a description.
- Doneness language: "looks golden / translucent / coats the spoon". Never "safe to eat". Raw protein → `doneness: "unknown"` + the safety line.
- Images: user frame max 512 px wide, JPEG q0.5. Reference frame is thumbnailed on device at `ref_frame_sec` and cached in the Edge Function by step id. If a step has no reference, the prompt says so and the model uses the visual cue.

## Debug loop
1. Save 5 real frames to `supabase/functions/coach-frame/fixtures/`.
2. Run `deno run -A scripts/evalFrames.ts` (write it if missing: loops fixtures, prints JSON + latency).
3. Target: p50 latency < 1.5 s, correct ingredient on ≥ 4/5 frames.
4. If wrong: add a negative example to the prompt (or swap `GEMINI_COACH_MODEL`) ("soy sauce is dark brown and thin; oyster sauce is thick and glossy"), do not raise temperature.
