---
name: eleven-voice
description: Build or fix ElevenLabs voice features — TTS step reading, deviation alerts, and the Conversational AI agent for voice Q&A. Use for anything the app says or hears.
---

# ElevenLabs voice

Two uses, two paths (video narration is read by Gemini, so no STT step is needed for extraction):

## 1. TTS (steps, alerts, recap) — via `tts` Edge Function
- Model `eleven_flash_v2_5` (lowest latency). Voice: pick one warm, clear voice ID and put it in `ELEVENLABS_VOICE_ID`.
- App: `supabase.functions.invoke('tts', { body: { text } })` → base64 mp3 → write to cache dir with `expo-file-system` → play with `expo-av` `Audio.Sound`.
- Pre-generate every step's audio when the cook screen opens (parallel) so step reads are instant. Alerts are generated live.
- Queue: one speaker at a time. An alert interrupts a step read; a step read never interrupts an alert.
- Pass every line through `AlertGate` in `lib/guards.ts` first.

## 2. Conversational agent (voice Q&A while cooking) — `@elevenlabs/react-native`
- Create an agent in the ElevenLabs dashboard. System prompt: `VOICE_AGENT_SYSTEM` from `prompts/index.ts`. First message: empty (the app speaks first).
- Pass recipe + current step + cook history as **dynamic variables** on `startSession`, and update the step via `sendContextualUpdate` when it changes.
- Requires dev build (LiveKit). Wrap the app in `<ElevenLabsProvider>`; `useConversation()` in the cook screen.
- Mic button = push-to-talk. Do not leave the mic open; kitchen noise triggers false turns.
- Tools exposed to the agent (client tools): `get_current_step`, `get_last_cook_notes`, `mark_step_done`, `set_rating`.

## Phrasing rules
- Max 12 words per alert. One action per alert. Present tense, imperative.
- Say what the creator did, then what to do: "Her sauce was thicker. Simmer two more minutes."
