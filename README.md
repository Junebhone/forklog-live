# ForkLog Live — hackathon scaffold

Viral cooking video → structured recipe → live camera + voice coach → saved diff of your cook vs the creator's.

## Stack
- **App:** React Native + Expo (SDK 54, Expo Router, TypeScript)
- **Vision:** Google Gemini — `gemini-3.1-pro-preview` reads the whole video + audio for recipe extraction; `gemini-3.8-flash` (or `3.5-flash-lite`) for live frame coaching. Key from https://aistudio.google.com
- **Voice:** ElevenLabs — TTS (`eleven_flash_v2_5`), Conversational AI agent (`@elevenlabs/react-native`). (Scribe STT not needed: Gemini hears the video's audio.)
- **Backend:** Supabase (Postgres, Storage, Edge Functions). **All model API keys live in Edge Functions, never in the app.**

## Setup (hour 0)
```bash
npx create-expo-app@latest forklog-live -t tabs
cd forklog-live
npx expo install expo-camera expo-av expo-file-system expo-image-manipulator expo-image-picker expo-video-thumbnails expo-haptics expo-keep-awake
npm i @supabase/supabase-js zod @elevenlabs/react-native @livekit/react-native @livekit/react-native-webrtc
npx expo prebuild        # ElevenLabs agent needs a dev build, not Expo Go
npx expo run:ios         # or run:android
```
Copy this scaffold's folders into the project: `.claude/`, `CLAUDE.md`, `lib/`, `prompts/`, `supabase/`, `.env.example`.

```bash
supabase init && supabase start
supabase db push                       # applies supabase/schema.sql
supabase functions deploy extract-recipe coach-frame tts
supabase secrets set GEMINI_API_KEY=... ELEVENLABS_API_KEY=... ELEVENLABS_VOICE_ID=...
```

## Screens (Expo Router)
```
app/
  (tabs)/index.tsx        # Library: recipes + versions
  import.tsx              # Upload video → review extracted recipe
  cook/[recipeId].tsx     # Camera + live coach (voice + detection chips)
  recap/[cookId].tsx      # Diff: creator vs you, rate, save as version
  history/[recipeId].tsx  # Version timeline
```

## Team split
- **JN:** Expo app, prompts, Edge Functions, AI tuning
- **Teammate:** Supabase infra + deploys, ElevenLabs dashboard, test footage, cook tests, slides, backup video, submission
See HACKATHON.md for the hour-by-hour plan.

## Demo checklist
- Pick ONE short viral video with distinct ingredients + visible doneness change. Test extraction by hour 2.
- Record a backup demo video by hour 12.
- Keep phone plugged in, `expo-keep-awake` on during cook screen.
