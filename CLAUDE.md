# CLAUDE.md — ForkLog Live

React Native + Expo (Expo Router, TypeScript) hackathon app. 15-hour budget: prefer working over perfect.

## Rules
- TypeScript strict. Validate every model/API response with the zod schemas in `lib/guards.ts` before use. Never trust raw JSON from a model.
- No API keys in the app bundle. Gemini + ElevenLabs calls go through Supabase Edge Functions in `supabase/functions/`. The app only holds `EXPO_PUBLIC_SUPABASE_URL` and `EXPO_PUBLIC_SUPABASE_ANON_KEY`.
- All model prompts live in `prompts/index.ts`. Do not inline prompts in components.
- Use `expo-camera` `CameraView` with `takePictureAsync({ quality: 0.5, skipProcessing: true })`, then `expo-image-manipulator` resize to width 512 before upload.
- Frame cadence: only send a frame when `lib/visionLoop.ts` scene-change check passes AND ≥2s since last send. Max 1 in-flight request.
- Voice: never speak the same alert twice within 20s (see `lib/guards.ts` `AlertGate`). Steps are read once on entry; deviations only above confidence threshold.
- Food safety: never tell the user raw meat/poultry/eggs are "done" based on vision alone. Use `SAFETY_DISCLAIMERS` phrasing in `prompts/index.ts`.
- Use functional components, hooks, `StyleSheet.create`. No new UI libraries.
- Commit after each working feature. Message format: `feat(vision): ...`, `feat(voice): ...`, `feat(data): ...`.

## Skills
Use the skills in `.claude/skills/` when the task matches: `expo-screen`, `edge-function`, `vision-prompt`, `eleven-voice`.

## Don't
- Don't build auth, social, forking, or voice cloning. Slides only.
- Don't download videos from URLs. File upload only.
- Don't train or fine-tune any model.
